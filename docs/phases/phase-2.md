# Phase 2: Semantic Index & Chunk Retrieval — Implementation Report

> **Status:** Complete (with deviations from original plan documented below)
> **Audit date:** 2026-05-28

---

## What Was Built

### Original goal
Bit-vector index over PDF chunks + Hamming KNN search + retrieval UI.

### What actually shipped
All of the above, plus:
- **Hybrid search** (keyword overlap + Hamming distance) — fixes named-entity queries
- **Float32 rescoring** (two-pass: binary Hamming → cosine similarity) — fixes semantic query accuracy
- **Chat-based UI** (instead of PDF-reader layout) — single-doc chat interface with slide-out source panel
- **Index persistence** (save/load across restarts, with frontend wiring)

---

## Rust Backend — Modules

### `src-tauri/src/index/mod.rs`
**Planned:** `pub mod encoder; pub mod index; pub mod manager;`
**Built:** ✅ Same, plus `pub use` re-exports for cleaner imports.

### `src-tauri/src/index/manager.rs`
**Planned:** `check_ollama_running`, `check_all-minilm_available`, `ModelStatus` enum (`Checking | NotReady | Ready | Error`)
**Built:** ✅ Same logic, but `ModelStatus` is a **struct** (`{ ready: bool, message: String }`) instead of an enum. Reason: serde serialization to frontend is simpler with a struct. The frontend handles states through the boolean + message string. Added `pull_model()` via Ollama `/api/pull` endpoint.

### `src-tauri/src/index/encoder.rs`
**Planned:** `encode(text) → BitVector` via `POST /api/embeddings`, binarize with `> 0.0` threshold, returns only binary vector.
**Built:** ✅ Plus additions:
- Returns **`EncodedVector { bit_vector, float_vector }`** — both the 384-bit and 384-float32 versions. Float vector is stored for cosine rescoring at search time.
- `encode_batch()` — sequential (not concurrent as planned). Reason: Ollama handles concurrent requests internally; sequential avoids race conditions on the model loading.
- Uses typed `EmbeddingResponse` struct instead of generic `serde_json::Value`.

### `src-tauri/src/index/index.rs`
**Planned:** `BitIndex { chunks, vectors }` with `hamming_distance()`, `search()` (pure Hamming KNN), `save()/load()` (bincode).
**Built:** ✅ Significant additions:

| Addition | Why |
|----------|-----|
| `TermIndex` | Keyword overlap scoring for named-entity queries. After testing, pure binary Hamming scored only 69% for "Shanvit Shetty" on a resume where the name was present. |
| `cosine_similarity()` | Float32 rescoring of binary candidates. Binary Hamming preserves ~92.5% of dense retrieval accuracy; cosine rescoring pushes it to ~96%. |
| `float_vectors: Option<Vec<Vec<f32>>>` | Stored alongside binary vectors for the rescoring pass. 1,536 bytes/chunk extra on disk, zero in memory during Hamming pass. |
| `search_hybrid(q_bv, q_f32, text, k)` | Three-stage pipeline: Hamming scan → float32 cosine rescore on top candidates → keyword blend. |
| `search_semantic()` | Pure Hamming-only, kept for comparison/testing. |

**API changes from plan:**
- `add_chunk(info, vector)` → `add_chunk(info, vector, float_vector)` — third argument for float32 embeddings
- `search(query, k)` → delegates to `search_hybrid` — backward compatible signature

### Tauri Commands

| Planned | Built | Changes |
|---------|-------|---------|
| `index_document` | ✅ | Now passes float vectors to `add_chunk` |
| `query_index` | ✅ | Now passes float32 query + raw text to `search_hybrid` |
| `get_index_status` | ✅ | Identical |
| `check_model` | ✅ | Identical |
| — | ✅ **`load_index`** | Added for frontend persistence (was planned but frontend wiring was missing — fixed) |
| — | ✅ **`pull_embedding_model`** | Added so users can pull all-minilm from the UI |

### App State

**Planned:**
```rust
struct AppState {
    bit_index: Mutex<Option<BitIndex>>,
    encoder: Mutex<Option<OllamaEncoder>>,
    embedding_model_status: Mutex<ModelStatus>,
}
```

**Built:**
```rust
struct AppState {
    current_document: Mutex<Option<PdfDocument>>,
    current_chunks: Mutex<Vec<Chunk>>,
    bit_index: Mutex<Option<BitIndex>>,
    encoder: OllamaEncoder,              // Not wrapped in Option or Mutex
    index_path: Mutex<Option<PathBuf>>,  // Added for persistence
}
```

Deviations:
- `encoder` is a direct field (not `Mutex<Option<>>`) — `OllamaEncoder` is cheaply cloneable (Arc<Client> inside)
- `embedding_model_status` not stored in state — frontend calls `check_model` command on demand via `ModelBanner`
- `index_path` added — needed for `load_index` command to know where the persisted file lives

---

## Frontend

### Planned components
```
src/components/
├── DropZone.tsx            (existing)
├── DocumentSidebar.tsx     (existing)
├── PreviewPanel.tsx        (existing)
├── StatusBar.tsx           (existing)
├── SearchBar.tsx           ★ NEW
├── SearchResults.tsx       ★ NEW
└── ModelBanner.tsx         ★ NEW
```

### Built components
```
src/components/
├── DropZone.tsx            SIMPLIFIED  — empty-state only, no hasDocuments variant
├── ChatInput.tsx           ★ NEW       — replaces SearchBar, bottom-pinned input
├── ChatMessages.tsx        ★ NEW       — replaces SearchResults, conversation timeline
├── SourcePanel.tsx          ★ NEW       — slide-out PDF viewer on result click
├── ModelBanner.tsx         ★ NEW       — as planned
│
└── (DELETED)
    ├── DocumentSidebar.tsx  — single-doc mode, no sidebar needed
    ├── SearchBar.tsx        — replaced by ChatInput
    ├── SearchResults.tsx    — replaced by ChatMessages
    ├── PreviewPanel.tsx     — replaced by SourcePanel
    └── StatusBar.tsx        — merged into page.tsx footer
```

### Why the UI changed from the plan
The original plan showed a **PDF reader with search bolted on** (sidebar, preview panel, search bar above). After building and testing, this was confusing for Phase 2's focus (semantic retrieval, not document browsing). The UI was redesigned as a **chat interface**:

- **No sidebar** — one PDF at a time, shown in header
- **No PreviewPanel** by default — PDF content appears in slide-out only when user clicks a search result
- **Chat messages** — user queries + assistant results flow top-to-bottom
- **Input pinned to bottom** — natural chat pattern

Driver: `docs/plan-ui-revamp.md` and the [impeccable design skill](../agents/skills/impeccable/SKILL.md).

---

## Search Algorithm — What Actually Runs

```
User types "person who built chatbot packages"

  ↓
  
1. Ollama /api/embeddings → 384-dim float vector
   Returns: EncodedVector { bit_vector (384 bits), float_vector (384 × f32) }

  ↓

2. Hamming scan (binary × binary) — all chunks, ~0.01ms
   Scores: [0.50, 0.42, 0.35, 0.34, 0.30, ...]

  ↓

3. Keyword overlap — all chunks, ~0.001ms
   Query tokens: ["person", "who", "built", "chatbot", "packages"]
   Scores: [0.40, 0.00, 0.00, 0.00, 0.00, ...]

  ↓

4. Select top (k × 4) candidates by Hamming + keyword blend
   Candidates: indices [0, 1, 2, ...] (top 20)

  ↓

5. Float32 cosine rescore — only candidates, ~0.003ms
   Cosine scores: [0.65, 0.30, 0.15, ...]  (replaces Hamming)

  ↓

6. Final blend (α = 0.6):
   final = 0.6 × cosine + 0.4 × keyword
   Results: [0.55, 0.18, 0.09, ...]

  ↓

7. Return top-5 to frontend as chat message
```

---

## Dependency Changes

| Crate | Planned | Built | Notes |
|-------|---------|-------|-------|
| `reqwest` | 0.12 | 0.12 | ✅ On plan |
| `bincode` | 2 | **1** | ⚠️ Minor: bincode 2 API is slightly different. v1 `serialize`/`deserialize` works identically for our use case. No functional impact. |
| `tokio` | 1 | 1 | ✅ Implicit via Tauri |
| `futures` | 0.3 | 0.3 | ✅ Listed in plan, available but not used for concurrent encoding (sequential is reliable enough for POC) |

No new dependencies beyond what was planned.

---

## Deviations from Plan — Summary

| Area | Planned | Actual | Why |
|------|---------|--------|-----|
| **Search** | Pure Hamming KNN | Hamming → cosine rescore → keyword blend | Binarization loses too much signal for semantic queries. Two-pass fixes named entities AND semantic accuracy. |
| **Encoder** | Returns `BitVector` only | Returns `EncodedVector` (bit + float) | Needed float embeddings for cosine rescoring. |
| **UI** | PDF reader with sidebar + preview | Chat interface with slide-out source panel | Phase 2 is about search/retrieval, not document browsing. Chat is the natural paradigm. |
| **AppState** | `embedding_model_status` field | Not stored; frontend calls `check_model` directly | Simpler state management. |
| **ModelStatus** | Enum (`Checking/NotReady/Ready/Error`) | Struct (`{ ready, message }`) | serde serialization to frontend is trivial with a struct. |
| **Index persistence** | Mentioned but not wired in frontend | `load_index` command + frontend startup call | Bugfix: without this, restarting the app lost the index silently. |
| **Validation vs AskBit** | Planned but not done | Skipped | Priority shifted to hybrid search + rescoring. AskBit bit-exact comparison deferred to Phase 3 if needed. |
| **Benchmark** | Planned but not done | Skipped | POC scale (< 100 chunks) doesn't need benchmarks. |
| **Concurrent encoding** | `tokio::join_all` | Sequential loop | Ollama handles concurrent requests internally. Sequential is simpler and reliable at POC scale. |

---

## Known Issues

1. **Ollama v0.24.0 compatibility** — The `/api/pull` endpoint returns a stream of JSON lines. The current `pull_model()` function only checks HTTP status, which works but doesn't show progress. If upgrading to a newer Ollama version, verify the embeddings API still uses the `prompt` field (newer versions may use `input` instead).
2. **Legacy index format** — Indexes saved before Phase 2 (no `float_vectors` field) will fail to deserialize. The load error message tells the user to re-index. This is acceptable for POC.
3. **Large chunks** — `max_chars = 2500` produces chunks that dilute embedding signal. Reduce to ~700 for better search quality, but this is a Phase 3 tuning concern.

---

## What's Next (Phase 3)

- **Context Builder** — assemble top-K chunks into an LLM prompt (the search is now accurate enough for this)
- **Ollama chat integration** — stream LLM answers with source citations
- **Chat history** — conversation context for follow-up questions
- **Settings UI** — model selection, top-K slider, chunk size config
