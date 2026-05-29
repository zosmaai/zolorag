# Phase 6.2 (M2): Core ML Cross-Compilation & On-Device Testing

> **Goal:** candle embedding and llama.cpp LLM inference both compile and run on an Android device/emulator.
> **Depends on:** M1 (toolchain working)

---

## Scope

Cross-compile `candle` (embedding model) and `llama.cpp` (via `llama-cpp-2` crate) for `aarch64-linux-android`. Deploy to an emulator or device and verify:
- Embedding inference produces correct vectors (bit-match against desktop output)
- LLM inference produces coherent text at measurable token/s
- Both run on a background thread (no ANR)

## Tasks

### 1. Cross-Compile candle with tokenizers
- [ ] Add `candle-core`, `candle-nn`, `candle-transformers`, `tokenizers` to the Android build config
- [ ] Test: `cargo ndk -t arm64-v8a build -p zolorag --features candle` succeeds
- [ ] Verify `tokenizers` crate works on Android (no `mmap` issues)
- [ ] If `tokenizers` fails, patch or switch to a no-mmap initialization path

### 2. Embedding Verification (Critical)
- [ ] Take a known input string and a known embedding vector from desktop
- [ ] Run the same input through Android build
- [ ] Compare vectors: exact bit-level match (or float tolerance ≤ 1e-5)
- [ ] Document any differences (e.g., due to different BLAS/accelerate backends)

### 3. llama.cpp Cross-Compilation
- [ ] Install Android NDK CMake toolchain
- [ ] Test: `cmake -DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-21 ..`
- [ ] Build llama.cpp `.a` / `.so` for Android
- [ ] Configure `llama-cpp-2` crate to link against the Android build
- [ ] Or: Use `llama-cpp-2` with its built-in `build-llama-cpp` feature + NDK env vars
- [ ] `cargo ndk -t arm64-v8a build` succeeds with `--features llm`

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

---

## Feasibility Checklist (Blocker Detection)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | candle compiles for `aarch64-linux-android` | ☐ | If fails, may need `--cfg` or feature flags |
| 2 | tokenizers crate loads `tokenizer.json` on Android | ☐ | Potential `mmap` issue on older NDK |
| 3 | Embedding output bit-matches desktop | ☐ | If not, floating-point pipeline differs |
| 4 | llama.cpp `.so` or `.a` builds for Android via NDK | ☐ | This is the highest-risk item |
| 5 | `llama-cpp-2` crate links successfully | ☐ | May need build.rs patches |
| 6 | Qwen2.5-1.5B-Q4_K_M loads on a physical device (≥8 GB RAM) | ☐ | |
| 7 | Inference runs at ≥3 tok/s on a representative device | ☐ | |
| 8 | App does NOT ANR during a 60-second generation | ☐ | Background thread is working |
| 9 | Cancelling a generation mid-way doesn't crash | ☐ | |
| 10 | Memory usage stays under 3 GB peak (model + context) | ☐ | |

## Blockers & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| llama.cpp build system doesn't detect NDK | **High** | Use explicit NDK CMake toolchain file; set `CC_aarch64_linux_android`, `CXX_aarch64_linux_android` env vars |
| `llama-cpp-2` crate's build script doesn't support Android | **High** | Fork the crate or write a custom build script that invokes CMake with NDK |
| Memory pressure causes device to kill the app | **High** | Start with smallest viable model (Qwen2.5-0.5B); test on 8 GB device first |
| Float math differences between ARM NEON and x86-64 | Medium | Accept negligible embedding differences; document tolerance |
| `tokenizers` uses `mmap` which behaves differently on Android | Medium | Switch to in-memory loading: `Tokenizer::from_file()` instead of `from_blob()` |

## Success Criteria

- [ ] candle embedding produces identical vectors (within 1e-5 float tolerance) on Android CPU
- [ ] llama.cpp LLM inference runs on-device at ≥3 tok/s (CPU) or ≥8 tok/s (Vulkan)
- [ ] App survives 5 minutes of continuous chat without ANR or crash
- [ ] Model loading completes within 30 seconds on a physical device
- [ ] Peak memory usage ≤ 3 GB for Qwen2.5-1.5B-Q4_K_M

## Exit Criteria

M2 is **complete** when:
1. Both ML components compile and run on Android
2. Embedding vectors are verified correct
3. LLM inference produces reasonable output at a usable speed
4. Background threading is confirmed working (no ANR)
5. Memory profiling data is documented
6. Team reviews the performance data and agrees the numbers are acceptable to proceed
