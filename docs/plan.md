# zoloRAG — Updated Plan: Rust-Native Model Inference

> **Context:** Phase 1-3 built the full RAG pipeline using Ollama as the model runtime. This plan replaces Ollama with **in-process Rust-native inference** using `candle` + GGUF, making the app fully self-contained — no external dependencies, one installer.

---

## The Problem with Ollama

| Issue | Impact |
|-------|--------|
| **External dependency** | User must install Ollama separately before using zoloRAG |
| **Two processes** | LLM runs in a separate server, adds IPC overhead and startup latency |
| **External dependency** | User must install, update, and troubleshoot Ollama separately |
| **No bundling** | Can't ship a single .exe that "just works" |
| **Update coupling** | Ollama updates can break zoloRAG |

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    zoloRAG (Single Process)                  │
│                                                             │
│  ┌──────────────────┐    ┌──────────────────────────────┐   │
│  │  PDF Parser       │    │  Model Runtime (candle +     │   │
│  │  (lopdf +         │    │  llama-cpp-rs)              │   │
│  │   pdf-extract)    │    │                              │   │
│  └────────┬─────────┘    │  ┌────────────────────────┐  │   │
│           │              │  │  Embedding Model        │  │   │
│           ▼              │  │  (all-MiniLM-L6-v2,      │  │   │
│  ┌──────────────────┐   │  │   384-dim, ~80MB GGUF)   │  │   │
│  │  Chunker          │   │  └───────────┬────────────┘  │   │
│  │  (paragraph/      │   │              │                │   │
│  │   sentence split) │   │  ┌───────────▼────────────┐  │   │
│  └────────┬─────────┘   │  │  LLM                    │  │   │
│           │              │  │  (Phi-3-mini / Qwen2.5  │  │   │
│           ▼              │  │   1.5B / Llama 3.2 3B,  │  │   │
│  ┌──────────────────┐   │  │   Q4_K_M GGUF)          │  │   │
│  │  BitIndex         │   │  └───────────┬────────────┘  │   │
│  │  (Hamming →       │   │              │                │   │
│  │   cosine →        │   └──────────────┴────────────────┘   │
│  │   keyword blend)  │                                      │
│  └────────┬─────────┘                                      │
│           │                                                  │
│           ▼                                                  │
│  ┌──────────────────┐    ┌──────────────────────────────┐   │
│  │  Context Builder  │───▶│  LLM.generate()              │   │
│  │  (chunks →        │    │  (streaming tokens via       │   │
│  │   prompt)         │    │   callback → Tauri events)   │   │
│  └──────────────────┘    └──────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Single binary. No Python. No Ollama. No sidecars.    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Model Selection for Bundled Deployment

### Embedding Model (Fixed — Always Bundled)

| Model | Format | Size | Quality | Speed |
|-------|--------|:----:|:-------:|:-----:|
| **all-MiniLM-L6-v2** | GGUF (Q8) | **~85 MB** | Good (384-dim) | ⚡ Very fast |

Chosen because it's what AskBit uses, 384-dim is optimal for bit packing (6 × u64), and it runs in <50ms on CPU via `candle`.

### LLM — Desktop Only

| Model | Size | Quality | Desktop CPU (4 cores) | RAM |
|-------|:----:|:-------:|:---------------------:|:---:|
| **Llama 3.2-3B Q4_K_M** | ~1.8 GB | ⭐⭐⭐⭐ | 10-18 tok/s | ~2.5 GB |
| **Phi-3-mini (3.8B) Q4_K_M** | ~2.5 GB | ⭐⭐⭐⭐ | 8-15 tok/s | ~3 GB |
| **Qwen2.5-1.5B Q4_K_M** | ~1.0 GB | ⭐⭐⭐ | 15-25 tok/s | ~1.5 GB |
| **Gemma-2B Q4_K_M** | ~1.2 GB | ⭐⭐⭐ | 12-20 tok/s | ~1.8 GB |

**Default:** Llama 3.2-3B Q4_K_M — best quality/size tradeoff for office PCs with 8+ GB RAM.
**Low-RAM fallback:** Qwen2.5-1.5B Q4_K_M — for machines with 4-6 GB RAM.

> 🎯 **Mobile is explicitly deferred.** The entire focus is mid-range office PCs (Windows 10/11, macOS, Linux) with 8-16 GB RAM and 4-8 CPU cores. Mobile will only be considered after the desktop app has proven product-market fit.

---

## Rust Crates for Native Inference

### For the Embedding Model

| Crate | Why |
|-------|-----|
| `candle` | HuggingFace's Rust ML framework. Loads safetensors/GGUF. Supports BERT embeddings natively. |
| `candle-nn` | Neural network primitives for embedding forward pass. |
| `candle-transformers` | BERT model architecture (all-MiniLM = MiniLM = BERT variant). |
| `tokenizers` | HuggingFace tokenizers in Rust. Needed for text→token conversion. |

**Status:** `candle` has working examples for all-MiniLM-L6-v2 (see [candle-examples](https://github.com/huggingface/candle/tree/main/candle-examples)). The embedding pipeline is ~50 lines of Rust.

**Replaces:** `OllamaEncoder` in `encoder.rs` — instead of HTTP POST to Ollama, call `candle` forward pass directly.

### For the LLM

| Crate | Why |
|-------|-----|
| `candle` | Also supports Llama/Phi/Qwen architectures via `candle-transformers` |
| OR `llama-cpp-rs` | Rust bindings for llama.cpp. More battle-tested for LLM inference, GGUF native, supports GPU acceleration. |

**Recommendation:** `llama-cpp-rs` (bindings to llama.cpp) because:
- Most optimized CPU inference (AVX2/NEON, BLAS)
- GGUF format native (de facto standard for local LLMs)
- Quantization (Q4_K_M) built in
- Streaming generation via callback
- Battle-tested on Windows, macOS, Linux

**Replaces:** `OllamaChatClient` in `ollama.rs` — instead of HTTP POST to Ollama, call `llama.cpp` inference directly.

---

## Implementation Plan

### Phase A: Replace Embedding Model (Easier — ~1 week)

**Goal:** Remove Ollama dependency for embeddings. Run all-MiniLM-L6-v2 in-process via `candle`.

**What changes:**
1. Add `candle`, `candle-nn`, `candle-transformers`, `tokenizers` to `Cargo.toml` (~4 new crates)
2. Create `src-tauri/src/ml/embed.rs` — wraps `candle` BERT inference:
   - Loads GGUF model file (bundled or downloaded on first run)
   - Tokenizes input text
   - Runs forward pass → 384-dim float vector
   - Returns same `EncodedVector { bit_vector, float_vector }` as current encoder
3. Modify `src-tauri/src/index/encoder.rs` — swap HTTP-based `OllamaEncoder` for native `CandleEncoder`
4. Create model download manager (downloads GGUF from HuggingFace on first launch)

**Key file to study:** `candle/examples/bert/main.rs` — shows how to load MiniLM and get embeddings.

**No changes to:** `index.rs`, `context.rs`, `chat.rs`, frontend. The `EncodedVector` interface stays identical.

### Phase B: Replace LLM (Harder — ~2-3 weeks)

**Goal:** Remove Ollama dependency for chat. Run a quantized LLM in-process via `llama-cpp-rs`.

**What changes:**
1. Add `llama-cpp-rs` to `Cargo.toml` (Rust bindings + needs llama.cpp C++ lib compiled)
2. Create `src-tauri/src/ml/llm.rs` — wraps llama.cpp inference:
   - Loads GGUF model file (~1-3 GB depending on model)
   - Provides `generate(prompt, callback)` for streaming token generation
   - Configurable context window, temperature, top-k, etc.
3. Modify `src-tauri/src/rag/ollama.rs` — swap HTTP-based chat client for native `LlmEngine`
4. Model download manager for LLM (prompts user to download ~2 GB on first launch)

**Challenges:**
- Compiling llama.cpp for all targets (macOS, Windows, Linux) + architectures (x64, ARM64)
- ~3 GB download for the LLM on first run (need good UX with progress, pause/resume)
- RAM usage: ~2-4 GB for a 3B Q4 model (need to ensure other apps can coexist)

### Phase C: Mobile — EXPLICITLY DEFERRED

> **Not in scope. Will not be built until the desktop version has proven product-market fit.**
> Prerequisites for even discussing mobile:
> 1. zoloRAG has 1,000+ active desktop users
> 2. The desktop bundling pipeline (Phase A + B) is stable across Windows, macOS, Linux
> 3. User feedback clearly demands a mobile version
>
> Until then, every engineering hour goes into making the desktop experience flawless.

---

## Feasibility Assessment

### ✅ Green — Definitely Feasible (1-2 weeks)

| Item | Evidence |
|------|----------|
| **Embedding model in candle** | Working example in `candle/examples/bert/`. 50 lines of Rust. Same model, same output. |
| **GGUF model download** | Simple HTTP download from HuggingFace. Same pattern as current `pull_model()`. |
| **Remove Ollama from index pipeline** | `EncodedVector` interface is already abstract. Swap implementation behind same trait. |
| **Model bundling in installer** | Embedding model (~85 MB) can ship in the installer. Or download on first launch. |

### 🟡 Medium Risk — Feasible with Effort (2-4 weeks)

| Item | Risk | Mitigation |
|------|------|------------|
| **llama-cpp-rs compilation** | Needs native C++ lib compiled per platform + arch. CI complexity. | Use pre-built binaries from llama.cpp releases. Or use `candle` for LLM too (pure Rust, no C++). |
| **LLM RAM usage (2-4 GB)** | User might have 8 GB total. App + LLM + browser = swap thrash. | Detect RAM on startup. Suggest smaller model (Qwen2.5-1.5B) for low-RAM machines. |
| **First-run download (~2 GB)** | User expects instant install, gets 5-15 min download. | Show clear progress, estimated time, resume support. Download in background while user sets up. |
| **Cross-platform GGUF compatibility** | GGUF format versioning across llama.cpp versions. | Pin llama.cpp version. Test on all 3 OS before release. |

### ❌ High Risk / Not Yet Feasible

| Item | Why | Path Forward |
|------|-----|-------------|
| **Bundle LLM in installer (~2 GB)** | Installer would be 2+ GB. Users won't download it. | Download on first launch (like Ollama does). Show clear size + progress upfront. |
| **Mobile support** | Mobile is not in scope. Desktop PMF first. | Revisit after 1000+ desktop users. |

---

## Model Download Strategy

Users won't tolerate downloading gigabytes before they can try the app. Strategy:

### First Launch Flow

```
1. Install zoloRAG (~6 MB binary)
2. Open app → welcome screen
   ┌──────────────────────────────────────────┐
   │  Welcome to zoloRAG!                      │
   │                                          │
   │  zoloRAG needs to download two AI        │
   │  models to run locally:                   │
   │                                          │
   │  📦 Embedding model: 85 MB (required)    │
   │  📦 Language model: 1.8 GB (required)    │
   │                                          │
   │  After download, everything works        │
   │  fully offline.                           │
   │                                          │
   │  [📥 Download (~5-15 min)]               │
   │  [💻 I'll download later (limited mode)] │
   └──────────────────────────────────────────┘
3. "Limited mode" = load PDF, browse pages, but no search/chat until model downloads
4. After download → auto-index PDF if one was loaded → chat ready
```

### Download UX Requirements

- Progress bar with MB/s + ETA
- Pause/resume support (large downloads can fail on flaky connections)
- Resume from partial download on app restart
- Storage space check before starting

---

## Updated Timeline

| Phase | What | Time | Dependencies |
|-------|------|:----:|-------------|
| **A** | Candle embedding (replace Ollama for embeddings) | ~1 week | `candle` crate experience |
| **B** | llama-cpp-rs LLM (replace Ollama for chat) | ~2-3 weeks | C++ build toolchain per platform |
| **C** | Model download manager + first-run UX | ~1 week | Phase A + B |
**Desktop MVP (Phase A + B + C): ~4-5 weeks**

---

## Comparison: Ollama vs Bundled

| Factor | Ollama (Current) | Bundled (Target) |
|--------|:----------------:|:----------------:|
| Setup complexity | User installs Ollama + pull models | Install one binary |
| Startup latency | ~1s (wait for Ollama server) | ~200ms (in-process) |
| Query latency (embedding) | ~50ms + HTTP overhead | ~30ms (native) |
| Query latency (LLM) | ~100ms first token + HTTP | ~50ms first token (native) |
| RAM overhead | Ollama keeps model loaded (+~3 GB) | Single process, same RAM |
| CPU overhead | 2 processes, IPC scheduling | 1 process, no IPC |
| Mobile support | ❌ Not possible | ❌ Not in scope (desktop first) |
| Installer size | ~6 MB (app only) | ~6 MB + 85 MB (embedding model) |
| First-run download | User pulls 2 models manually | Automatic download with UI |
| Build complexity | Simple (HTTP calls) | Medium (C++ ML libs + Rust FFI) |

---

> 🎯 **TARGET USER:** Office worker with a mid-range Windows laptop (8-16 GB RAM, 4-8 cores, no GPU).
> **NOT targeting:** Mobile, Raspberry Pi, low-RAM machines (<4 GB), GPU-accelerated setups.
> **Windows is the primary target.** macOS and Linux follow, but Windows 10/11 office PCs are where the need is greatest and the testing must be most thorough.

## What Stays the Same

The entire frontend, the `BitIndex` / `TermIndex` / hybrid search, the `ContextBuilder`, the `ChatHistory`, the `SourcePanel` — none of these change. The interface between the model runtime and the pipeline is already abstracted:

```
Current (Ollama):          Target (Native):
  index/encoder.rs  ─→      ml/embed.rs
  rag/ollama.rs     ─→      ml/llm.rs
```

Both provide the same outputs (`EncodedVector` for embed, `Vec<String>` tokens for LLM). The rest of the app doesn't care which backend produces them.
