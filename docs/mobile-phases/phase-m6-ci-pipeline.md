# Phase 6.6 (M6): CI Pipeline & Distribution

> **Goal:** Automated Android builds in GitHub Actions that produce a signed APK/AAB, ready for sideloading or Play Store.
> **Depends on:** M1 (toolchain), M2 (ML builds)

---

## Scope

Set up a repeatable CI pipeline for Android builds. This covers:
- Cross-compilation of all Rust crates (including llama.cpp C++) in CI
- APK packaging and signing
- Artifact storage
- Development workflow documentation

## Tasks

### 1. GitHub Actions Runner Configuration
- [ ] Base image: `ubuntu-latest` (22.04 or 24.04)
- [ ] Install Android SDK via `action/setup-android@v4` or manual SDK manager
- [ ] Install Android NDK r27+ (via SDK manager or pre-installed Ubuntu image)
- [ ] Cache: `~/.gradle`, `~/.cargo`, `target/` for incremental builds
- [ ] Set environment variables: `ANDROID_HOME`, `ANDROID_NDK_HOME`, `JAVA_HOME`

### 2. Rust Build Step
- [ ] `dtolnay/rust-toolchain@stable` with `targets: aarch64-linux-android`
- [ ] `cargo install cargo-ndk` (cached if possible)
- [ ] `cargo ndk -t arm64-v8a build --release` — this must succeed
- [ ] If llama.cpp fails, document the exact NDK + env vars needed
- [ ] **Llama.cpp compilation in CI**: set `CC_aarch64_linux_android`, `CXX_aarch64_linux_android`, `AR_aarch64_linux_android` to NDK toolchain paths

### 3. Frontend Build
- [ ] Node 22 + pnpm 10
- [ ] `pnpm install`
- [ ] `pnpm build` (Next.js static export)
- [ ] Output goes to `src-tauri/` as usual

### 4. Tauri Android Build
- [ ] `pnpm tauri android build` — produces unsigned APK/AAB
- [ ] Verify APK is produced at expected path
- [ ] Set APK version name from `Cargo.toml` version + commit hash suffix

### 5. APK Signing
- [ ] Generate a debug keystore for CI (stored as GitHub secret, base64-encoded)
- [ ] Sign APK with `apksigner` from Android SDK build-tools
- [ ] Verify: `apksigner verify app-release.apk` passes
- [ ] Store signed APK as a CI artifact (retention: 30 days)

### 6. CI Matrix Strategy
- [ ] **Build-only job**: `cargo ndk build --release` — runs on PRs (fast, < 10 min)
- [ ] **Full APK job**: `pnpm tauri android build` — runs on push to `main` and tags
- [ ] **Release job**: signed APK + GitHub Release upload — runs on tags only

### 7. CI Performance & Caching
- [ ] Target total build time: ≤ 20 minutes for full APK build
- [ ] Cache cargo registry + git checkouts
- [ ] Cache Gradle dependencies
- [ ] Cache llama.cpp build artifacts (the `.a` file is large but rarely changes)
- [ ] Consider using `sccache` for Rust compilation caching

### 8. Build Documentation
- [ ] Update `BUILD_ANDROID.md` with CI-specific notes
- [ ] Document how to reproduce a CI build locally
- [ ] Document the signing key management process
- [ ] Document how to add a new Rust target or dependency

### 9. Local Build Script
- [ ] Create `scripts/build-android.sh` that wraps the full build process:
  ```bash
  #!/bin/bash
  set -euo pipefail

  export ANDROID_HOME=${ANDROID_HOME:-$HOME/Android/Sdk}
  export ANDROID_NDK_HOME=${ANDROID_NDK_HOME:-$ANDROID_HOME/ndk/27.1.12297006}

  cargo ndk -t arm64-v8a build --release
  pnpm build
  pnpm tauri android build
  ```
- [ ] Script checks all required env vars and exits with a clear error if missing

---

## Feasibility Checklist (Blocker Detection)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | CI runner has Android SDK + NDK pre-installed or installable | ☐ | GitHub Actions Ubuntu 24.04 may not have NDK; needs `sdkmanager` step |
| 2 | `cargo ndk build --release` succeeds in CI | ☐ | |
| 3 | llama.cpp cross-compiles in CI environment | ☐ | Most likely failure point |
| 4 | `pnpm tauri android build` succeeds in CI | ☐ | |
| 5 | APK is signed in CI and verification passes | ☐ | |
| 6 | CI cache reduces build time significantly across runs | ☐ | Measure: cold vs warm build |
| 7 | Full CI run completes in ≤ 20 minutes | ☐ | |
| 8 | Build script (`build-android.sh`) works locally | ☐ | |
| 9 | CI produces a downloadable APK artifact | ☐ | |
| 10 | PR build-check job runs in ≤ 10 minutes | ☐ | |

## Blockers & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Android SDK/NDK installation is slow or fails in CI | **High** | Use pre-baked Docker image with NDK; or cache SDK install |
| llama.cpp build fails due to missing NDK CMake toolchain detection | **High** | Explicitly set `CMAKE_TOOLCHAIN_FILE` and `ANDROID_ABI` in CI env |
| Gradle build consumes too much memory in CI (OOM) | Medium | Limit Gradle parallel workers: `ORG_GRADLE_PROJECT_org.gradle.workers.max=2` |
| Tauri CLI version mismatch with local dev | Low | Pin Tauri CLI version in CI and local dev |
| GitHub Actions cache size limit (10 GB) | Low | Monitor cache size; prune old entries |

## Success Criteria

- [ ] CI produces a signed, installable APK on every push to main
- [ ] CI run completes in ≤ 20 minutes (full) or ≤ 10 minutes (PR check)
- [ ] CI artifacts are downloadable and installable on a physical device
- [ ] A new developer can set up the Android build in ≤ 1 hour by following `BUILD_ANDROID.md`

## Exit Criteria

M6 is **complete** when:
1. GitHub Actions workflow runs successfully end-to-end
2. Signed APK is produced and verified
3. APK can be sideloaded onto a device directly from CI artifacts
4. Build documentation is complete and tested by at least one other developer
5. Team can produce a release APK with one command or CI trigger
