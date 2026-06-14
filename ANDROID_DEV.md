# Android Dev — Launch Emulator & Run ZoloRAG

Stock Tauri CLI. No wrapper scripts. Three commands from a clean shell.

---

## 0. One-time shell setup

In `~/.zshrc` (or current shell):

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT=$ANDROID_HOME
export NDK_HOME=$ANDROID_HOME/ndk/29.0.14206865
export ANDROID_NDK_HOME=$NDK_HOME
export PATH=$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH
```

Verify:

```bash
which adb emulator                          # both under $ANDROID_HOME
ls "$NDK_HOME/build/cmake/android.toolchain.cmake"   # exists
env | grep -E "^CFLAGS|^CXXFLAGS"           # MUST be empty
```

If `CFLAGS` / `CXXFLAGS` are set in your shell, `unset` them. The Android
POSIX_MADV fix is baked into `vendor/llama-cpp-sys-2/` — never set those
env vars manually.

---

## 1. Pick / create an AVD

List installed:

```bash
emulator -list-avds
```

If empty, create one with `avdmanager` (the API-34 Pixel 7 is the verified
combo for this project):

```bash
sdkmanager "system-images;android-34;google_apis;arm64-v8a"
avdmanager create avd -n Pixel_7_API34 \
  -k "system-images;android-34;google_apis;arm64-v8a" \
  -d pixel_7
```

Or use Android Studio → **Tools → Device Manager → Create Device**.

---

## 2. Boot the emulator

In **a separate terminal** (it stays running):

```bash
emulator -avd Pixel_8_API35 -no-snapshot-load
```

Useful flags:
- `-no-snapshot-load` — clean boot (avoids stale state)
- `-no-boot-anim` — skip the boot animation (faster)
- `-netdelay none -netspeed full` — disable artificial network throttling
- `-gpu host` — use macOS GPU (default on Apple Silicon, faster)

Wait until the home screen appears, then sanity-check from your project terminal:

```bash
adb devices
# expect:
#   List of devices attached
#   emulator-5554   device

adb shell getprop sys.boot_completed       # expect: 1
```

---

## 3. Run the app

```bash
cd /Users/zosmaai/Desktop/zolo-rag
pnpm android:dev
```

> **Important:** Always use `pnpm android:dev` (NOT `pnpm tauri android dev`).
> The npm script adds `--host` which lets Tauri detect your LAN IP and set
> `TAURI_DEV_HOST`. Without this flag, Next.js's `assetPrefix` defaults to
> `http://localhost:3000`, and the Android emulator resolves `localhost` to
> *itself* — not your Mac — so JS chunks return `ERR_CONNECTION_REFUSED`.

Tauri will:
1. Compile the Rust lib for `aarch64-linux-android` (~2 min first time, seconds after)
2. Build the Next.js frontend
3. Assemble & install the debug APK on the emulator
4. Launch it with live-reload wired to your localhost dev server

When you change frontend code → hot reload. When you change Rust code →
re-run `pnpm android:dev` (Tauri's Rust HMR is desktop-only).

---

## 4. Release APK (no emulator needed)

```bash
pnpm android:build      # ≡ pnpm tauri android build --target aarch64
```

Output:

```
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab
```

Install on a connected device:

```bash
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
```

---

## Troubleshooting

### "No available Android Emulator detected"

Tauri can't find a running device.

```bash
# 1. Is the emulator actually up?
adb devices                              # must list a "device" (not "offline")

# 2. Is Tauri's adb the same one as yours?
which adb                                # must be under $ANDROID_HOME
ls $ANDROID_HOME/platform-tools/adb      # must exist — if not, your SDK is incomplete

# 3. Two adb servers fighting?
adb kill-server && adb start-server      # restart from canonical $ANDROID_HOME/platform-tools/adb
```

### WebSocket error: `ws://tauri.localhost/_next/webpack-hmr` connection refused

This means the HMR WebSocket is trying to connect through Tauri's Android proxy
at `tauri.localhost`, which doesn't forward WebSocket upgrades.

**Check:**
- Are you using `pnpm android:dev` (with `--host`)? The `--host` flag makes Tauri
  set `TAURI_DEV_HOST` so chunk URLs point to your LAN IP.
- Look for `[HMR] connected` in the WebView console. If missing, Next.js's
  `getAssetPrefix()` returns `""` because all scripts are at root `/_next/` path.
  This causes `getSocketUrl("")` to fall back to `window.location` → `tauri.localhost`.

**Fix is already in `src/app/layout.tsx`:** A synchronous inline script runs
before the Next.js bootstrap and patches `window.WebSocket` to redirect
`tauri.localhost` connections to the actual dev server host (extracted from
any chunk `<script>` URL).

### Hydration mismatch errors in Console

After the chunk-loading fix, React finally loads and tries to hydrate — which
may expose pre-existing SSR/client mismatches. Common cause:

- **`useIsMobile()`** defaults to `false` on the server (no `window`) but
  `true` on the Android WebView. **Fix** is in `src/hooks/useIsMobile.ts` —
  the hook now initializes to `false` on both server and client, then computes
  the real media-query value post-hydration via `useEffect`.

### Download button clicks but nothing happens

If the download button stays at "Download" instead of changing to "Checking...",
React isn't hydrating. Open `chrome://inspect` and check:

1. **Network tab** — do JS chunks load with 200 (from `http://<LAN_IP>:3000`)
   or `ERR_CONNECTION_REFUSED` (from `http://localhost:3000`)?
2. **Console tab** — any red errors?

### `error: instruction requires: fullfp16`

The `+fp16` rustflag isn't reaching cargo. This means `.cargo/config.toml`
is missing from the **project root** (it must NOT live at `src-tauri/.cargo/`
— Tauri's gradle plugin invokes cargo from the project root, and cargo
walks up from CWD, not from `--manifest-path`).

```bash
ls .cargo/config.toml                    # must exist
grep "+fp16" .cargo/config.toml          # must match
```

### `build script failed` / cmake parse errors

Stale `CFLAGS` / `CXXFLAGS` are leaking into the llama.cpp cmake invocation.

```bash
env | grep -E "^CFLAGS|^CXXFLAGS"        # must be empty
unset CFLAGS CXXFLAGS                    # in this shell
# Also remove any `export CFLAGS=...` from ~/.zshrc
```

The POSIX_MADV fix lives in `vendor/llama-cpp-sys-2/llama.cpp/src/llama-mmap.cpp`
(wired in via `[patch.crates-io]` in `src-tauri/Cargo.toml`). You never
need to set `CFLAGS` manually for this project.

### Emulator boots but app shows white screen

Frontend dev server didn't start in time.

```bash
# Check Next.js is up on port 3000 (the devUrl in tauri.conf.json)
curl -s http://localhost:3000 > /dev/null && echo OK || echo "Next.js not running"
```

If it's not running, kill `pnpm android:dev`, run `pnpm dev` manually,
verify port 3000 responds, then re-run `pnpm android:dev`.

### "INSTALL_FAILED_INSUFFICIENT_STORAGE" on emulator

The default Pixel 7 AVD has a small `/data` partition. Wipe and resize:

```bash
emulator -avd Pixel_7_API34 -wipe-data -partition-size 4096
```

### Build is slow / running out of disk

Debug builds eat >2 GB in `target/aarch64-linux-android/debug/`.

```bash
cd src-tauri
cargo clean --target aarch64-linux-android    # nuke android-target artifacts only
```

---

## Quick reference

| Want to... | Command |
|---|---|
| List AVDs | `emulator -list-avds` |
| Boot AVD | `emulator -avd <name> -no-snapshot-load &` |
| Check device online | `adb devices` |
| Dev (live reload frontend) | `pnpm android:dev` |
| Release APK | `pnpm android:build` |
| Install APK on device | `adb install -r <path-to-apk>` |
| Logcat (filter to our app) | `adb logcat \| grep zolorag` |
| Kill emulator | `adb -s emulator-5554 emu kill` |
| Wipe app data on emulator | `adb shell pm clear com.zosmaai.zolorag` |

---

## Files this workflow relies on (do not delete)

- `.cargo/config.toml` — NDK paths, `+fp16` rustflag, force-empty target CFLAGS. **Project root, not `src-tauri/.cargo/`.**
- `src-tauri/Cargo.toml` — `[patch.crates-io] llama-cpp-sys-2 = { path = "../vendor/llama-cpp-sys-2" }`
- `vendor/llama-cpp-sys-2/` — vendored fork with the Bionic POSIX_MADV patch (one file: `llama.cpp/src/llama-mmap.cpp`)
- `src-tauri/gen/android/` — Tauri-generated Gradle project (auto-regenerated by `pnpm tauri android init`, commit it)
