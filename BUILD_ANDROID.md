# Building ZoloRAG for Android

## Prerequisites

### Required Software
| Tool | Version | Check |
|------|---------|-------|
| Android Studio | Latest | `ls /Applications/Android\ Studio.app` |
| Android SDK 35+ | via SDK Manager | `$ANDROID_HOME/platforms/android-35/` |
| Android NDK 29+ | via SDK Manager | `$ANDROID_HOME/ndk/29.*/` |
| Rust | 1.94+ | `rustc --version` |
| Rust Android target | aarch64-linux-android | `rustup target list --installed` |
| cargo-ndk | 4.x | `cargo ndk --version` |
| Node.js | 22+ | `node --version` |
| pnpm | 10+ | `pnpm --version` |
| Tauri CLI | 2.11+ | `pnpm tauri --version` |

### Environment Variables

Add these to your shell profile (`~/.zshrc`):

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/29.0.14206865
export ANDROID_NDK=$ANDROID_NDK_HOME
export JAVA_HOME=/Applications/Android\ Studio.app/Contents/jbr/Contents/Home
export PATH=$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/tools:$ANDROID_HOME/tools/bin:$PATH
```

Reload: `source ~/.zshrc`

---

## Setup Steps

### 1. Install Android SDK & NDK

```bash
# Install command-line tools (if not present via Android Studio)
mkdir -p $ANDROID_HOME/cmdline-tools
curl -sL -o /tmp/cmdline-tools.zip \
  "https://dl.google.com/android/repository/commandlinetools-mac-14742923_latest.zip"
unzip -q /tmp/cmdline-tools.zip -d /tmp/cmdline-tools-extracted
mv /tmp/cmdline-tools-extracted/cmdline-tools $ANDROID_HOME/cmdline-tools/latest

# Accept licenses
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --sdk_root=$ANDROID_HOME --licenses

# Install SDK components
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --sdk_root=$ANDROID_HOME \
  "platform-tools" \
  "build-tools;35.0.0" \
  "platforms;android-35" \
  "platforms;android-34" \
  "ndk;29.0.14206865" \
  "emulator"
```

### 2. Install Rust Android Target

```bash
rustup target add aarch64-linux-android
cargo install cargo-ndk --locked
```

### 3. Initialize Tauri Android Scaffold

```bash
cd /path/to/zolo-rag
pnpm tauri android init
```

This creates `src-tauri/gen/android/` with the Android Studio project.

---

## Building

### Quick Build (without ML features — for toolchain verification)

```bash
cd src-tauri
ANDROID_NDK=$ANDROID_HOME/ndk/29.0.14206865 \
  CARGO_BUILD_NO_DEFAULT_FEATURES=true \
  pnpm tauri android build --target aarch64
```

### Full Build (with ML — candle + llama.cpp)

```bash
cd src-tauri
ANDROID_NDK=$ANDROID_HOME/ndk/29.0.14206865 \
  RUSTFLAGS="-C target-feature=+fp16" \
  pnpm tauri android build --target aarch64
```

### Output

| Artifact | Path |
|----------|------|
| Unsigned APK | `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk` |
| Signed APK (see below) | `.../zolorag-debug.apk` |
| AAB | `.../app-universal-release.aab` |
| Native lib | `target/aarch64-linux-android/release/libzolo_rag_lib.so` |

---

## Signing

### Debug Signing

```bash
# Generate debug keystore (one-time)
keytool -genkey -v -keystore ~/.android/debug.keystore -storepass android \
  -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 \
  -validity 10000 -dname "CN=Android Debug,O=Android,C=US"

# Sign APK
APKSIGNER=$ANDROID_HOME/build-tools/35.0.0/apksigner
UNSIGNED=src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
SIGNED=src-tauri/gen/android/app/build/outputs/apk/universal/release/zolorag-debug.apk

$APKSIGNER sign --ks ~/.android/debug.keystore --ks-pass pass:android \
  --ks-key-alias androiddebugkey --out "$SIGNED" "$UNSIGNED"

$APKSIGNER verify "$SIGNED"
```

### Release Signing

For Play Store distribution, use a production keystore:
```bash
$APKSIGNER sign --ks /path/to/release.keystore \
  --ks-key-alias my-alias --out app-release.apk app-unsigned.apk
```

---

## Running on Emulator

### Create AVD (one-time)

```bash
$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager create avd \
  -n "pixel_7" \
  -k "system-images;android-35;google_apis;arm64-v8a" \
  -d "pixel_7" -f
```

### Launch Emulator

```bash
# With window (for UI testing)
$ANDROID_HOME/emulator/emulator -avd pixel_7 -no-snapshot

# Headless (CI)
$ANDROID_HOME/emulator/emulator -avd pixel_7 -no-window -no-audio -no-snapshot &
```

### Install & Launch APK

```bash
# Wait for boot
adb wait-for-device
adb shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done'

# Install
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/zolorag-debug.apk

# Launch
adb shell am start -n "com.zosmaai.zolorag/com.zosmaai.zolorag.MainActivity"

# Check logs
adb logcat --pid=$(adb shell pidof com.zosmaai.zolorag) -v time
```

---

## Development Workflow

### Debug Build with Hot-Reload

Once ML crates compile for Android (see M2 status):
```bash
pnpm tauri android dev
```

This runs the frontend dev server and deploys the debug APK. File changes trigger hot-reload for both Rust and frontend code.

### Testing IPC Bridge

With a debuggable APK, connect Chrome DevTools:
```bash
# Forward WebView devtools port
adb forward tcp:9223 localabstract:webview_devtools_remote_$(adb shell pidof com.zosmaai.zolorag)

# Open in Chrome
open "http://localhost:9223"
```

---

## Project Structure (Android-specific)

```
src-tauri/
├── .cargo/config.toml          # Cross-compilation config
├── Cargo.toml                  # Features: default = ["ml"]
├── tauri.conf.json             # Tauri config
├── src/                        # Rust source (shared with desktop)
│   ├── lib.rs
│   ├── ml/
│   │   ├── download.rs         # Model download (reqwest-based, no hf-hub)
│   │   ├── embed.rs            # CandleEncoder (cfg: ml)
│   │   └── llm.rs              # LlamaCppEngine (cfg: ml)
│   ├── pdf/
│   └── rag/
├── gen/android/                # Generated Android project
│   ├── app/src/main/
│   │   ├── AndroidManifest.xml
│   │   ├── java/.../MainActivity.kt
│   │   └── jniLibs/            # Native .so files
│   ├── build.gradle.kts
│   └── gradle/
```

---

## Feature Flags

| Feature | Components | Default | Used For |
|---------|-----------|---------|----------|
| `ml` | candle-core, candle-nn, candle-transformers, tokenizers, llama-cpp-2 | ✅ On | Desktop builds |
| (none) | pdf-extract, lopdf, bincode, tauri, reqwest | — | Android non-ML builds |

To build without ML (toolchain verification or CI):
```bash
CARGO_BUILD_NO_DEFAULT_FEATURES=true pnpm tauri android build --target aarch64
```

---

## Troubleshooting

### `openssl-sys` fails to cross-compile
`hf-hub` was replaced with direct `reqwest`-based downloader in `src/ml/download.rs`. If you add a dependency that pulls in `native-tls`, switch to `rustls-tls` or cross-compile OpenSSL for Android.

### `gemm-f16` fails with "instruction requires: fullfp16"
Set `RUSTFLAGS="-C target-feature=+fp16"` or ensure `.cargo/config.toml` has it for `[target.aarch64-linux-android]`.

### `llama-cpp-sys-2` fails with "Android NDK not found"
Set `ANDROID_NDK=/path/to/ndk` in your environment.

### `llama-cpp-sys-2` fails with "use of undeclared identifier 'POSIX_MADV_WILLNEED'"
This is a known Android Bionic incompatibility. Tracked in M2. Fix: add `__ANDROID__` fallback defines in `llama-mmap.cpp`.

### Disk full during build
The llama.cpp CMake build + Rust debug artifacts can consume 10+ GB. Clean periodically:
```bash
rm -rf src-tauri/target/aarch64-linux-android/debug/build/llama-cpp-sys-2-*
rm -rf ~/.gradle/caches/
```

---

## CI Notes

For GitHub Actions, the Android build runner needs:
```yaml
- uses: actions/setup-java@v4
  with:
    distribution: 'zulu'
    java-version: 17
- name: Setup Android SDK
  uses: android-actions/setup-android@v3
- run: sdkmanager "ndk;29.0.14206865" "platforms;android-35" "build-tools;35.0.0"
- name: cargo-ndk
  run: cargo install cargo-ndk
- name: Build APK
  run: |
    ANDROID_NDK=$ANDROID_HOME/ndk/29.0.14206865 \
    CARGO_BUILD_NO_DEFAULT_FEATURES=true \
    pnpm tauri android build --target aarch64
```

---

## Version History

| Date | Author | Changes |
|------|--------|---------|
| 2026-05-30 | pi | Initial Android build documentation |
