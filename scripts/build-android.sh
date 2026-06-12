#!/bin/bash
# Build ZoloRAG for Android (arm64-v8a)
#
# Usage:
#   ./scripts/build-android.sh              # Release APK
#   ./scripts/build-android.sh --dev         # Dev build + deploy to emulator
#
# Prerequisites:
#   - ANDROID_HOME, ANDROID_NDK set in ~/.zshrc
#   - Rust target aarch64-linux-android installed
#   - cargo-ndk installed
#   - Emulator running (for --dev)

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="aarch64"

# ── Required for llama.cpp on Android (POSIX_MADV not in Bionic) ────
export CXXFLAGS="-DPOSIX_MADV_NORMAL=MADV_NORMAL \
  -DPOSIX_MADV_RANDOM=MADV_RANDOM \
  -DPOSIX_MADV_SEQUENTIAL=MADV_SEQUENTIAL \
  -DPOSIX_MADV_WILLNEED=MADV_WILLNEED \
  -DPOSIX_MADV_DONTNEED=MADV_DONTNEED \
  -Dposix_madvise\(addr,len,advice\)=madvise\(addr,len,advice\)"
export CFLAGS="$CXXFLAGS"

# ── Build ────────────────────────────────────────────────────────────
cd "$PROJECT_DIR"

if [ "${1:-}" = "--dev" ]; then
  echo "🔧 Building dev APK and deploying to emulator..."
  ANDROID_NDK="${ANDROID_NDK}" pnpm tauri android dev
else
  echo "📦 Building release APK..."
  ANDROID_NDK="${ANDROID_NDK}" pnpm tauri android build --target "$TARGET" --ci
  echo "✅ Done! APK at: src-tauri/gen/android/app/build/outputs/apk/universal/release/"
fi
