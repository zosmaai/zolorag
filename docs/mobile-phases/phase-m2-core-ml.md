# Phase 6.2 (M2): Core ML Cross-Compilation & On-Device Testing

> **Goal:** candle embedding and llama.cpp LLM inference both compile and run on an Android device/emulator.
> **Depends on:** M1 (toolchain working)

---

## Carried Over from M1

These blockers were discovered during M1 and are the primary work of M2:

| Blocker | Root Cause | Fix |
|---------|------------|-----|
| 🚫 **gemm-f16 FP16 crash** | `#[target_feature(enable = "fp16")]` inline asm in `gemm-common` needs the `fp16` target feature enabled globally for `aarch64-linux-android` | `RUSTFLAGS="-C target-feature=+fp16"` (already wired in `.cargo/config.toml` for aarch64 target) |
| 🚫 **llama.cpp POSIX_MADV** | Android Bionic libc doesn't define `posix_madvise()` or `POSIX_MADV_*` constants (uses `madvise()` + `MADV_*` instead) | Patch `llama.cpp/src/llama-mmap.cpp`: on `__ANDROID__`, `#define POSIX_MADV_* MADV_*` and `#define posix_madvise(addr,len,advice) madvise(addr,len,advice)` |
| 🚫 **Full `ml` feature build** | `cargo build` (default features) fails because of the two issues above | Once both are fixed, `cargo ndk build --lib` without `--no-default-features` should pass |
| 🚫 **`pnpm tauri android dev`** | Tauri CLI's `dev` command doesn't support `--no-default-features`; blocked on full `ml` build | Deferred until ML crates compile for Android |

---

## Scope

Cross-compile `candle` (embedding model) and `llama.cpp` (via `llama-cpp-2` crate) for `aarch64-linux-android`. Deploy to an emulator or device and verify:
- Embedding inference produces correct vectors (bit-match against desktop output)
- LLM inference produces coherent text at measurable token/s
- Both run on a background thread (no ANR)

Once M2 is complete, `pnpm tauri android dev` becomes usable since the `ml` feature compiles cleanly.

---

## Tasks

### 0. Fix Known Blockers (from M1)
- [ ] **gemm-f16**: Verify `RUSTFLAGS="-C target-feature=+fp16"` is applied (already in `.cargo/config.toml` for `aarch64-linux-android`)
- [ ] **llama.cpp POSIX_MADV**: Patch `llama-mmap.cpp` — add `__ANDROID__` block after `#include <sys/mman.h>`:
  ```c
  #ifdef __ANDROID__
  #ifndef POSIX_MADV_WILLNEED
  #define POSIX_MADV_NORMAL MADV_NORMAL
  #define POSIX_MADV_RANDOM MADV_RANDOM
  #define POSIX_MADV_SEQUENTIAL MADV_SEQUENTIAL
  #define POSIX_MADV_WILLNEED MADV_WILLNEED
  #define POSIX_MADV_DONTNEED MADV_DONTNEED
  #endif
  #ifndef posix_madvise
  #define posix_madvise(addr, len, advice) madvise(addr, len, advice)
  #endif
  #endif
  ```
  This must be done via a proper mechanism:
  - Fork `llama-cpp-sys-2` and apply the patch, then `[patch.crates-io]` in Cargo.toml
  - OR use `cargo`'s `[patch]` section with a local fork
  - OR set `CXXFLAGS` / `CFLAGS` to define these constants (check if llama-cpp-sys-2's CMake build picks up env vars)
- [ ] **Full build test**: `cargo ndk -t arm64-v8a build --lib && cargo check --lib` (desktop) both pass

### 1. Cross-Compile candle with tokenizers
- [ ] candle-core, candle-nn, candle-transformers, tokenizers already behind `ml` feature — verify they compile with `RUSTFLAGS="-C target-feature=+fp16"`
- [ ] Test: `cargo ndk -t arm64-v8a build --lib` (with default features, includes `ml`)
- [ ] Verify `tokenizers` crate works on Android (no `mmap` issues)
- [ ] If `tokenizers` fails, patch or switch to a no-mmap initialization path

### 2. Embedding Verification (Critical)
- [ ] Take a known input string and a known embedding vector from desktop
- [ ] Run the same input through Android build
- [ ] Compare vectors: exact bit-level match (or float tolerance ≤ 1e-5)
- [ ] Document any differences (e.g., due to different BLAS/accelerate backends)

### 3. llama.cpp Cross-Compilation
- [ ] Verify NDK CMake toolchain is available at `$ANDROID_NDK/build/cmake/android.toolchain.cmake`
- [ ] Verify llama-cpp-sys-2 build.rs detects `ANDROID_NDK` env var (set in `~/.zshrc`)
- [ ] Test first clean build: `cargo ndk -t arm64-v8a build --lib` (should now survive past POSIX_MADV)
- [ ] If llama-cpp-sys-2 build fails, debug CMake flags and env vars

### 4. Model Loading on Device
- [ ] Copy a small GGUF model (e.g., Qwen2.5-1.5B-Q4_K_M ~1 GB) to device via `adb push`
- [ ] Load the model in Rust from the device filesystem
- [ ] Verify model loading completes without crash or OOM
- [ ] Measure peak memory usage during model load

### 5. LLM Inference on Device
- [ ] Run a single generate() call on device
- [ ] Verify output text is coherent (same as desktop output for same prompt)
- [ ] Measure tokens/second on emulator and physical device
- [ ] Test with context window of 2048 tokens (memory stress test)

### 6. Background Thread Safety
- [ ] Wrap LLM `generate()` in `tokio::spawn_blocking` or dedicated `std::thread`
- [ ] Verify frontend streaming events still arrive during generation
- [ ] Verify the app does NOT ANR during a 30-second generation
- [ ] Test cancellation: drop the generation mid-way, verify no crash

### 7. Memory Profiling
- [ ] Measure peak RSS for model loading (GGUF file loaded into memory)
- [ ] Measure peak RSS during inference (context + KV cache)
- [ ] Verify total memory usage fits within 3 GB on an 8 GB device
- [ ] Document memory requirements by model size

### 8. Verify `pnpm tauri android dev` 
- [ ] After ML crates compile, run `pnpm tauri android dev` (without `--no-default-features`)
- [ ] Verify hot-reload works for Rust changes
- [ ] Verify hot-reload works for frontend changes

---

## Feasibility Checklist

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | gemm-f16 compiles with `+fp16` RUSTFLAGS | ☐ | Already configured in `.cargo/config.toml` |
| 2 | llama.cpp compiles with POSIX_MADV patch | ☐ | Need to decide: fork vs patch vs CFLAGS |
| 3 | `cargo ndk build --lib` (default features) succeeds | ☐ | This is the main "full build" test |
| 4 | candle compiles for `aarch64-linux-android` | ☐ | |
| 5 | tokenizers crate loads `tokenizer.json` on Android | ☐ | Potential `mmap` issue on older NDK |
| 6 | Embedding output bit-matches desktop | ☐ | If not, floating-point pipeline differs |
| 7 | llama.cpp `.so` or `.a` builds for Android via NDK | ☐ | This is the highest-risk item |
| 8 | `llama-cpp-2` crate links successfully | ☐ | May need build.rs patches |
| 9 | Qwen2.5-1.5B-Q4_K_M loads on a physical device (≥8 GB RAM) | ☐ | |
| 10 | Inference runs at ≥3 tok/s on a representative device | ☐ | |
| 11 | App does NOT ANR during a 60-second generation | ☐ | Background thread is working |
| 12 | Cancelling a generation mid-way doesn't crash | ☐ | |
| 13 | Memory usage stays under 3 GB peak (model + context) | ☐ | |
| 14 | `pnpm tauri android dev` works (hot-reload) | ☐ | **Final M2 validation** |

## Blockers & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| llama.cpp build system doesn't detect NDK | **High** | Use explicit NDK CMake toolchain file; set `CC_aarch64_linux_android`, `CXX_aarch64_linux_android` env vars |
| `llama-cpp-2` crate's build script doesn't support Android | **High** | Fork the crate or write a custom build script that invokes CMake with NDK |
| Memory pressure causes device to kill the app | **High** | Start with smallest viable model (Qwen2.5-0.5B); test on 8 GB device first |
| Float math differences between ARM NEON and x86-64 | Medium | Accept negligible embedding differences; document tolerance |
| `tokenizers` uses `mmap` which behaves differently on Android | Medium | Switch to in-memory loading: `Tokenizer::from_file()` instead of `from_blob()` |
| Disk space during builds | Medium | llama.cpp CMake build + Rust debug artifacts can consume 10+ GB. Clean `target/` between major attempts. |

## Success Criteria

- [ ] candle embedding produces identical vectors (within 1e-5 float tolerance) on Android CPU
- [ ] llama.cpp LLM inference runs on-device at ≥3 tok/s (CPU) or ≥8 tok/s (Vulkan)
- [ ] App survives 5 minutes of continuous chat without ANR or crash
- [ ] Model loading completes within 30 seconds on a physical device
- [ ] Peak memory usage ≤ 3 GB for Qwen2.5-1.5B-Q4_K_M
- [ ] `pnpm tauri android dev` launches on emulator with full ML support

## Exit Criteria

M2 is **complete** when:
1. Both ML components compile and run on Android
2. Embedding vectors are verified correct
3. LLM inference produces reasonable output at a usable speed
4. Background threading is confirmed working (no ANR)
5. Memory profiling data is documented
6. `pnpm tauri android dev` works end-to-end
7. Team reviews the performance data and agrees the numbers are acceptable to proceed
