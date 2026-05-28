# zoloRAG — Local PDF Chat

A fully local RAG (Retrieval-Augmented Generation) app for chatting with PDF documents. Drop a PDF, ask questions, get answers — all running on your machine with no cloud dependencies.

Zero Python, zero pip, zero ONNX, zero GPU required. Just Rust + Ollama.

---

## Architecture

```
User drops PDF
    │
    ▼
┌──────────────────────┐      ┌─────────────────────┐
│  Phase 1: Extract     │      │  Ollama (localhost)  │
│  & Chunk              │      │  ┌───────────────┐   │
│  ┌────────────────┐   │      │  │ all-minilm    │   │
│  │ pdf-extract    │   │      │  │ (embeddings)  │   │
│  │ + lopdf        │   │      │  └───────────────┘   │
│  │ → text pages   │   │      │  ┌───────────────┐   │
│  │ → paragraph/   │   │      │  │ llama3.2:3b   │   │
│  │   sentence     │   │      │  │ (chat/answer) │   │
│  │   chunking     │   │      │  └───────────────┘   │
│  └────────────────┘   │      └──────────┬──────────┘
└──────────┬───────────┘                 │
           │                             │
           ▼                             │
┌──────────────────────┐                │
│  Phase 2: Index      │                │
│  & Search            │                │
│  ┌────────────────┐  │                │
│  │ Encoder →      │  │                │
│  │ 384-dim float  │──┼────────────────┘
│  │ → binarize to  │  │   HTTP POST /api/embeddings
│  │   48-byte      │  │
│  │   bit vector   │  │
│  │ + term index   │  │
│  │                │  │
│  │ 3-stage search:│  │
│  │ 1. Hamming     │  │
│  │ 2. Cosine      │  │
│  │    rescore     │  │
│  │ 3. Keyword     │  │
│  │    blend       │  │
│  └────────────────┘  │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐      ┌─────────────────────┐
│  Phase 3: Answer      │      │  Ollama (localhost)  │
│  ┌────────────────┐   │      │                     │
│  │ ContextBuilder │   │──────▶  HTTP POST          │
│  │ → chunks →     │   │      │  /api/chat          │
│  │   prompt with  │   │      │  (streaming NDJSON) │
│  │   page cites   │   │      │                     │
│  └────────────────┘   │      └──────────┬──────────┘
│  ┌────────────────┐   │                 │
│  │ Streaming      │◄──┼─────────────────┘
│  │ via rag:*      │   │   rag:token, rag:done,
│  │ Tauri events   │   │   rag:sources, rag:error
│  └────────────────┘   │
└──────────┬───────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│  UI (Next.js + Tauri Desktop)               │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Chat Messages (streaming LLM text) │    │
│  │  📄 Source: Page 12 · 87% ← click  │    │
│  │  → SourcePanel slides out           │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │  Ask a question...              [→] │    │
│  └─────────────────────────────────────┘    │
│  47 chunks · Model: llama3.2:3b             │
└─────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop shell** | Tauri 2 (Rust) |
| **Frontend** | Next.js 14, TypeScript, Tailwind CSS |
| **PDF extraction** | `pdf-extract` + `lopdf` (Rust crates) |
| **Embeddings** | Ollama `all-minilm` (384-dim, ~80MB model) |
| **Search** | Binary Hamming → float32 cosine rescore → keyword blend |
| **LLM** | Ollama `llama3.2:3b` (streaming via `/api/chat`) |
| **Serialization** | bincode (index persistence) |
| **Styling** | CSS custom properties (OKLCH color space, dark/light mode) |

---

## Features

### Phase 1 — PDF Ingestion
- Drag & drop PDF files (or browse dialog)
- Dual extraction: `pdf-extract` for text PDFs, `lopdf` fallback for hidden text layers
- Intelligent chunking by paragraphs + sentences, configurable token targets
- Extraction method badges ("Text extracted", "Hidden text layer", "Scanned")

### Phase 2 — Semantic Search
- **384-bit vector index** (6 × u64, 48 bytes/chunk) — fits in L2 cache
- **Binarization**: `(dense > 0.0)` — same as AskBit/Python `sentence-transformers`
- **3-stage hybrid search**:
  1. Hamming distance via `popcount` (CPU intrinsic, all chunks)
  2. Float32 cosine rescore (top-20 candidates)
  3. Keyword term overlap blend (60% semantic / 40% lexical)
- Auto-indexing on PDF drop (no buttons to press)
- Index persistence across restarts

### Phase 3 — RAG Answers
- **Context Builder**: system prompt + page-cited chunks + chat history
- **Streaming LLM answers** via Ollama `/api/chat` → Tauri events → real-time UI
- **Source citations**: clickable page badges → slide-out SourcePanel shows the page
- **Follow-up questions**: chat history included in LLM context
- **Model auto-detection**: checks both embedding + LLM models, shows download banner with pull button

### UI
- Chat interface (no sidebar, one PDF at a time)
- Light/dark mode via `prefers-color-scheme`
- System font stack, OKLCH color tokens
- Responsive layout, slide-out source panel

---

## Prerequisites

- **Ollama** — [ollama.com](https://ollama.com) (runs on macOS, Windows, Linux)
- Two models pulled:

```bash
ollama pull all-minilm    # ~80MB — embedding model
ollama pull llama3.2:3b   # ~2GB — LLM for answering
```

The app will auto-detect missing models and prompt you to download them from the UI.

---

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode (starts Next.js + Tauri desktop window)
npx tauri dev
```

---

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
│   ├── page.tsx              # Main chat UI
│   ├── layout.tsx            # Root layout
│   └── globals.css           # CSS variables, themes, animations
├── components/
│   ├── ChatInput.tsx         # Text input + send button
│   ├── ChatMessages.tsx      # Message timeline (user, assistant, streaming)
│   ├── DropZone.tsx          # PDF upload area
│   ├── ModelBanner.tsx       # Embedding model status
│   └── SourcePanel.tsx       # Slide-out PDF page viewer
├── hooks/
│   └── useTauriEvent.ts      # Event listener helper
└── types/
    └── index.ts              # Shared TypeScript types

src-tauri/                    # Backend (Rust)
├── src/
│   ├── main.rs               # Entry point
│   ├── lib.rs                # Tauri commands + app state
│   ├── index/
│   │   ├── mod.rs
│   │   ├── manager.rs        # Ollama model lifecycle (check, pull)
│   │   ├── encoder.rs        # Embedding via /api/embeddings
│   │   └── index.rs          # BitIndex, TermIndex, hybrid search
│   ├── pdf/
│   │   ├── mod.rs
│   │   ├── extract.rs        # PDF text extraction
│   │   └── chunk.rs          # Paragraph/sentence chunking
│   └── rag/
│       ├── mod.rs
│       ├── chat.rs           # Chat history (in-memory)
│       ├── context.rs        # Context builder (chunks → prompt)
│       └── ollama.rs         # Streaming /api/chat client
├── Cargo.toml
└── tauri.conf.json

docs/
├── phases/
│   ├── phase-2.md            # Phase 2 implementation report
│   └── phase-3.md            # Phase 3 plan (updated for what was built)
├── plan-ui-revamp.md         # UI redesign plan
├── approach-semantic-retrieval.md  # Search quality approach
└── diagnose-search-quality.md      # Search quality diagnosis
```

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Ollama for embeddings** (not candle/ort) | Bit-exact with Python AskBit, zero new infra, Ollama already needed for chat |
| **Binary quantization** (not dense only) | 32× memory reduction, popcount is 2 CPU cycles, 92.5% accuracy retention |
| **Float32 rescoring** (not just binary) | Recovers ~96% of dense accuracy, only touches top-20 candidates (negligible cost) |
| **Keyword blend** (not pure semantic) | Fixes named-entity queries ("Shanvit Shetty" → 81% instead of 69%) |
| **Chat UI** (not PDF reader) | Phase 2/3 are about search + answers, not document browsing |
| **No Python** | Eliminates venv/pip/conda complexity. Single static binary + Ollama process |

---

## Current State

- **Phase 1** (extract + chunk) — ✅ Complete
- **Phase 2** (index + search) — ✅ Complete with enhancements beyond original plan
- **Phase 3** (RAG answers) — ✅ Complete
- **Known limitations**: single-PDF POC, in-memory chat history (lost on restart), no multi-document support

## License

MIT
