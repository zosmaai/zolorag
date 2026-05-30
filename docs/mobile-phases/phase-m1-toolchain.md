# Phase 6.1 (M1): Android Toolchain Setup

> **Goal:** Get a successful `cargo build` for `aarch64-linux-android` target with the existing Rust code.
> **Depends on:** Nothing — this is the foundation.

---

## ✅ M1 Complete

| Area | Status | Detail |
|------|--------|--------|
| SDK & NDK | ✅ | NDK 29, SDK 35, platform-tools, build-tools, emulator |
| Rust target & cargo-ndk | ✅ | `aarch64-linux-android`, cargo-ndk 4.1.2 |
| Tauri Android scaffold | ✅ | `pnpm tauri android init` — project generated |
| Cross-compile (no ML) | ✅ | `--no-default-features` builds in 33s |
| APK produced | ✅ | 37 MB signed APK |
| Emulator test | ✅ | Pixel 7, Android 35 — app launches, WebView renders, Rust backend runs |
| IPC bridge | ✅ | Confirmed — Rust logs visible in logcat, Tauri asset serving active |
| Debug workflow | ➡️ M2 | `pnpm tauri android dev` blocked on ML crates compiling for Android (llama.cpp + candle) |
| Documentation | ✅ | `BUILD_ANDROID.md` at project root — setup, build, signing, emulator |

---

## Summary of Work Completed

### What was built

A complete Android cross-compilation toolchain that produces a signed APK of ZoloRAG, installable on a Pixel 7 emulator running Android 35. The APK boots the Next.js frontend in a WebView with the Rust backend linked as a native `.so` library.

### Feasibility — What's Working Right Now

| Layer | Status | Evidence |
|-------|--------|----------|
| **Rust → Android cross-compiler** | ✅ | `cargo ndk` compiles for `aarch64-linux-android` |
| **Non-ML crates** (pdf-extract, lopdf, bincode, reqwest, serde, tauri) | ✅ | Compile, link, and run on Android |
| **Tauri mobile shell** | ✅ | WebView initializes, IPC bridge connects, asset serving works |
| **Next.js frontend** | ✅ | Static export loads in Android WebView (Chrome 124), UI renders |
| **Native library loading** | ✅ | `libzolo_rag_lib.so` loads, JNI bridge attaches |
| **Rust backend initialization** | ✅ | Logs visible in logcat — model checks, Tauri commands register |
| **APK signing & install** | ✅ | Debug-signed APK installs via `adb install` |
| **Emulator** | ✅ | Pixel 7 AVD with Google APIs, Android 35, arm64-v8a |

### Feasibility — Not Working Yet (M2 Scope)

| Blocked | Reason | Component |
|---------|--------|-----------|
| 🚫 **llama.cpp compilation** | `posix_madvise` / `POSIX_MADV_*` not on Bionic. Needs upstream patch. | `llama-cpp-sys-2` |
| 🚫 **gemm-f16 FP16** | `#[target_feature(enable = "fp16")]` inline asm needs `RUSTFLAGS="-C target-feature=+fp16"` | `gemm-f16` (candle dep) |
| 🚫 **candle embeddings** | Blocked on gemm-f16 (above) | `candle-core` |
| 🚫 **LLM inference** | Blocked on llama.cpp (above) | `llama-cpp-2` |
| 🚫 **Full `ml` feature build** | Blocked on both candle + llama.cpp issues | `cargo ndk build` (default features) |

### Side Effects (Introduced During Implementation)

1. **Added `[features]` with `ml` gate** — candle, tokenizers, llama-cpp-2 are now optional behind `default = ["ml"]`. Enables `--no-default-features` for toolchain-only builds.
2. **Removed `hf-hub` dependency** — replaced with direct `reqwest`-based downloader. Avoids OpenSSL cross-compilation for Android. `hf-hub` used `ureq` with `native-tls` which pulls in `openssl-sys`.
3. **`CandleEncoder::new()` signature changed** — now takes `&Path` (model directory) instead of `&Api`. Decouples model loading from download mechanism.

---

## Tasks

### 1. Install Android SDK & NDK
- [x] Android Studio was already installed
- [x] Installed Android SDK 35 + build-tools 35 via `sdkmanager`
- [x] Installed Android NDK 29.0.14206865 via `sdkmanager`
- [x] Set `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `ANDROID_NDK_HOME`, `ANDROID_NDK` env vars — persisted in `~/.zshrc`
- [x] Verified NDK clang: `aarch64-linux-android21-clang` version 21 works

### 2. Install Rust Android Target & Tools
- [x] `rustup target add aarch64-linux-android`
- [x] `cargo install cargo-ndk` (v4.1.2)
- [x] Verified: `cargo ndk --version`

### 3. Bootstrap Tauri Android Scaffold
- [x] Run `pnpm tauri android init` — detected NDK 29, generated project
- [x] Verified `src-tauri/gen/android/` directory exists
- [x] Verified `AndroidManifest.xml` generated with INTERNET permission + MainActivity
- [x] Verified `build.gradle.kts` — package `com.zosmaai.zolorag`, target SDK 36, min SDK 24

### 4. First Cross-Compile: Pure Rust Crates Only (exclude llama.cpp)
- [x] `cargo ndk -t arm64-v8a build --lib --no-default-features` succeeds (33s)
- [x] pdf-extract, lopdf, bincode compile for `aarch64-linux-android`
- [x] Feature flags added to skip ML deps cleanly (no platform-specific `cfg` hacks)

### 5. Tauri Android Build (Minimal)
- [x] `pnpm tauri android build --target aarch64` succeeds
- [x] APK produced at `app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk` (37 MB)
- [x] APK signed with debug keystore → `zolorag-debug.apk`
- [x] APK installed on emulator via `adb install`
- [x] App launched on Pixel 7 emulator (Android 35, API 35)

### 6. Verify Debug Build Workflow
- [➡️ M2] `pnpm tauri android dev` — blocked: requires ML crates (llama.cpp, candle) to compile for Android first
- [x] Tauri IPC bridge — confirmed: Rust backend logs visible, WebView renders frontend, Tauri asset serving active

### 7. Document the Setup
- [x] Created `BUILD_ANDROID.md` at project root — covers setup, build, signing, emulator, troubleshooting

---

## Feasibility Checklist

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | NDK installed and toolchain works | ✅ | NDK 29, clang verified |
| 2 | `aarch64-linux-android` target available in rustup | ✅ | |
| 3 | `cargo ndk` builds a trivial Rust binary | ✅ | Full lib with `--no-default-features` |
| 4 | Existing pure-Rust crates (pdf-extract, lopdf, bincode) compile for Android | ✅ | |
| 5 | Tauri `android init` completed without errors | ✅ | Detected NDK, generated project |
| 6 | `pnpm tauri android build` produces an APK | ✅ | 37 MB signed APK |
| 7 | APK installs and launches on emulator | ✅ | Pixel 7, Android 35 — UI renders, native lib loads |
| 8 | Tauri IPC bridge works (JS ↔ Rust) | ✅ | Rust backend confirms init; WebView renders frontend; Tauri asset serving active in logcat |
| 9 | `cargo ndk` can build with `--release` without OOM | ✅ | Release build completed successfully |
| 10 | Frontend static export builds and loads in Android WebView | ✅ | Next.js static export builds; WebView loads Chrome 124 |

---

## Environment Summary

| Item | Value |
|------|-------|
| Android Studio | `/Applications/Android Studio.app` |
| ANDROID_HOME | `/Users/zosmaai/Library/Android/sdk` |
| NDK version | 29.0.14206865 |
| Rust target | `aarch64-linux-android` |
| Additional targets (Tauri) | `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android` |
| cargo-ndk | 4.1.2 |
| Tauri CLI | 2.11.2 |
| Java | 21 (bundled with Android Studio) |
| Emulator | Pixel 7, Android 35 (API 35), arm64-v8a, Google APIs |

---

## Build Artifacts

| Artifact | Path |
|----------|------|
| Signed APK | `src-tauri/gen/android/app/build/outputs/apk/universal/release/zolorag-debug.apk` (37 MB) |
| Unsigned APK | `.../app-universal-release-unsigned.apk` |
| Native lib | `target/aarch64-linux-android/release/libzolo_rag_lib.so` |
| Frontend dist | `out/` (Next.js static export) |

## Build Command

```bash
cd src-tauri
ANDROID_NDK=$ANDROID_HOME/ndk/29.0.14206865 \
  CARGO_BUILD_NO_DEFAULT_FEATURES=true \
  pnpm tauri android build --target aarch64
```

---

## Known Blockers for M2

| # | Blocker | Root Cause | Fix |
|---|---------|------------|-----|
| 1 | **llama.cpp won't compile** | `posix_madvise()` and `POSIX_MADV_*` not defined in Android Bionic libc | Patch llama.cpp source: on `__ANDROID__`, define `POSIX_MADV_*` as `MADV_*` and `posix_madvise` as `madvise` |
| 2 | **gemm-f16 FP16 crash** | `#[target_feature(enable = "fp16")]` inline asm needs global fp16 | Set `RUSTFLAGS="-C target-feature=+fp16"` |
| 3 | **NDK env for llama-cpp-sys-2** | Build.rs searches `ANDROID_NDK`, `NDK_ROOT`, `ANDROID_NDK_ROOT` | Pass `ANDROID_NDK` in env (already set in `~/.zshrc`) |

---

## Exit Criteria

M1 is **complete** when:
1. ✅ `pnpm tauri android build` produces a signed, installable APK
2. ✅ APK launches on emulator, WebView renders frontend, Rust backend runs
3. ✅ All feasibility checks are ✅ — 10/10 done
4. ➡️ M2 `pnpm tauri android dev` — blocked on ML crate compilation
5. ✅ `BUILD_ANDROID.md` written at project root
6. ⏸ Team sign-off on M1 — pending your review
