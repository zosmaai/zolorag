# Phase 5: Native LLM Inference (Ollama → llama-cpp-rs)

> **Pre-requisite:** Phase 4 is complete and validated. The embedding model runs in-process via `candle` with confirmed ranking quality. Phase 5 replaces the **LLM** — the last Ollama dependency.

---

## End State

- zoloRAG is a **single process** with zero external dependencies
- Embedding: `candle` + all-MiniLM-L6-v2 GGUF (~85 MB)
- LLM: `llama-cpp-rs` + Llama 3.2-3B Q4_K_M GGUF (~1.8 GB)
- Model download: automatic on first launch with progress, pause/resume
- No Python, no Ollama, no HTTP calls for model inference

```
┌─────────────────────────────────────────────────────┐
│                  zoloRAG (Single Process)            │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  Model Runtime                              │    │
│  │                                             │    │
│  │  ┌──────────────────────┐                   │    │
│  │  │  ml/embed.rs         │  ← Phase 4 (done) │    │
│  │  │  CandleEncoder       │                   │    │
│  │  │  (all-MiniLM GGUF)   │                   │    │
│  │  └──────────┬───────────┘                   │    │
│  │             │                               │    │
│  │  ┌──────────▼───────────┐                   │    │
│  │  │  ml/llm.rs           │  ← Phase 5 (this) │    │
│  │  │  LlamaCppEngine      │                   │    │
│  │  │  (Llama 3.2-3B GGUF) │                   │    │
│  │  └──────────────────────┘                   │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  Rest of pipeline (unchanged from Phases    │    │
│  │  1-3): BitIndex, TermIndex, hybrid search,  │    │
│  │  ContextBuilder, ChatHistory, SourcePanel   │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

---

## Architecture Change

```
Before (Ollama):
  ContextBuilder → prompt messages
       │
       ▼
  ┌──────────────────────────┐
  │  OllamaChatClient         │
  │  (HTTP POST to            │
  │   localhost:11434         │
  │   /api/chat?stream=true)  │
  │  → NDJSON stream          │
  │  → rag:token events       │
  └──────────────────────────┘

After (llama-cpp-rs):
  ContextBuilder → prompt string
       │
       ▼
  ┌──────────────────────────┐
  │  LlamaCppEngine           │
  │  (in-process,             │
  │   llama.cpp via Rust FFI) │
  │  → token callback         │
  │  → rag:token events       │
  └──────────────────────────┘
```

**Key invariant:** Both produce the same event stream (`rag:token`, `rag:done`, `rag:error`). The frontend **does not change**.

---

## Implementation

### New Module: `src-tauri/src/ml/llm.rs`

```rust
use llama_cpp_rs::LlamaModel;
use llama_cpp_rs::options::{ModelOptions, PredictOptions};
use std::path::Path;
use tauri::Emitter;

pub struct LlamaCppEngine {
    model: LlamaModel,
    model_name: String,
}

impl LlamaCppEngine {
    /// Load a GGUF model file.
    /// Model file must be downloaded before calling this.
    pub fn new(model_path: &Path) -> Result<Self, String> {
        let options = ModelOptions {
            n_gpu_layers: 0,          // CPU-only
            n_ctx: 4096,              // 4K context window
            use_mmap: true,           // Memory-map for fast load
            use_mlock: false,         // Don't lock memory (office PC friendly)
            ..Default::default()
        };

        let model = LlamaModel::load_from_file(model_path, &options)
            .map_err(|e| format!("Failed to load LLM: {e}"))?;

        Ok(Self {
            model,
            model_name: "llama3.2-3b-q4".into(),
        })
    }

    /// Generate tokens, streaming via a callback.
    pub fn generate(
        &self,
        prompt: &str,
        mut on_token: impl FnMut(&str),
    ) -> Result<String, String> {
        let options = PredictOptions {
            temperature: 0.7,
            top_k: 40,
            top_p: 0.9,
            max_tokens: 1024,
            stop_prompts: vec![],
            ..Default::default()
        };

        let mut full = String::new();
        self.model
            .predict(prompt, options, |token| {
                full.push_str(token);
                on_token(token);
                true // continue generation
            })
            .map_err(|e| format!("Generation failed: {e}"))?;

        Ok(full)
    }
}
```

### Streaming Integration

The existing `OllamaChatClient` in `rag/ollama.rs` is replaced. The new `LlamaCppEngine` produces tokens via a callback instead of parsing an HTTP stream:

```rust
// rag/ollama.rs — REPLACED by ml/llm.rs

// Old: HTTP POST → parse NDJSON → emit events
pub async fn stream_chat(&self, messages: &[Value], app: &AppHandle) -> Result<String, String> {
    let response = self.client.post(...).send().await?;
    let mut stream = response.bytes_stream();
    // ...parse each chunk, emit rag:token...
}

// New: in-process inference → callback → emit events
pub fn stream_chat(&self, prompt: &str, app: &AppHandle) -> Result<String, String> {
    self.engine.generate(prompt, |token| {
        let _ = app.emit("rag:token", token.to_string());
    })
}
```

**Key change:** The `messages` parameter format changes. Ollama's `/api/chat` uses a JSON messages array:

```json
[
  {"role": "system", "content": "..."},
  {"role": "user", "content": "..."}
]
```

llama.cpp uses a flat prompt string. The `ContextBuilder` needs a new method:

```rust
impl ContextBuilder {
    /// Format messages into a single prompt string for llama.cpp.
    /// Uses the chat template format (e.g., Llama 3 instruct format).
    pub fn build_prompt(&self, query: &str, chunks: &[SearchResult], history: &[ChatMessage]) -> String {
        let mut prompt = String::new();
        prompt.push_str("<|begin_of_text|>");
        prompt.push_str("<|start_header_id|>system<|end_header_id|>\n\n");
        prompt.push_str(&self.system_prompt);
        prompt.push_str("\n\nContext:\n");
        prompt.push_str(&self.format_context(chunks));
        prompt.push_str("<|eot_id|>");

        for msg in history {
            let role = match msg.role {
                Role::User => "user",
                Role::Assistant => "assistant",
            };
            prompt.push_str(&format!("<|start_header_id|>{}<|end_header_id|>\n\n{}<|eot_id|>", role, msg.content));
        }

        prompt.push_str("<|start_header_id|>user<|end_header_id|>\n\n");
        prompt.push_str(query);
        prompt.push_str("<|eot_id|>");
        prompt.push_str("<|start_header_id|>assistant<|end_header_id|>\n\n");

        prompt
    }
}
```

> The exact chat template format depends on the chosen model. Llama 3 uses `<|begin_of_text|>`, `<|start_header_id|>`, `<|end_header_id|>`, `<|eot_id|>`. Phi-3 uses a different format. The template must match the model.

---

## Model Download Manager

### Phase 5 adds the full download UX

```
src-tauri/src/ml/
├── mod.rs           # Module root
├── embed.rs         # CandleEncoder (Phase 4)
├── llm.rs           # LlamaCppEngine (Phase 5)
└── download.rs      # Model download manager
```

### `ml/download.rs` — Download Manager

```rust
/// Download a model from HuggingFace, with progress reporting.
pub fn download_model(
    url: &str,
    dest: &Path,
    on_progress: impl Fn(u64, u64),  // bytes_downloaded, total_bytes
) -> Result<(), String> {
    // HTTP GET with range request support for resume
    // Stream to temp file, rename on completion
    // Emit progress via callback
}
```

### First-Run Wizard UI

The frontend shows a download screen when models are missing:

```
┌──────────────────────────────────────────────────┐
│  🧠 Setting up zoloRAG                           │
│                                                  │
│  ┌──────────────────────────────────────────────┐│
│  │  📦 Embedding model (85 MB)  ✅ Done         ││
│  │  ████████████████████████████████ 100%        ││
│  └──────────────────────────────────────────────┘│
│                                                  │
│  ┌──────────────────────────────────────────────┐│
│  │  🤖 Language model (1.8 GB)  ⬇️ Downloading  ││
│  │  ████████████████░░░░░░░░░░░░░  62%          ││
│  │  1.1 GB / 1.8 GB · 4.2 MB/s · 2 min left    ││
│  │                                              ││
│  │  [⏸ Pause]  [Cancel]                        ││
│  └──────────────────────────────────────────────┘│
│                                                  │
│  Model will run entirely offline once            │
│  download completes.                             │
└──────────────────────────────────────────────────┘
```

---

## App State Changes

```rust
struct AppState {
    // Phase 4: candle encoder (replaces OllamaEncoder)
    candle_encoder: CandleEncoder,

    // NEW: llama-cpp engine (replaces llm_client)
    llm_engine: Option<LlamaCppEngine>,

    // Phase 1-3 fields (unchanged):
    current_document: ...,
    current_chunks: ...,
    bit_index: ...,
    index_path: ...,
    chat_history: ...,
    context_builder: ...,
    last_sources: ...,

    // REMOVED:
    // encoder: OllamaEncoder,          ← replaced by candle_encoder
    // llm_client: OllamaChatClient,    ← replaced by llm_engine
}
```

### Command Changes

| Command | Before | After |
|---------|--------|-------|
| `index_document` | `state.encoder.encode_batch()` | `state.candle_encoder.encode_batch()` |
| `query_index` | `state.encoder.encode()` | `state.candle_encoder.encode()` |
| `ask_question` | `state.encoder.encode()` + `state.llm_client.stream_chat()` | `state.candle_encoder.encode()` + `state.llm_engine.generate()` |
| `check_model` | Checks Ollama + all-minilm | Checks if model files exist on disk |
| `pull_embedding_model` | Ollama API pull | Download GGUF from HuggingFace |
| `check_llm_model` | Checks Ollama + llama3.2:3b | Checks if GGUF file exists |
| `pull_llm_model` | Ollama API pull | Download GGUF from HuggingFace |
| `clear_chat` | Unchanged | Unchanged |
| `get_sources` | Unchanged | Unchanged |

---

## Dependencies to Add

| Crate | Type | Size | Purpose |
|-------|:----:|:----:|---------|
| `llama-cpp-rs` | Rust crate + C++ lib | ~15 MB compiled | llama.cpp bindings for Rust |

**Build complexity:** `llama-cpp-rs` compiles llama.cpp C++ source during `cargo build`. This requires:
- **macOS:** Xcode CLI tools (clang, cmake) — already present for Rust development
- **Linux:** build-essential, cmake
- **Windows:** MSVC build tools (Visual Studio Build Tools or LLVM/clang-cl)

The first build takes 5-15 minutes (compiling llama.cpp C++). Subsequent builds are cached.

### Pre-built Binary Strategy

To avoid forcing every user to compile C++, provide pre-built `llama.cpp` libraries:

```
src-tauri/libs/
├── x86_64-linux/libllama.so
├── x86_64-windows/llama.dll
├── x86_64-macos/libllama.dylib
└── aarch64-macos/libllama.dylib
```

These are downloaded in CI and linked at build time, bypassing the C++ compilation step for developers.

---

## Chat Template Compatibility

Different models use different chat templates. The `ContextBuilder` must match:

| Model | Template Format |
|-------|----------------|
| **Llama 3.2** | `<\|begin_of_text\|><\|start_header_id\|>system<\|end_header_id\|>\n\n...<\|eot_id\|>\n<\|start_header_id\|>user<\|end_header_id\|>\n\n...<\|eot_id\|>\n<\|start_header_id\|>assistant<\|end_header_id\|>\n\n` |
| **Phi-3** | `<\|user\|>\n...<\|end\|>\n<\|assistant\|>\n` |
| **Qwen2.5** | `<|im_start|>system\n...<|im_end|>\n<|im_start|>user\n...<|im_end|>\n<|im_start|>assistant\n` |

The default is Llama 3.2 format. Model selection in settings switches the template.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **llama-cpp-rs build fails** | Can't compile on Windows without MSVC | Provide pre-built .dll/.so/.dylib in CI artifacts |
| **2 GB download on first run** | User churn if download is too slow | Show ETA, support pause/resume, offer "download later" limited mode |
| **RAM usage (2-4 GB)** | Swap thrash on 8 GB machines | Default to 1.5B model for <8 GB RAM. Detect RAM at startup. |
| **Chat template mismatch** | Garbage output from wrong format | Test with the exact model before shipping. Support multiple templates. |
| **Tokenizer mismatch** | Wrong tokenization → wrong output | llama.cpp reads tokenizer from GGUF file. Must match. |
| **Performance regressions** | Slower than Ollama | llama.cpp is as fast or faster (no IPC overhead). Benchmark. |
| **Windows Defender flags binary** | False positive on unsigned binary | Code signing certificate. OR distribute via Microsoft Store. |

---

## Success Criteria

- [ ] `LlamaCppEngine` loads a GGUF model and generates tokens
- [ ] Streaming works: `rag:token` events fire per token
- [ ] Answer quality matches or exceeds Ollama with the same model
- [ ] Context builder produces correct chat template for the chosen model
- [ ] Model download manager works: progress, pause, resume
- [ ] First-run wizard guides user through model download
- [ ] No Ollama process is running — zoloRAG is fully self-contained
- [ ] Total startup time < 500ms (model loading excluded — GGUF memory-map is fast)
- [ ] All existing tests pass (18 unit tests + validation suite)

---

## Build Time Estimate

| Step | Time | Deliverable |
|------|:----:|-------------|
| Set up `llama-cpp-rs` + build compile | 1 day | First successful `cargo build` with llama.cpp |
| Implement `LlamaCppEngine` | 2 days | Model load + generate + streaming callback |
| Context builder chat template | 1 day | `build_prompt()` for Llama 3 format |
| Wire into `ask_question` command | 0.5 day | Replace OllamaChatClient with LlamaCppEngine |
| Model download manager | 1 day | Download with progress, pause/resume |
| First-run wizard UI | 2 days | Download screen, progress bars, error handling |
| Remove Ollama code + cleanup | 0.5 day | Delete `OllamaEncoder`, `OllamaChatClient`, unused imports |
| End-to-end testing | 1 day | Full pipeline: drop PDF → ask question → get answer |
| **Total** | **~9 days** | |

---

## What Gets Removed After Phase 5

These files and dependencies are no longer needed:

| File | Reason |
|------|--------|
| `index/encoder.rs` | Replaced by `ml/embed.rs` |
| `rag/ollama.rs` | Replaced by `ml/llm.rs` |
| `reqwest` `json` feature | No more HTTP calls to Ollama (keep for model download) |
| `OllamaEncoder` struct | Replaced by `CandleEncoder` |
| `OllamaChatClient` struct | Replaced by `LlamaCppEngine` |
| `check_model` / `pull_embedding_model` | Replaced by file-exists check + GGUF download |
| `check_llm_model` / `pull_llm_model` | Same — file-exists check + GGUF download |
| `ModelBanner` component | Replaced by first-run download wizard |
