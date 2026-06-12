# Phase 4: Native Embedding Model (Ollama → Candle)

> **Goal:** Remove the Ollama dependency for embeddings by running `all-MiniLM-L6-v2` in-process via `candle`.
> **This is the "reality test":** verify that Rust-native inference produces the same ranking quality before committing to the full Ollama removal.

---

## Why Phase 4 Exists

Phase 4 is the **safest first step** toward Ollama independence. The embedding model is small (~85 MB), well-understood (BERT-based MiniLM), and has a working `candle` reference. If we can't make this work with preserved ranking quality, we shouldn't attempt Phase 5 (LLM replacement, which is 20× harder).

**This phase has a built-in go/no-go decision point.** If candle's outputs degrade search ranking by more than 5%, we pause, investigate, and either fix or revert.

---

## Architecture Change

```
Before (Ollama):
  User query/chunk
       │
       ▼
  ┌─────────────────────┐
  │  OllamaEncoder       │
  │  (HTTP POST to       │
  │   localhost:11434    │
  │   /api/embeddings)   │
  │  → JSON response     │
  │  → 384 f64 values    │
  └─────────┬───────────┘
            │
            ▼
       EncodedVector
  { bit_vector, float_vector }

After (Candle):
  User query/chunk
       │
       ▼
  ┌─────────────────────┐
  │  CandleEncoder       │
  │  (in-process,        │
  │   candle + tokenizers)│
  │  → BERT forward pass │
  │  → 384 f32 values    │
  └─────────┬───────────┘
            │
            ▼
       EncodedVector
  { bit_vector, float_vector }
```

**Key invariant:** Both paths produce the same `EncodedVector` type. The rest of the pipeline (`BitIndex`, hybrid search, context builder, frontend) **does not change at all**.

---

## Implementation

### New Module: `src-tauri/src/ml/`

```
src-tauri/src/ml/
├── mod.rs           # Module root, re-exports
├── embed.rs         # CandleEncoder — in-process BERT inference
└── download.rs      # Model download manager (GGUF from HuggingFace)
```

### `ml/embed.rs` — CandleEncoder

```rust
use candle_core::Device;
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config};
use hf_hub::api::sync::Api;
use tokenizers::Tokenizer;

pub struct CandleEncoder {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
}

impl CandleEncoder {
    /// Load model from local GGUF/safetensors file.
    /// On first run, downloads from HuggingFace Hub.
    pub fn new(model_path: &Path) -> Result<Self, String> { ... }

    /// Encode text → 384-dim float vector.
    /// Runs the BERT forward pass and mean-pools the output.
    pub fn encode_text(&self, text: &str) -> Result<Vec<f32>, String> {
        // 1. Tokenize
        let tokens = self.tokenizer.encode(text, true).map_err(...)?;
        let input_ids = Tensor::new(tokens.get_ids(), &self.device)?;
        let attention_mask = Tensor::new(tokens.get_attention_mask(), &self.device)?;

        // 2. Forward pass
        let output = self.model.forward(&input_ids, &attention_mask, true)?;

        // 3. Mean-pool the last hidden state
        let (_batch_size, _seq_len, hidden_size) = output.shape().dims3()?;
        let sum = output.sum(1)?;
        let mean = sum.broadcast_div(&Tensor::new(&[hidden_size as f32], &self.device)?)?;

        // 4. Return 384-dim f32 vector
        Ok(mean.to_vec1::<f32>()?)
    }
}
```

### Replacing `OllamaEncoder`

The current `OllamaEncoder` in `index/encoder.rs` is used in two places:

| Location | Current call | New call |
|----------|-------------|----------|
| `index_document` command | `state.encoder.encode_batch(texts)` | `state.candle_encoder.encode_batch(texts)` |
| `query_index` command | `state.encoder.encode(query)` | `state.candle_encoder.encode(query)` |
| `ask_question` command | `state.encoder.encode(query)` | `state.candle_encoder.encode(query)` |

The `CandleEncoder` will implement the same interface:

```rust
impl CandleEncoder {
    pub fn encode(&self, text: &str) -> Result<EncodedVector, String> {
        let floats = self.encode_text(text)?;
        let bit_vector = BitVector::from_float_slice(&floats);
        Ok(EncodedVector { bit_vector, float_vector: floats })
    }

    pub fn encode_batch(&self, texts: &[String]) -> Result<Vec<EncodedVector>, String> {
        texts.iter().map(|t| self.encode(t)).collect()
    }
}
```

### Model Download (`ml/download.rs`)

The embedding model (~85 MB) is downloaded on first launch:

```rust
pub fn ensure_embedding_model(app_dir: &Path) -> Result<PathBuf, String> {
    let model_path = app_dir.join("models").join("all-minilm-l6-v2.gguf");

    if model_path.exists() {
        return Ok(model_path);
    }

    // Download from HuggingFace Hub or a mirror
    download_file(
        "https://huggingface.co/.../all-minilm-l6-v2.gguf",
        &model_path,
        |progress| { /* emit download progress event */ },
    )?;

    Ok(model_path)
}
```

The download happens once, during the first-run setup wizard (Phase 5 includes the full wizard; Phase 4 can use a simpler inline download).

---

## Validation Suite (The "Reality Test")

This is the critical part. We need to prove that candle's outputs produce the same search quality as Ollama's.

### Test 1: Bit-Level Agreement

Encode the same 100 sentences through both Ollama and Candle. Compare the resulting bit vectors.

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Bit agreement** | ≥ 95% | `popcount(a ^ b) / 384` averaged over 100 sentences |
| **Bit vector equality** | ≥ 80% | Exact `==` comparison |

If bit agreement < 90%, something is fundamentally different (model version, tokenizer, precision).

### Test 2: Ranking Consistency

Build two indexes from the same 50-chunk PDF:

| Index | Embedding source |
|-------|-----------------|
| **Ollama index** | Current Ollama-based encoder |
| **Candle index** | New candle-based encoder |

Run the same 20 queries against both indexes. Compare top-5 results:

| Metric | Target | How |
|--------|--------|-----|
| **Top-1 overlap** | ≥ 90% | Same document in position 1 |
| **Top-5 overlap** | ≥ 80% | Same documents in top 5 (any order) |
| **Score correlation** | ≥ 0.85 | Pearson correlation of scores |

### Test 3: Regression Check on Known Queries

Run the diagnostic queries from Phase 2/3:

| Query | Expected top result |
|-------|-------------------|
| "John Doe" | Contact header chunk (keyword boost verifies this holds) |
| "person who built chatbot packages" | Side Projects chunk (semantic ranking verifies this holds) |
| "refund policy" | The chunk about refunds |

### Go/No-Go Decision

| Condition | Decision |
|-----------|----------|
| All 3 tests pass (within targets) | ✅ Proceed to Phase 5 |
| Tests 2 & 3 pass, Test 1 marginal (90-95%) | ✅ Proceed, note minor float diff |
| Test 2 or 3 fails | ❌ **STOP.** Investigate: wrong model, wrong tokenizer, wrong pooling? |
| Ranking clearly worse qualitatively | ❌ **STOP.** Consider reverting or using a different Rust embedding approach. |

---

## Dependencies to Add

| Crate | Version | Size | Purpose |
|-------|---------|:----:|---------|
| `candle-core` | 0.8+ | — | Tensor types, device management |
| `candle-nn` | 0.8+ | — | Neural network building blocks |
| `candle-transformers` | 0.8+ | — | BERT model architecture |
| `tokenizers` | 0.21+ | — | HuggingFace tokenizer in Rust |
| `hf-hub` | 0.4+ | — | HuggingFace Hub API for model download |

**Total new crates:** 5 (all pure Rust, no C++ dependencies)

**No changes to existing crates** (reqwest, serde, bincode stay).

---

## App State Changes

```rust
struct AppState {
    // Keep Ollama encoder during transition (for comparison testing)
    encoder: OllamaEncoder,

    // NEW: candle-based encoder
    candle_encoder: Option<CandleEncoder>,

    // Phase 1-3 fields (unchanged):
    current_document: ...,
    current_chunks: ...,
    bit_index: ...,
    index_path: ...,
    chat_history: ...,
    context_builder: ...,
    llm_client: ...,
    last_sources: ...,
}
```

During testing, both `encoder` and `candle_encoder` exist. A config flag or environment variable selects which one the commands use:

```rust
// lib.rs — commands use whichever encoder is active
let encoded = if use_candle {
    state.candle_encoder.as_ref().unwrap().encode(&query).await?
} else {
    state.encoder.encode(&query).await?
};
```

After validation passes, `OllamaEncoder` and its HTTP client are removed entirely.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **candle outputs differ from Ollama** | Ranking degrades | Validation suite catches this. If minor (<5% bit diff), ranking is likely stable. |
| **candle BERT version mismatch** | Wrong outputs | Pin the exact HuggingFace model ID. Use the same ONNX/GGUF export. |
| **Tokenizer differences** | Different tokenization → different embeddings | Use the same `tokenizers` crate with the same `tokenizer.json` that Ollama uses. |
| **Performance regression** | Encoding slower than HTTP call | candle should be faster (no HTTP overhead, no JSON parsing). Benchmark encode_batch(100). |
| **Model download fails** | First-run broken | Resume support. Fallback to Ollama if candle model not available. |

---

## Success Criteria

- [ ] `CandleEncoder` produces `EncodedVector` identical in structure to `OllamaEncoder`
- [ ] Bit agreement ≥ 95% between candle and Ollama on 100 test sentences
- [ ] Top-5 ranking overlap ≥ 80% on 20 test queries
- [ ] Known queries (name match, chatbot packages) return the same top result
- [ ] Encode speed is not regressed (< 50ms per text)
- [ ] Model downloads and loads successfully on first run
- [ ] All 18 existing unit tests still pass

---

## Build Time Estimate

| Step | Time | Deliverable |
|------|:----:|-------------|
| Set up candle + tokenizers dependencies | 0.5 day | Compiling `candle` for the first time |
| Implement `CandleEncoder` (forward pass) | 1 day | Working `encode_text()` returning 384 floats |
| Wire into existing `encoder.rs` interface | 0.5 day | `CandleEncoder` implementing same API |
| Implement model download | 0.5 day | GGUF download with progress |
| Validation suite (3 tests) | 1 day | Bit agreement, ranking overlap, regression check |
| Go/no-go decision | — | Compare results, decide Phase 5 |
| **Total** | **~3.5 days** | |
