# zoloRAG — Local PDF Chat

A fully local RAG (Retrieval-Augmented Generation) app for chatting with PDF documents. Drop a PDF, ask questions, get answers — everything runs **in a single process**, no external services, no cloud.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    zoloRAG (Single Process)                       │
│                                                                  │
│  PDF dropped                                                     │
│    │                                                             │
│    ▼                                                             │
│  ┌─────────────────────────┐                                     │
│  │  Phase 1: Extract + Chunk│                                     │
│  │  pdf-extract + lopdf     │     ┌──────────────────────────┐   │
│  │  → text pages            │     │  Model Runtime            │   │
│  │  → paragraph/sentence    │     │  ┌────────────────────┐  │   │
│  │    chunking              │     │  │  ml/embed.rs       │  │   │
│  └──────────┬──────────────┘     │  │  CandleEncoder      │  │   │
│             │                    │  │  (all-MiniLM-L6-v2  │  │   │
│             ▼                    │  │   via candle,       │  │   │
│  ┌─────────────────────────┐     │  │   384-dim BERT)     │  │   │
│  │  Phase 2: Index + Search │     │  └────────────────────┘  │   │
│  │                          │     │  ┌────────────────────┐  │   │
│  │  CandleEncoder → 384-dim │     │  │  ml/llm.rs         │  │   │
│  │  float → binarize to     │     │  │  LlamaCppEngine    │  │   │
│  │  48-byte bit vector      │     │  │  (Llama 3.2 3B     │  │   │
│  │  + term index            │     │  │   via llama.cpp    │  │   │
│  │                          │     │  │   FFI, 1.8 GB      │  │   │
│  │  3-stage hybrid search:  │     │  │   Q4_K_M GGUF)     │  │   │
│  │  1. Hamming popcount     │     │  └────────────────────┘  │   │
│  │  2. Cosine rescore       │     └──────────────────────────┘   │
│  │  3. Keyword blend        │                                     │
│  └──────────┬──────────────┘                                     │
│             │                                                     │
│             ▼                                                     │
│  ┌─────────────────────────┐                                     │
│  │  Phase 3: Answer        │                                     │
│  │                         │                                     │
│  │  ContextBuilder         │────→ LlamaCppEngine.generate()      │
│  │  → chunks + history →   │      (in-process, no HTTP)          │
│  │    Llama 3 chat template│      → token callback               │
│  │  │                         │      → rag:* Tauri events         │
│  │  Streaming via rag:*    │◄────┘                               │
│  │  Tauri events           │                                     │
│  └──────────┬──────────────┘                                     │
│             │                                                     │
│             ▼                                                     │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  UI (Next.js + Tauri Desktop)                             │    │
│  │                                                           │    │
│  │  ┌───────────────────────────────────────────────────┐    │    │
│  │  │  Setup Panel (first launch)                       │    │    │
│  │  │  📦 Embedding model  ████████████ 100% ✅         │    │    │
│  │  │  🧠 Language model   ████████░░░░  72% ⬇️          │    │    │
│  │  └───────────────────────────────────────────────────┘    │    │
│  │                                                           │    │
│  │  ┌───────────────────────────────────────────────────┐    │    │
│  │  │  Chat Messages (streaming LLM text)               │    │    │
│  │  │  📄 Source: Page 12 · 87% ← click                 │    │    │
│  │  │  → SourcePanel slides out                         │    │    │
│  │  └───────────────────────────────────────────────────┘    │    │
│  │  ┌───────────────────────────────────────────────────┐    │    │
│  │  │  Ask a question...                            [→] │    │    │
│  │  └───────────────────────────────────────────────────┘    │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop shell** | Tauri 2 (Rust) |
| **Frontend** | Next.js 16, TypeScript, Tailwind CSS |
| **PDF extraction** | `pdf-extract` + `lopdf` (Rust crates) |
| **Embeddings** | `candle` (all-MiniLM-L6-v2, 384-dim, in-process, ~85 MB) |
| **Search** | Binary Hamming → float32 cosine rescore → keyword blend |
| **LLM** | `llama-cpp-2` (Llama 3.2 3B Q4_K_M GGUF, in-process, ~1.8 GB) |
| **Model download** | Direct HTTP from HuggingFace with pause/resume, progress events |
| **Serialization** | bincode (index persistence) |
| **Styling** | CSS custom properties (OKLCH color space, dark/light mode) |

---

## Features

### PDF Ingestion
When you drop a PDF onto the app, `pdf-extract` pulls the text out page by page. If the PDF uses hidden text layers (common in scanned documents with OCR), `lopdf` handles the fallback. The text is then split into chunks — we group by paragraph, then split long paragraphs at sentence boundaries. Each chunk targets roughly 256 tokens, which balances retrieval precision with context window efficiency. The extraction method is shown as a badge so you know whether the text came directly from the PDF or from a hidden layer.

### Semantic Search
Every text chunk is encoded into a 384-dimensional float vector using a BERT model (`all-MiniLM-L6-v2`) running in-process via the `candle` ML framework. These vectors capture semantic meaning — similar concepts cluster together in vector space, even when they use different words.

To make search fast at scale, we binarize each float vector: every positive dimension becomes a 1, every non-positive becomes a 0. This collapses the 384-dim float vector into a 384-bit vector (48 bytes). The initial search uses Hamming distance via CPU popcount — this is a single CPU instruction per 64-bit word, so we can scan hundreds of thousands of chunks in milliseconds. The top 20 candidates are then rescored with full float32 cosine similarity to recover precision lost during binarization. Finally, we blend in a keyword overlap score (60% semantic / 40% lexical) to catch exact-name queries that pure semantic search can miss.

The index is persisted to disk via bincode, so you don't re-index on restart.

### RAG Answers
When you ask a question, the app retrieves the most relevant chunks and builds a prompt using the **Llama 3 instruct template**. The prompt includes the system instructions, the retrieved chunks (with page numbers), recent chat history for follow-up context, and your question. This prompt is fed into the in-process LLM engine (`LlamaCppEngine`), which runs Llama 3.2 3B via `llama.cpp` FFI.

Tokens stream back in real time: each generated token fires a `rag:token` Tauri event, the frontend appends it to the message, and you see the answer appear word by word. Source chunks are attached to each answer as clickable page badges — clicking one slides out a panel showing the original PDF page.

### Fully Self-Contained
The entire app is a single Rust binary with no external services. The embedding model runs in-process via `candle`, the LLM runs in-process via `llama.cpp` bindings. No Python runtime, no Ollama daemon, no HTTP calls to localhost for inference. On the first launch, a setup panel guides you through downloading both models from HuggingFace with progress bars and pause/resume support. After that, everything works offline.

### UI
Clean chat interface — one PDF at a time, no sidebar clutter. First launch shows a setup panel with download progress. Light and dark mode follow your system preference. The font stack uses system fonts for zero download overhead. Source panel slides out from the right when you click a citation badge.

---

## Prerequisites

- **macOS** (Apple Silicon or Intel), **Linux** (x86_64), or **Windows** (x86_64)
- **Rust toolchain** (for development) — [rustup.rs](https://rustup.rs)
- **Node.js 20+** + **pnpm** (for frontend)
- **~2.7 GB free disk space** (models are downloaded on first launch)

The app downloads models automatically from HuggingFace on first launch:

| Model | Size | Purpose |
|-------|------|---------|
| `all-MiniLM-L6-v2` (safetensors) | ~85 MB | Text embeddings |
| `Llama-3.2-3B-Instruct-Q4_K_M` (GGUF) | ~1.8 GB | Answer generation |

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Run in development mode (starts Next.js + Tauri desktop window)
npx tauri dev

# On first launch, the setup panel will guide you through model downloads.
# Drop a PDF and start asking questions.
```

## Build

```bash
npx tauri build
```

Output: a standalone desktop app in `src-tauri/target/release/bundle/`.

---

## Project Structure

```
src/                          # Frontend (Next.js + TypeScript)
├── app/
│   ├── page.tsx              # Main chat UI + setup flow
│   ├── layout.tsx            # Root layout
│   └── globals.css           # CSS variables, themes, animations
├── components/
│   ├── SetupPanel.tsx        # First-launch model download UI
│   ├── ChatInput.tsx         # Text input + send button
│   ├── ChatMessages.tsx      # Message timeline (user, assistant, streaming)
│   ├── DropZone.tsx          # PDF upload area
│   └── SourcePanel.tsx       # Slide-out PDF page viewer
├── hooks/
│   └── useTauriEvent.ts      # Event listener helper
└── types/
    └── index.ts              # Shared TypeScript types

src-tauri/                    # Backend (Rust)
├── src/
│   ├── main.rs               # Entry point
│   ├── lib.rs                # Tauri commands + app state
│   ├── ml/
│   │   ├── mod.rs            # Module root
│   │   ├── embed.rs          # CandleEncoder (BERT via candle)
│   │   ├── llm.rs            # LlamaCppEngine (llama.cpp FFI)
│   │   └── download.rs       # Model download manager (HF Hub)
│   ├── index/
│   │   ├── mod.rs
│   │   ├── manager.rs        # Model status types
│   │   └── index.rs          # BitIndex, TermIndex, hybrid search
│   ├── pdf/
│   │   ├── mod.rs
│   │   ├── extract.rs        # PDF text extraction
│   │   └── chunk.rs          # Paragraph/sentence chunking
│   └── rag/
│       ├── mod.rs
│       ├── chat.rs           # Chat history (in-memory)
│       └── context.rs        # Context builder (chunks → prompt template)
├── Cargo.toml
└── tauri.conf.json
```

---



## How It Works — Behind the Scenes

### Startup Flow
1. App launches → checks if both model files exist on disk
2. If models are missing, a **Setup Panel** appears with download buttons and progress bars
3. Models download from HuggingFace directly
4. Once downloaded, models load into memory on demand
5. User sees the DropZone → uploads a PDF → chatting begins

### Embedding (Phase 4)
- `CandleEncoder` loads `all-MiniLM-L6-v2` via the `candle` ML framework
- Tokenization via HuggingFace `tokenizers` crate (WordPiece)
- BERT forward pass produces 384-dim float vectors
- Mean pooling + L2 normalization (standard sentence-transformers post-processing)
- Binarization: `float > 0.0` → 384-bit vector packed into 6 × u64

### LLM Inference (Phase 5)
- `LlamaCppEngine` loads a GGUF file via `llama-cpp-2` (Rust bindings to llama.cpp)
- Prompt is formatted using the **Llama 3 instruct template** (`<|begin_of_text|>`, `<|start_header_id|>`, etc.)
- Tokenization uses the model's built-in BPE tokenizer
- Autoregressive generation: decode prompt → sample → emit token → decode next → loop
- Streaming via a callback that fires `rag:token` Tauri events per token
- Greedy sampling by default (configurable)

### Model Download Manager
- `ml/download.rs` handles downloading from HuggingFace with:
  - **Progress reporting** via callback → frontend progress bars
  - **Pause/resume** via HTTP Range headers (partial download detection)
  - **Atomic writes**: download to `.partial` file, rename on completion
  - **Cache detection**: checks file existence before downloading

---

## Current State

- **Phase 1** (extract + chunk) — ✅ Complete
- **Phase 2** (index + search) — ✅ Complete with enhancements
- **Phase 3** (RAG answers) — ✅ Complete
- **Phase 4** (in-process embeddings via candle) — ✅ Complete
- **Phase 5** (in-process LLM via llama.cpp) — ✅ Complete
- **Known limitations**: single-PDF POC, in-memory chat history (lost on restart), no multi-document support

## References

This project builds on techniques and approaches from the following projects:

- **[askbit](https://github.com/Shanvit7/askbit)** — The binarization RAG approach (bit packing, Hamming distance search) used in Phase 2 of zoloRAG was adopted from this project. AskBit demonstrates how to binarize float embeddings into compact bit vectors for fast approximate nearest-neighbor search using CPU popcount.

- **[email-triage-slm](https://github.com/Shanvit7/email-triage-slm)** — The in-process native LLM inference strategy (Transformers + PEFT) was inspired by this project. Email Triage SLM shows how to run small language models locally without external dependencies, which directly informed zoloRAG's Phase 5 transition away from Ollama to self-contained inference via `candle` and `llama.cpp`.

## License

MIT
