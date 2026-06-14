# Phase 6.6 (M6): CI/CD Pipeline — Desktop + Android

> **Goal:** Automated builds in GitHub Actions that produce signed artifacts for both Android (APK/AAB) and desktop (macOS .dmg, Windows .exe, Linux AppImage). CI runs `cargo test` on desktop. Builds are repeatable and documented.
> **Depends on:** M1 (toolchain), M2 (ML builds)

---

## ⚠️ Cross-Platform Constraint

CI must build and test **both** targets. Android-only CI leaves desktop regressions undetected.

| Job | Trigger | Runner | Artifacts |
|-----|---------|--------|-----------|
| `test` | Every PR + push | `ubuntu-latest` | Test results |
| `build-desktop` | Push to `main` + tags | `macos-latest` | `.dmg`, `.app.tar.gz` |
| `build-android` | Push to `main` + tags | `ubuntu-latest` | Signed `.apk` |
| `release` | Tags only | Both | GitHub Release with all artifacts |

---

## Key Decisions from M2 (Do Not Revert)

- **No `cargo-ndk`** — Tauri calls plain `cargo build --target aarch64-linux-android`. The full NDK toolchain is declared in `.cargo/config.toml` `[env]` section. CI just needs the NDK installed at the correct path.
- **No shell env var exports for CFLAGS/CXXFLAGS** — the Android POSIX_MADV fix lives in the **vendored** `vendor/llama-cpp-sys-2/` (wired via `[patch.crates-io]`), not in env vars. `.cargo/config.toml` additionally `force`-empties `CFLAGS_aarch64_linux_android` for defence in depth.
- **No setup script** — `git clone` is enough. The vendor dir is checked in; cargo picks it up via the `[patch.crates-io]` block in `src-tauri/Cargo.toml`.
- **NDK version**: `29.0.14206865` — this is what `.cargo/config.toml` references. CI must install this exact version.

---

## Tasks

### 1. CI Runner — Android (ubuntu-latest)

- [ ] Base image: `ubuntu-latest` (24.04)
- [ ] Install Java 17: `actions/setup-java@v4` with `distribution: temurin`
- [ ] Install Android SDK + NDK via `android-actions/setup-android@v3`:
  - SDK packages: `platform-tools`, `platforms;android-34`, `build-tools;34.0.0`
  - NDK: `ndk;29.0.14206865` (exact version — matches `.cargo/config.toml`)
- [ ] After NDK install, update `.cargo/config.toml` paths if CI NDK path differs from local:
  - Local: `/opt/homebrew/share/android-commandlinetools/ndk/29.0.14206865` (macOS homebrew)
  - CI: `$ANDROID_HOME/ndk/29.0.14206865`
  - **Solution**: `.cargo/config.toml` should use `$ANDROID_NDK_ROOT` interpolation, OR the CI step sets the env vars to override the config values (`force = false` means env takes precedence)
- [ ] Cache:
  - `~/.cargo/registry` (Cargo dependency downloads)
  - `~/.cargo/git` (git-based deps)
  - `src-tauri/target/aarch64-linux-android/release/build/` (llama.cpp compiled artifacts)
  - `~/.gradle/caches` (Gradle)

### 2. CI Runner — Desktop (macos-latest)

- [ ] Base image: `macos-latest` (macOS 14, Apple Silicon)
- [ ] Rust toolchain: `dtolnay/rust-toolchain@stable`
- [ ] Node 22 + pnpm 10: `actions/setup-node@v4` + `pnpm/action-setup@v4`
- [ ] Cache: `~/.cargo/registry`, `~/.cargo/git`, `src-tauri/target/release/`
- [ ] No Android SDK, no NDK — desktop build must succeed without any Android env vars

### 3. Test Job (ubuntu-latest — fast feedback on PRs)

- [ ] Install Rust stable (no Android target needed — tests run on host)
- [ ] `cargo test --lib --workspace` — all unit tests must pass
- [ ] `cargo clippy --lib --workspace -- -D warnings` — no warnings
- [ ] `pnpm install && pnpm build` — frontend builds without errors
- [ ] Target time: ≤ 8 minutes

### 4. Android Build Step

- [ ] `pnpm install`
- [ ] `pnpm build` (Next.js static export → `src-tauri/`)
- [ ] `pnpm tauri android build --apk` — produces unsigned APK
- [ ] APK path: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`
- [ ] Version name: read from `Cargo.toml` + short commit SHA suffix
- [ ] **Note**: `pnpm tauri android dev` is fully working (M2 resolved + React/HMR/hydration fixed 2026-06-14). The fallback is no longer needed.

### 5. Android APK Signing

- [ ] Generate a CI keystore: `keytool -genkey -v -keystore ci-keystore.jks ...`
- [ ] Store as GitHub secret: `ANDROID_KEYSTORE_BASE64` (base64-encoded `.jks`)
- [ ] Store key password and alias as secrets: `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS`
- [ ] CI step: decode secret → write to temp file → sign with `apksigner`:
  ```bash
  echo "$ANDROID_KEYSTORE_BASE64" | base64 -d > /tmp/keystore.jks
  apksigner sign --ks /tmp/keystore.jks --ks-key-alias "$ANDROID_KEY_ALIAS" \
    --ks-pass "pass:$ANDROID_KEY_PASSWORD" \
    --out app-release-signed.apk app-universal-release-unsigned.apk
  ```
- [ ] Verify: `apksigner verify app-release-signed.apk`
- [ ] Upload as CI artifact (retention: 30 days)

### 6. Desktop Build Step

- [ ] `pnpm install`
- [ ] `pnpm build` (Next.js static export)
- [ ] `pnpm tauri build` — produces `.dmg` (macOS) / `.msi` + `.exe` (Windows) / `.AppImage` (Linux)
- [ ] Upload as CI artifact (retention: 30 days)
- [ ] **macOS code signing**: use `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD` secrets (or skip for internal builds — notarization can be deferred)

### 7. CI Matrix Strategy

```yaml
# PRs: fast tests only
on:
  pull_request:
    jobs: [test]

# Push to main: full builds
on:
  push:
    branches: [main]
    jobs: [test, build-desktop, build-android]

# Tags: release artifacts
on:
  push:
    tags: ['v*']
    jobs: [test, build-desktop, build-android, release]
```

### 8. .cargo/config.toml — CI Path Override

The local `.cargo/config.toml` hardcodes the macOS homebrew NDK path. CI has a different path. Two options:

**Option A (recommended)**: Add a CI-specific env override step before the build:
```yaml
- name: Override NDK paths for CI
  run: |
    NDK=$ANDROID_HOME/ndk/29.0.14206865
    TOOLCHAIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin
    echo "ANDROID_NDK=$NDK"           >> $GITHUB_ENV
    echo "NDK_ROOT=$NDK"              >> $GITHUB_ENV
    echo "ANDROID_NDK_ROOT=$NDK"      >> $GITHUB_ENV
    echo "CC_aarch64_linux_android=$TOOLCHAIN/aarch64-linux-android24-clang"   >> $GITHUB_ENV
    echo "CXX_aarch64_linux_android=$TOOLCHAIN/aarch64-linux-android24-clang++" >> $GITHUB_ENV
    echo "AR_aarch64_linux_android=$TOOLCHAIN/llvm-ar"                          >> $GITHUB_ENV
    echo "CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=$TOOLCHAIN/aarch64-linux-android24-clang" >> $GITHUB_ENV
```
Since `.cargo/config.toml` uses `force = false`, shell env takes precedence over config values.

**Option B**: Parameterise `.cargo/config.toml` with relative paths (fragile — not recommended).

### 9. CI Performance & Caching

- [ ] Target: ≤ 10 min test job, ≤ 25 min Android build, ≤ 20 min desktop build
- [ ] Cache key includes: Rust toolchain version, `Cargo.lock` hash, NDK version
- [ ] Cache llama.cpp compiled `.a` file — it changes only when `llama-cpp-sys-2` version bumps
- [ ] `sccache` for Rust compilation across runs (optional but effective)
- [ ] Gradle: `ORG_GRADLE_PROJECT_org.gradle.workers.max=2` to prevent OOM on CI

### 10. Local Build Commands (no wrapper scripts)

Local builds use stock Tauri CLI — the wrapper scripts that existed during M2
have been removed. All state lives in version-controlled files
(`.cargo/config.toml`, `src-tauri/Cargo.toml` `[patch.crates-io]`,
`vendor/llama-cpp-sys-2/`).

```bash
# Android dev
pnpm android:dev          # ≡ pnpm tauri android dev

# Android release APK
pnpm android:build        # ≡ pnpm tauri android build --target aarch64

# Desktop
pnpm tauri build
```

### 11. Build Documentation

- [x] `BUILD_ANDROID.md` updated to reference stock Tauri CLI workflow and
      vendored `llama-cpp-sys-2`; no wrapper-script references remain.
- [ ] Update `BUILD_DESKTOP.md` (or main README): standard Tauri desktop build
      instructions, no Android env vars needed for desktop builds.

---

## Feasibility Checklist

| # | Check | Platform | Status |
|---|-------|----------|--------|
| 1 | `cargo test --lib` passes in CI | Desktop | ☐ |
| 2 | NDK 29.0.14206865 installable via `sdkmanager` in CI | Android | ☐ |
| 3 | CI env var override takes precedence over `.cargo/config.toml` | Android | ☐ |
| 4 | `vendor/llama-cpp-sys-2/` resolved via `[patch.crates-io]` in CI | Android | ☐ |
| 5 | `cargo build --target aarch64-linux-android --lib --release` in CI | Android | ☐ |
| 6 | `pnpm tauri android build` succeeds in CI | Android | ☐ |
| 7 | APK signing passes `apksigner verify` | Android | ☐ |
| 8 | `pnpm tauri build` succeeds on macOS CI | Desktop | ☐ |
| 9 | Desktop artifact (.dmg) downloadable from CI | Desktop | ☐ |
| 10 | Android artifact (.apk) downloadable from CI | Android | ☐ |
| 11 | CI cache measurably reduces build time on second run | Both | ☐ |
| 12 | Total Android CI run ≤ 25 min (warm cache) | Android | ☐ |
| 13 | Total desktop CI run ≤ 20 min (warm cache) | Desktop | ☐ |

---

## Blockers & Risks

| Risk | Impact | Platform | Mitigation |
|------|--------|----------|------------|
| NDK 29.0.14206865 not available via `sdkmanager` in CI | **High** | Android | Pin to available version; update `.cargo/config.toml` if version changes |
| `cargo update` bumps `llama-cpp-2` to a version requiring a newer `llama-cpp-sys-2` | Medium | Android | Re-vendor `llama-cpp-sys-2` at the new version, re-apply the `__ANDROID__` guard in `llama.cpp/src/llama-mmap.cpp`, commit. Catch via CI build. |
| macOS CI runner is Apple Silicon but keystore signed on Intel | Low | Desktop | Use universal binary or pin to `macos-latest` |
| GitHub Actions cache evicted (10 GB limit) | Low | Both | Monitor cache size; evict Android target cache first |
| `pnpm tauri android dev` emulator detection (from M2) | ✅ Resolved | Android | N/A — fixed in M2 (ANDROID_HOME pointing at partial SDK) + React/HMR/hydration issues resolved in 2026-06-14 |

---

## Success Criteria

### Both Platforms
- [ ] CI produces downloadable artifacts on every push to `main`
- [ ] `cargo test` passes on every PR
- [ ] A new developer can reproduce the CI build locally using the documented scripts

### Android
- [ ] Signed APK installable on a physical device from CI artifact
- [ ] Android CI run ≤ 25 minutes (warm cache)

### Desktop
- [ ] `.dmg` (macOS) installable from CI artifact
- [ ] Desktop CI run ≤ 20 minutes (warm cache)

---

## Exit Criteria

M6 is **complete** when:
1. All three CI jobs (test, build-android, build-desktop) pass on `main`
2. Both artifacts (APK + .dmg) are downloadable and installable from a tag release
3. Android APK `apksigner verify` passes
4. `BUILD_ANDROID.md` updated — verified by a second developer completing setup from scratch
5. Team can produce a full release (both platforms) from a single git tag
