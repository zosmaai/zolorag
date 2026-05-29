<div align="center">
 <img src="./public/zolorag-logo.png" alt="ZoloRAG" width="180" height="180">
 <br>
 <strong>ZoloRAG - Local PDF Chat — drag, drop, and ask questions about your documents.</strong>
 <p>
 <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT">
 <a href=".github/workflows/build.yml"><img src="https://img.shields.io/badge/build-CI%E2%80%93ready-blue?logo=githubactions" alt="Build"></a>
 <a href="#build"><img src="https://img.shields.io/badge/download-.dmg%20%7C%20.exe%20%7C%20.deb-blue?logo=github" alt="Downloads"></a>
 <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="Platforms">
 <img src="https://img.shields.io/badge/Rust-1.80+-orange?logo=rust" alt="Rust">
 <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome">
 </p>
 <p>
 <a href="#features">Features</a> •
 <a href="#quick-start">Quick Start</a> •
 <a href="#how-it-works">How It Works</a> •
 <a href="#project-status">Status</a> •
 <a href="docs/phases/phase-6.md">Android&nbsp;Plan</a> •
 <a href="CONTRIBUTING.md">Contributing</a>
 </p>
</div>

<br>

ZoloRAG is a fully local RAG (Retrieval-Augmented Generation) desktop app for chatting with PDF documents. Drop a PDF, ask questions, get answers — everything runs **in a single process**, no external services, no cloud. All ML inference happens on your machine using in-process Rust libraries — no Python runtime, no Ollama daemon, no HTTP calls to localhost.

---

## Motivation

ZoloRAG was born from a simple question: **how far can you push small language models for real-world, niche use cases on commodity hardware?**

Most AI tools today assume you have a beefy GPU, a cloud API budget, or at minimum an Ollama daemon running a 7B+ model. But the vast majority of documents people want to ask questions about are single PDFs — contracts, manuals, resumes, research papers — tasks that don't need a frontier model.

This project experiments with:

- **Binary-quantized embeddings** — 384-bit vectors searched via CPU popcount instead of full float32 similarity. Can you get 96%+ of dense retrieval quality with 12.5% of the memory?
- **3B-class LLMs** (Llama 3.2 3B, Qwen2.5 1.5B) running at Q4\_K\_M on a CPU. Can a model that fits in 1–2 GB of RAM produce useful answers for focused document Q&A?
- **Zero external dependencies** — no Python, no ONNX runtime, no HTTP microservices. Just Rust, `candle`, and `llama.cpp` compiled into a single binary. What does it take to make ML feel like native code?
- **Lowest possible hardware floor** — the goal is a usable experience on a 4-core, 8 GB RAM office laptop from 2019. Not a gaming rig, not a MacBook Pro, just the machine most people actually own.

Every design decision — from binary Hamming search to GGUF quantization to in-process inference — is driven by this constraint: **make it run well on the hardware people already have.**

---

## Features

### PDF Ingestion
When you drop a PDF onto the app, `pdf-extract` pulls the text out page by page. If the PDF uses hidden text layers (common in scanned documents with OCR), `lopdf` handles the fallback. The text is split into chunks — grouped by paragraph, then split at sentence boundaries for long paragraphs. Each chunk targets ~256 tokens, balancing retrieval precision with context window efficiency. The extraction method is shown as a badge so you know whether the text came directly from the PDF or from a hidden layer.

### Semantic Search
Every text chunk is encoded into a 384-dimensional float vector using a BERT model (`all-MiniLM-L6-v2`) running in-process via the [`candle`](https://github.com/huggingface/candle) ML framework. These vectors capture semantic meaning — similar concepts cluster together in vector space, even when they use different words.

Search uses a **3-stage hybrid pipeline**:
1. **Hamming popcount** — binary vectors (384-bit → 48 bytes) scanned via CPU popcount, ~0.01ms per 100K chunks
2. **Cosine rescore** — top 20 candidates re-ranked with full float32 precision
3. **Keyword blend** — 60% semantic / 40% lexical overlap to catch exact-name queries

The index is persisted to disk via bincode, so you don't re-index on restart.

### RAG Answers
When you ask a question, the app retrieves the most relevant chunks and builds a prompt using the **Llama 3 instruct template**. The prompt includes system instructions, retrieved chunks (with page numbers), recent chat history for follow-up context, and your question. This prompt is fed into the in-process LLM engine via [`llama.cpp`](https://github.com/ggerganov/llama.cpp) FFI.

Tokens stream back in real time: each generated token fires a `rag:token` Tauri event, the frontend appends it to the message, and you see the answer appear word by word. Source chunks are attached to each answer as clickable page badges — clicking one slides out a panel showing the original PDF page.

### Fully Self-Contained
The entire app is a single Rust binary with no external services. The embedding model runs in-process via `candle`, the LLM runs in-process via `llama.cpp` bindings. No Python runtime, no Ollama daemon, no HTTP calls to localhost for inference. On the first launch, a setup panel guides you through downloading both models from HuggingFace with progress bars and pause/resume support. After that, everything works offline.

### UI
Clean chat interface — one PDF at a time, no sidebar clutter. First launch shows a setup panel with download progress. Light and dark mode follow your system preference. The font stack uses system fonts for zero download overhead. Source panel slides out from the right when you click a citation badge.

---

## Quick Start

### Prerequisites

- **macOS** (Apple Silicon or Intel), **Linux** (x86_64), or **Windows** (x86_64)
- **Rust toolchain** — [rustup.rs](https://rustup.rs)
- **Node.js 20+** + **pnpm**
- **~2.7 GB free disk space** (models download on first launch)

### Run

```bash
pnpm install
npx tauri dev
```

On first launch, the setup panel guides you through downloading the ML models. Drop a PDF and start asking questions.

### Build

#### Local build (current platform)

```bash
# macOS → .dmg
pnpm builds:mac

# Windows → .exe (NSIS installer)
pnpm builds:win

# Linux → .deb + .AppImage
pnpm builds:linux

# Current platform auto-detect
pnpm builds
```

Output: standalone desktop installers in `builds/<platform>/`.

#### CI builds (all platforms via GitHub Actions)

Every push to `main` triggers [`.github/workflows/build.yml`](.github/workflows/build.yml), which builds on three native runners in parallel:

| Platform | Runner | Artifact |
|----------|--------|----------|
| macOS | `macos-latest` | `ZoloRAG_<version>_aarch64.dmg` |
| Windows | `windows-latest` | `ZoloRAG_<version>_x64-setup.exe` |
| Linux | `ubuntu-latest` | `.deb` + `.AppImage` |

To trigger a build manually:
1. Go to your repo on GitHub
2. **Actions** → **Build ZoloRAG** → **Run workflow** (branch: `main`)
3. Wait ~15–25 minutes
4. Download installers from the **Summary** page (Artifacts section)

> **Note:** Cross-compilation isn't supported — each platform must build natively because `llama-cpp-sys` compiles platform-specific C++ code (llama.cpp). The CI workflow runs on native GitHub runners for each OS.

> **macOS Gatekeeper:** The CI build is ad-hoc signed (no Apple Developer ID certificate). The first time you open the downloaded `.dmg` installer, macOS may show "Apple could not verify ZoloRAG is free of malware." This is expected — try one of these to bypass:
>
> 1. **Right-click (Ctrl+click) the app → Open → click Open** — this adds a one-time Gatekeeper exception. You only need to do this once per download.
> 2. If the right-click method does **not** work (e.g., Gatekeeper still blocks it even after clicking "Open"), remove the quarantine attribute directly:
>    ```bash
>    xattr -dr com.apple.quarantine /Applications/ZoloRAG.app
>    ```
>    This strips the "downloaded from the internet" flag that triggers Gatekeeper. After running it, you can open the app normally.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | [Tauri 2](https://v2.tauri.app/) (Rust) |
| Frontend | Next.js 16, TypeScript, [Tailwind CSS](https://tailwindcss.com/) |
| PDF extraction | [`pdf-extract`](https://crates.io/crates/pdf-extract) + [`lopdf`](https://crates.io/crates/lopdf) |
| Embeddings | [`candle`](https://github.com/huggingface/candle) (all-MiniLM-L6-v2, 384-dim, ~85 MB) |
| Search | Binary Hamming → float32 cosine rescore → keyword blend |
| LLM | [`llama-cpp-2`](https://crates.io/crates/llama-cpp-2) (Llama 3.2 3B Q4_K_M GGUF, ~1.8 GB) |
| Model download | Direct HTTP from HuggingFace with pause/resume, progress events |
| Serialization | [`bincode`](https://crates.io/crates/bincode) (index persistence) |
| Styling | CSS custom properties (OKLCH color space, dark/light mode) |
| CI/CD | GitHub Actions (macOS, Linux, Windows builds) |
| Linting | Biome (frontend), Clippy + rustfmt (backend) |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│     ZoloRAG (Single Process)      │
│                 │
│ PDF dropped              │
│ │                │
│ ▼                │
│ ┌─────────────────────────┐          │
│ │ Phase 1: Extract + Chunk│          │
│ │ pdf-extract + lopdf  │  ┌──────────────────────────┐ │
│ │ → text pages   │  │ Model Runtime   │ │
│ │ → paragraph/sentence │  │ ┌────────────────────┐ │ │
│ │ chunking    │  │ │ ml/embed.rs  │ │ │
│ └──────────┬──────────────┘  │ │ CandleEncoder  │ │ │
│    │     │ │ (all-MiniLM-L6-v2 │ │ │
│    ▼     │ │ via candle,  │ │ │
│ ┌─────────────────────────┐  │ │ 384-dim BERT)  │ │ │
│ │ Phase 2: Index + Search │  │ └────────────────────┘ │ │
│ │       │  │ ┌────────────────────┐ │ │
│ │ CandleEncoder → 384-dim │  │ │ ml/llm.rs   │ │ │
│ │ float → binarize to  │  │ │ LlamaCppEngine │ │ │
│ │ 48-byte bit vector  │  │ │ (Llama 3.2 3B  │ │ │
│ │ + term index   │  │ │ via llama.cpp │ │ │
│ │       │  │ │ FFI, 1.8 GB  │ │ │
│ │ 3-stage hybrid search: │  │ │ Q4_K_M GGUF)  │ │ │
│ │ 1. Hamming popcount  │  │ └────────────────────┘ │ │
│ │ 2. Cosine rescore  │  └──────────────────────────┘ │
│ │ 3. Keyword blend  │          │
│ └──────────┬──────────────┘          │
│    │              │
│    ▼              │
│ ┌─────────────────────────┐          │
│ │ Phase 3: Answer  │          │
│ │       │          │
│ │ ContextBuilder   │────→ LlamaCppEngine.generate()  │
│ │ → chunks + history → │  (in-process, no HTTP)   │
│ │ Llama 3 chat template│  → token callback    │
│ │ │       │  → rag:* Tauri events   │
│ │ Streaming via rag:* │◄────┘        │
│ │ Tauri events   │          │
│ └──────────┬──────────────┘          │
│    │              │
│    ▼              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ UI (Next.js + Tauri Desktop)        │ │
│ │               │ │
│ │ ┌───────────────────────────────────────────────────┐ │ │
│ │ │ Setup Panel (first launch)      │ │ │
│ │ │ Embedding model ████████████ 100%   │ │ │
│ │ │ Language model ████████░░░░ 72% ️   │ │ │
│ │ └───────────────────────────────────────────────────┘ │ │
│ │               │ │
│ │ ┌───────────────────────────────────────────────────┐ │ │
│ │ │ Chat Messages (streaming LLM text)    │ │ │
│ │ │ Source: Page 12 · 87% ← click     │ │ │
│ │ │ → SourcePanel slides out       │ │ │
│ │ └───────────────────────────────────────────────────┘ │ │
│ │ ┌───────────────────────────────────────────────────┐ │ │
│ │ │ Ask a question...       [→] │ │ │
│ │ └───────────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## How It Works

### Startup Flow
1. App launches → checks if both model files exist on disk
2. If models are missing, a **Setup Panel** appears with download buttons and progress bars
3. Models download from HuggingFace directly (with pause/resume support)
4. Once downloaded, models load into memory on demand
5. User sees the DropZone → uploads a PDF → chatting begins

### Embedding
- `CandleEncoder` loads `all-MiniLM-L6-v2` via the `candle` ML framework
- Tokenization via HuggingFace `tokenizers` crate (WordPiece)
- BERT forward pass produces 384-dim float vectors
- Mean pooling + L2 normalization (standard sentence-transformers post-processing)
- Binarization: `float > 0.0` → 384-bit vector packed into 6 × u64

### LLM Inference
- `LlamaCppEngine` loads a GGUF file via `llama-cpp-2` (Rust bindings to llama.cpp)
- Prompt is formatted using the **Llama 3 instruct template**
- Tokenization uses the model's built-in BPE tokenizer
- Autoregressive generation: decode prompt → sample → emit token → decode next → loop
- Streaming via a callback that fires `rag:token` Tauri events per token

### Model Download Manager
- `ml/download.rs` handles downloading from HuggingFace with:
 - **Progress reporting** via callback → frontend progress bars
 - **Pause/resume** via HTTP Range headers (partial download detection)
 - **Atomic writes**: download to `.partial` file, rename on completion
 - **Cache detection**: checks file existence before downloading

### Models Downloaded on First Launch

| Model | Size | Purpose |
|-------|------|---------|
| `all-MiniLM-L6-v2` (safetensors) | ~85 MB | Text embeddings |
| `Llama-3.2-3B-Instruct-Q4_K_M` (GGUF) | ~1.8 GB | Answer generation |

---

## Project Status

| Phase | What | Status |
|-------|------|--------|
| **1** | PDF extraction & chunking (`pdf-extract` + `lopdf`, paragraph/sentence splitting) | Complete |
| **2** | Semantic index & hybrid search (binary Hamming → float32 cosine rescore → keyword blend) | Complete |
| **3** | RAG answer generation with streaming, source citations, chat history | Complete |
| **4** | In-process embeddings via `candle` (all-MiniLM-L6-v2, removed Ollama dependency) | Complete |
| **5** | In-process LLM via `llama.cpp` (Llama 3.2-3B GGUF, fully self-contained binary) | Complete |
| **6** | **Android mobile** — port to Tauri Android with mobile UI, content URI handling, smaller LLM | Planned |

> See [`docs/phases/phase-6.md`](docs/phases/phase-6.md) for the full Android plan.

---

## Project Structure

```
src/       # Frontend (Next.js + TypeScript)
├── app/
│ ├── page.tsx    # Main chat UI + setup flow
│ ├── layout.tsx   # Root layout
│ └── globals.css   # CSS variables, themes, animations
├── components/
│ ├── SetupPanel.tsx  # First-launch model download UI
│ ├── ChatInput.tsx   # Text input + send button
│ ├── ChatMessages.tsx  # Message timeline (user, assistant, streaming)
│ ├── DropZone.tsx   # PDF upload area
│ └── SourcePanel.tsx  # Slide-out PDF page viewer
├── hooks/
│ └── useTauriEvent.ts  # Event listener helper
└── types/
 └── index.ts    # Shared TypeScript types

src-tauri/     # Backend (Rust)
├── src/
│ ├── main.rs    # Entry point
│ ├── lib.rs    # Tauri commands + app state
│ ├── ml/
│ │ ├── mod.rs   # Module root
│ │ ├── embed.rs   # CandleEncoder (BERT via candle)
│ │ ├── llm.rs   # LlamaCppEngine (llama.cpp FFI)
│ │ └── download.rs  # Model download manager (HF Hub)
│ ├── index/
│ │ ├── mod.rs
│ │ ├── manager.rs  # Model status types
│ │ └── index.rs   # BitIndex, TermIndex, hybrid search
│ ├── pdf/
│ │ ├── mod.rs
│ │ ├── extract.rs  # PDF text extraction
│ │ └── chunk.rs   # Paragraph/sentence chunking
│ └── rag/
│  ├── mod.rs
│  ├── chat.rs   # Chat history (in-memory)
│  └── context.rs  # Context builder (chunks → prompt template)
├── Cargo.toml
└── tauri.conf.json
```

---

## References

This project builds on techniques from:

- **[askbit](https://github.com/Shanvit7/askbit)** — The binarization RAG approach (bit packing, Hamming distance search) used in Phase 2.
- **[email-triage-slm](https://github.com/Shanvit7/email-triage-slm)** — The in-process native LLM inference strategy that informed Phase 5's transition away from Ollama.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development environment setup
- Coding conventions (Rust + TypeScript)
- Conventional commit style
- Pull request process
- Bug report and feature request guidelines

---

## License

MIT © 2026 [Zosma AI](https://github.com/zosmaai)
