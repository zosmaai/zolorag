# Phase 6.1 (M1): Android Toolchain Setup

> **Goal:** Get a successful `cargo build` for `aarch64-linux-android` target with the existing Rust code.
> **Depends on:** Nothing — this is the foundation.

---

## Scope

Set up the Android NDK, Rust cross-compilation target, and Tauri mobile scaffolding. Produce a "hello world" Tauri Android app that launches in the emulator.

## Tasks

### 1. Install Android SDK & NDK
- [ ] Install Android Studio (or standalone SDK)
- [ ] Install Android SDK 34+ with build tools
- [ ] Install Android NDK r27+ via SDK Manager
- [ ] Set `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `ANDROID_NDK_HOME` env vars
- [ ] Verify NDK toolchain: `$NDK/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android21-clang --version`

### 2. Install Rust Android Target & Tools
- [ ] `rustup target add aarch64-linux-android`
- [ ] `cargo install cargo-ndk`
- [ ] Verify: `cargo ndk --version`

### 3. Bootstrap Tauri Android Scaffold
- [ ] Run `pnpm tauri android init` in the project root
- [ ] Verify `src-tauri/gen/android/` directory exists
- [ ] Verify `src-tauri/gen/android/app/src/main/AndroidManifest.xml` exists
- [ ] Verify `src-tauri/gen/android/build.gradle.kts` is valid

### 4. First Cross-Compile: Pure Rust Crates Only (exclude llama.cpp)
- [ ] Create a minimal test: `cargo ndk -t arm64-v8a build --no-default-features` (skip llm feature)
- [ ] It compiles candle + pdf-extract + lopdf + bincode successfully
- [ ] Fix any `cfg(target_os)` or platform-specific code that breaks on Android

### 5. Tauri Android Build (Minimal)
- [ ] `pnpm tauri android build` succeeds
- [ ] APK file is produced at `src-tauri/gen/android/build/outputs/apk/`
- [ ] APK installs on emulator via `adb install`
- [ ] App launches with WebView showing "Hello from ZoloRAG mobile"

### 6. Verify Debug Build Workflow
- [ ] `pnpm tauri android dev` deploys to connected device/emulator
- [ ] Hot-reload of frontend changes works
- [ ] Tauri commands (`invoke('greet')`) work from JS to Rust

### 7. Document the Setup
- [ ] Create/update `BUILD_ANDROID.md` with step-by-step setup
- [ ] Document NDK version and exact paths used
- [ ] Document any crate-specific `[target.'cfg(target_os = "android")'.dependencies]` changes

---

## Feasibility Checklist (Blocker Detection)

Check each item before declaring M1 complete:

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | NDK installed and toolchain works | ☐ | |
| 2 | `aarch64-linux-android` target available in rustup | ☐ | |
| 3 | `cargo ndk` builds a trivial Rust binary | ☐ | |
| 4 | Existing pure-Rust crates (candle, pdf-extract) compile for Android | ☐ | If this fails, we need crate patches |
| 5 | Tauri `android init` completed without errors | ☐ | |
| 6 | `pnpm tauri android build` produces an APK | ☐ | |
| 7 | APK installs and launches on emulator | ☐ | |
| 8 | Tauri IPC bridge works (JS → Rust → JS round trip) | ☐ | |
| 9 | `cargo ndk` can build with `--release` without OOM | ☐ | Cross-compile RAM usage |
| 10 | Frontend static export builds and loads in Android WebView | ☐ | |

## Blockers & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| NDK version incompatibility with Tauri | High | Pin exact NDK version documented by Tauri |
| Crate uses `libc` or `unix` APIs not available on Android | Medium | Check with `cargo build --target aarch64-linux-android` early |
| `cargo ndk` requires specific env vars | Low | Document in BUILD_ANDROID.md |
| Tauri Android scaffolding changes between versions | Medium | Use Tauri 2.x stable, pin version |

## Success Criteria

- [ ] `pnpm tauri android build` produces an installable APK
- [ ] The APK launches on an Android 14+ emulator or device
- [ ] A basic Tauri command (`invoke('greet')`) returns data to the frontend
- [ ] All pure-Rust crates compile without errors for `aarch64-linux-android`
- [ ] Total build time for debug: ≤ 10 minutes on a developer machine

## Exit Criteria

M1 is **complete** when:
1. You can run `pnpm tauri android dev` and see the app on a device/emulator
2. All feasibility checks above are ✅
3. `BUILD_ANDROID.md` is written and accurate
4. The team agrees the toolchain is stable enough for M2
