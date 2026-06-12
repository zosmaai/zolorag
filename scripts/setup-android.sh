#!/usr/bin/env bash
# setup-android.sh — One-time Android build environment setup
#
# Run this once after cloning or after `cargo update` bumps llama-cpp-sys-2.
# It applies the POSIX_MADV Android patch directly to the local cargo registry
# so that `pnpm tauri android dev --release` and `cargo ndk` work without any
# CFLAGS/CXXFLAGS env vars.
#
# Usage: bash scripts/setup-android.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PATCH_FILE="$REPO_ROOT/patches/llama-mmap-android.patch"

# ── 1. Locate llama-cpp-sys-2 in the cargo registry ──────────────────────────
REGISTRY_DIR="$HOME/.cargo/registry/src"

# Find all versions (newest first) in case multiple versions are cached
LLAMA_SYS_DIR=$(find "$REGISTRY_DIR" -maxdepth 2 -name "llama-cpp-sys-2-*" -type d 2>/dev/null \
  | sort -rV | head -1)

if [ -z "$LLAMA_SYS_DIR" ]; then
  echo "❌ llama-cpp-sys-2 not found in cargo registry."
  echo "   Run 'cd src-tauri && cargo fetch' first, then re-run this script."
  exit 1
fi

echo "Found: $LLAMA_SYS_DIR"
MMAP_FILE="$LLAMA_SYS_DIR/llama.cpp/src/llama-mmap.cpp"

if [ ! -f "$MMAP_FILE" ]; then
  echo "❌ Expected file not found: $MMAP_FILE"
  exit 1
fi

# ── 2. Check if patch already applied ────────────────────────────────────────
if grep -q "__ANDROID__" "$MMAP_FILE"; then
  echo "✅ Android POSIX_MADV patch already applied — nothing to do."
  exit 0
fi

# ── 3. Apply patch ────────────────────────────────────────────────────────────
echo "Applying Android POSIX_MADV patch..."

# The patch paths are relative to the llama-cpp-sys-2 root (a/llama.cpp/src/...)
# so cd into it and apply with -p1 to strip the a/ b/ prefix
(cd "$LLAMA_SYS_DIR" && patch -p1 < "$PATCH_FILE")

# Verify
if grep -q "__ANDROID__" "$MMAP_FILE"; then
  echo "✅ Patch applied successfully to:"
  echo "   $MMAP_FILE"
else
  echo "❌ Patch application may have failed — __ANDROID__ guard not found."
  exit 1
fi

# ── 4. Remind about build command ─────────────────────────────────────────────
cat <<'EOF'

─────────────────────────────────────────────────────────
Android build command (always strip poisoned env vars):

  env -u CFLAGS -u CXXFLAGS \
    ANDROID_NDK=$HOME/Library/Android/sdk/ndk/29.0.14206865 \
    pnpm tauri android dev --release

  # or for a one-off lib build:
  env -u CFLAGS -u CXXFLAGS \
    ANDROID_NDK=... cargo ndk -t arm64-v8a build --lib --release

⚠️  If CFLAGS/CXXFLAGS are set in your shell (from old env-var workaround
    sessions), the parentheses in -Dposix_madvise(...) break cmake on macOS.
    Always use `env -u CFLAGS -u CXXFLAGS` prefix for Android builds.
─────────────────────────────────────────────────────────
EOF
