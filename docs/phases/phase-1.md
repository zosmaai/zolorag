# Phase 1: Foundation & PDF Ingestion Pipeline

> A Tauri app where a user can drag-and-drop a PDF and see its extracted text content in the UI.

---

## What Was Built

Phase 1 establishes the core user flow: **drag a PDF in → get text out**. No AI, no indexing, no RAG — just file handling, text extraction, chunking, and a UI to browse it.

```
User drops PDF → Text extraction (pdf-extract + lopdf) → Text displayed in UI page-by-page
                                                               │
                                                               └──→ Chunks generated for Phase 2
```

---

## Project Structure

```
zolo-rag/
├── src/                          # Next.js frontend
│   ├── app/
│   │   ├── layout.tsx            # Root layout
│   │   ├── page.tsx              # Main page (drop zone, sidebar, preview)
│   │   └── globals.css           # Tailwind + base styles
│   ├── components/
│   │   ├── DropZone.tsx          # SVG icon, drag-over animation, clickable
│   │   ├── DocumentSidebar.tsx   # PDF icon, file name + metadata, active state
│   │   ├── PreviewPanel.tsx      # Page-by-page text, extraction badges, page nav
│   │   └── StatusBar.tsx         # Status/error messages with icon
│   ├── hooks/
│   │   └── useTauriEvent.ts      # Generic Tauri event listener hook
│   └── types/
│       └── index.ts              # PdfDocument, PdfPage, Chunk types
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs               # Binary entry
│   │   ├── lib.rs                # Tauri commands: load_pdf, get_chunks
│   │   └── pdf/
│   │       ├── mod.rs            # Module exports
│   │       ├── extract.rs        # PDF text extraction (pdf-extract + lopdf fallback)
│   │       └── chunk.rs          # Text chunking (paragraph/sentence splitting)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/
│       └── default.json          # Permissions: core, dialog, opener
├── next.config.ts                # Static export for Tauri
├── postcss.config.mjs
├── tsconfig.json
├── package.json
└── .gitignore
```

---

## Rust Backend

### `pdf::extract` — PDF Text Extraction

**Strategy** (no OCR — pure Rust):

1. Try `pdf-extract` crate (handles most text-based PDFs)
2. If result is empty/gibberish, fall back to `lopdf` for hidden text layers (many scanned PDFs embed invisible OCR text)
3. If still nothing, return `ExtractError::NoText`

**Key types:**

```rust
enum ExtractionMethod { Direct, HiddenLayer, NoText }

struct PdfPage {
    page_num: usize,
    text: String,
    extraction_method: ExtractionMethod,
}

struct PdfDocument {
    file_name: String,
    total_pages: usize,
    pages: Vec<PdfPage>,
    total_chars: usize,
}
```

**Error handling:** `ExtractError` enum with `thiserror` — `FileNotFound`, `Encrypted`, `Corrupted`, `NoText`, etc. All errors propagate to the frontend as user-friendly strings.

### `pdf::chunk` — Text Chunking

Splits extracted text into chunks for downstream indexing (Phase 2).

**Strategy:**
- Split text by double newlines → paragraphs
- Each paragraph → its own chunk
- Paragraphs under 80 chars merge with the next paragraph
- Paragraphs over 2500 chars split at sentence boundaries (via `unicode-segmentation`)

**Config:** `ChunkConfig { target_tokens: 300, min_chars: 80, max_chars: 2500 }`

### Tauri Commands

| Command | Signature | What it does |
|---------|-----------|-------------|
| `load_pdf` | `(path: String) → PdfDocument` | Extract text + chunk, store in state |
| `get_chunks` | `() → Vec<Chunk>` | Return chunks of last loaded doc |

### Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `tauri` | 2 | Desktop app framework |
| `tauri-plugin-dialog` | 2 | Native file picker dialog |
| `tauri-plugin-opener` | 2 | Default opener (from scaffold) |
| `serde` / `serde_json` | 1 | Serialization |
| `thiserror` | 1 | Typed error handling |
| `anyhow` | 1 | Convenient error propagation |
| `pdf-extract` | 0.7 | PDF text extraction (pure Rust) |
| `lopdf` | 0.34 | Low-level PDF access (hidden text fallback) |
| `unicode-segmentation` | 1 | Sentence boundary splitting |

---

## Frontend

### User Flow

1. **Drop zone** — click opens native file dialog (via `@tauri-apps/plugin-dialog`), or drag PDFs onto the Tauri window (handled via `tauri://drag-drop` event)
2. **Loading** — status bar shows file name and progress
3. **Document sidebar** — lists all loaded PDFs with page count and character count
4. **Preview panel** — page-by-page text display with:
   - ✅ Text extracted badge (for text PDFs)
   - 🔍 Hidden text layer badge (for scanned PDFs with embedded OCR)
   - 📄 No text — scanned page badge (for image-only pages)
   - Previous/Next page navigation

### Key Decisions

| Decision | Why |
|----------|-----|
| **No browser DataTransfer** | Browser drag-drop gives file names, not paths. Use Tauri's `tauri://drag-drop` event instead |
| **`@tauri-apps/plugin-dialog`** | Native file dialog returns real file paths, works cross-platform |
| **Capability permissions** | Tauri v2 blocks plugin APIs unless explicitly allowed in `capabilities/default.json` |
| **No OCR (Tesseract)** | Tesseract isn't cross-platform by default. Most PDFs have extractable text or hidden layers. OCR can be added later via ONNX (candle) if needed |

---

## Build & Run

```bash
# Development
pnpm tauri dev

# Production build
pnpm tauri build

# Rust tests
cd src-tauri && cargo test
```

---

## Git

```bash
git init
git add .
git commit -m "phase-1: foundation & PDF ingestion pipeline"
```

---

## What's Next (Phase 2)

- Semantic encoding (embedding chunks via ONNX model)
- Bit vector index (binarize floats → Hamming KNN)
- Index persistence (save/load between sessions)
- Query → retrieve top-K chunks

The model downloader, `model_status` command, and `ModelBanner` component were **removed from Phase 1** — they belong in Phase 2 when the embedding model is actually needed.
