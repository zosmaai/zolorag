# Phase 3: RAG Generation with Ollama

> **Pre-requisite:** Phase 2 is complete. Key details about the actual Phase 2 implementation are noted throughout — the search pipeline is now hybrid (Hamming → float32 rescore → keyword blend), the UI is a chat interface, and there's no DocumentSidebar or PreviewPanel.

---

## End State

A user can:

1. **Drop a PDF** → text extracted → chunked → auto-encoded → indexed (Phase 2)
2. **Type a question** → relevant chunks are retrieved (Phase 2 hybrid search) → context prompt built → Ollama generates an answer → **streamed** into the existing chat UI with **inline source citations**
3. **Ask follow-up questions** → conversation history is used alongside the PDF context
4. **See which pages the answer came from** → every response cites source chunks (clickable → opens SourcePanel)
5. **Re-open the app** → previous index is restored, chat history is **not** persisted (session-only)

```
User query
    │
    ▼
┌──────────────────────┐     ┌─────────────────┐
│  Phase 2: Hybrid     │     │  Context Builder │
│  Retriever           │────▶│  (top-K chunks   │
│  (Hamming → float32  │     │   → prompt)     │
│   → keyword blend)   │     └────────┬─────────┘
└──────────────────────┘              │
                                     ▼
                        ┌──────────────────────────┐
                        │  Ollama /api/chat         │
                        │  (streaming, llama3.2:3b) │
                        └────────────┬─────────────┘
                                     │  SSE stream
                                     ▼
                        ┌──────────────────────────┐
                        │  Tauri Event Emitter      │
                        │  → Frontend ChatMessages  │
                        │  + Source Citations       │
                        └──────────────────────────┘
```

> **POC scope:** Single PDF, single conversation session. No persistent chat history across app restarts. Phase 3 adds the LLM generation that Phase 2 intentionally left out.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                           Phase 3 Additions                             │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────┐    ┌────────────────────┐    ┌───────────────┐   │
│  │  Phase 2          │    │  Context Builder   │    │  Ollama       │   │
│  │  BitIndex         │───▶│  (assemble top-K   │───▶│  Chat Client  │   │
│  │  + search_hybrid()│    │   chunks → prompt) │    │  (/api/chat)  │   │
│  └──────────────────┘    └────────────────────┘    └───────┬───────┘   │
│                                                             │           │
│                                                             ▼           │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  Tauri Event Stream (app_handle.emit)                        │      │
│  │  • rag:token — each text token from the LLM                  │      │
│  │  • rag:sources — final source chunk citations                 │      │
│  │  • rag:done — signal that generation is complete             │      │
│  │  • rag:error — error during generation                       │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  Chat History (in-memory, per session)                       │      │
│  │  Vec<ChatMessage> — system prompt + user Qs + assistant As   │      │
│  │  Follow-up queries include conversation context              │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  All calls to Ollama go through two APIs:                     │      │
│  │  • /api/embeddings  → Phase 2 (all-minilm, 384-dim)          │      │
│  │  • /api/chat        → Phase 3 (llama3.2:3b, streaming)       │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
└────────────────────────────────────────────────────────────────────────┘
```

### How It All Fits Together

```
Ollama (localhost:11434)
├── /api/embeddings  ──  Phase 2  ──  all-minilm model
│     Purpose: convert text chunks + queries to 384-dim vectors
│     Called when: indexing chunks, encoding user query
│     Response: {"embedding": [0.2, -0.5, ...]}
│
└── /api/chat        ──  Phase 3  ──  llama3.2:3b (or user's chosen model)
      Purpose: generate fluent answers grounded in retrieved chunks
      Called when: user asks a question
      Response: SSE stream of {"message": {"content": "..."}, "done": false}
```

### What Phase 2 Already Provides (No Changes Needed)

| Component | File | Used by Phase 3 |
|-----------|------|-----------------|
| Hybrid search | `index.rs::search_hybrid()` | Called by `ask_question` to retrieve top-K chunks |
| Query encoding | `encoder.rs::encode()` | Encodes the user's question into float32 + bit vector |
| Source viewer | `SourcePanel.tsx` | User clicks a source citation → opens panel showing the page |
| Model status | `manager.rs::check_model_status()` | Also checks if Ollama is running for the LLM model |
| Chat input | `ChatInput.tsx` | ✅ Already exists — Phase 3 uses as-is |
| Chat messages | `ChatMessages.tsx` | ✅ Already exists — Phase 3 extends to show streaming LLM text |

---

## Rust Backend: New Module

### `src-tauri/src/rag/mod.rs` — Module root

```rust
pub mod context;     // Context builder (chunks → prompt)
pub mod ollama;      // Ollama chat client (streaming)
pub mod chat;        // Chat history management
```

### `src-tauri/src/rag/context.rs` — Context Builder

A pure function that takes top-K chunks + the user query + chat history and assembles a prompt/message list for the LLM.

**Prompt structure (AskBit-inspired):**

```
System: You are a helpful PDF assistant. Answer the user's question based
solely on the provided context. If the context does not contain enough
information, say so. Cite the source pages in your answer.

Context:
--- Page 12 ---
The refund policy states that refunds are processed within 5 business
days after approval...

--- Page 5 ---
Customers may request an exchange within 14 days of receiving their
order...

---
```

```rust
pub struct ContextBuilder {
    max_context_chars: usize,     // Limit context to fit LLM window
    top_k: usize,                 // Number of chunks to include
}

impl ContextBuilder {
    pub fn build_messages(
        &self,
        query: &str,
        chunks: &[SearchResult],
        history: &[ChatMessage],
    ) -> Vec<OllamaMessage> {
        // 1. Assemble context from chunks (truncated to max_context_chars)
        // 2. Build system prompt with context
        // 3. Append chat history (last N turns)
        // 4. Append current user query
        // Return list of messages for /api/chat
    }
}
```

**Key behavior:**
- Chunks are ordered by relevance score (highest first) — **Phase 2 already returns them sorted**
- Each chunk shows its page number in the context for source citation
- Context is truncated to `max_context_chars` (default: ~6000 chars, safe for 4K-token models like llama3.2:3b)
- For larger context models (llama3.1:8b = 128K), this can be increased

### `src-tauri/src/rag/ollama.rs` — Ollama Chat Client

**Streaming via Server-Sent Events:**

```rust
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use futures::StreamExt;
use tauri::Emitter;

#[derive(Deserialize)]
struct OllamaChatChunk {
    message: Option<OllamaMessageContent>,
    done: bool,
}

#[derive(Deserialize)]
struct OllamaMessageContent {
    content: String,
}

pub struct OllamaChatClient {
    client: Client,    // Reuses the same reqwest::Client as Phase 2 encoder
    model: String,
    url: String,
}

impl OllamaChatClient {
    pub fn new(model: String) -> Self {
        Self {
            client: Client::new(),
            model,
            url: "http://localhost:11434/api/chat".into(),
        }
    }

    pub async fn stream_chat(
        &self,
        messages: &[OllamaMessage],
        app_handle: &tauri::AppHandle,
    ) -> Result<String, String> {
        let body = json!({
            "model": self.model,
            "messages": messages,
            "stream": true,
        });

        let response = self.client
            .post(&self.url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Ollama request failed: {e}"))?;

        let mut full_response = String::new();

        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            let text = String::from_utf8_lossy(&chunk);

            for line in text.lines() {
                if line.trim().is_empty() { continue; }
                if let Ok(parsed) = serde_json::from_str::<OllamaChatChunk>(line) {
                    if let Some(msg) = parsed.message {
                        let token = &msg.content;
                        full_response.push_str(token);
                        let _ = app_handle.emit("rag:token", token);
                    }
                    if parsed.done {
                        break;
                    }
                }
            }
        }

        Ok(full_response)
    }
}
```

> **Note:** Uses the same `reqwest::Client` pattern as Phase 2's `OllamaEncoder`. The existing `OllamaEncoder` in `encoder.rs` only handles `/api/embeddings`; this is a separate client for `/api/chat`. Both share the same HTTP library.

### `src-tauri/src/rag/chat.rs` — Chat History (In-Memory)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
    pub sources: Option<Vec<SearchResult>>,
}

pub struct ChatHistory {
    messages: Vec<ChatMessage>,
    max_turns: usize,  // Keep last N turns to fit context window
}

impl ChatHistory {
    pub fn add_user(&mut self, content: String) { ... }
    pub fn add_assistant(&mut self, content: String, sources: Vec<SearchResult>) { ... }
    pub fn recent_messages(&self) -> Vec<OllamaMessage> { ... }
    pub fn clear(&mut self) { ... }
}
```

### App State Updates

```rust
struct AppState {
    // Phase 1 & 2 (unchanged — matches actual Phase 2):
    current_document: Mutex<Option<PdfDocument>>,
    current_chunks: Mutex<Vec<Chunk>>,
    bit_index: Mutex<Option<BitIndex>>,
    encoder: OllamaEncoder,                    // Direct field, not Optional/Mutex
    index_path: Mutex<Option<PathBuf>>,

    // Phase 3 NEW:
    chat_history: Mutex<ChatHistory>,
    llm_model_status: Mutex<ModelStatus>,
    last_sources: Mutex<Vec<SearchResult>>,
}
```

> **⚠️ Match with Phase 2:** The `ModelStatus` here matches Phase 2's actual implementation — it's a **struct** (`{ ready: bool, message: String }`), not an enum. The `encoder` field is `OllamaEncoder` directly (no `Mutex<Option<>>`). The `embedding_model_status` field was removed in Phase 2 (frontend calls `check_model` on demand).

### New Tauri Commands

| Command | Signature | What it does |
|---------|-----------|-------------|
| `ask_question` | `(query: String, top_k: Option<u32>) → Result<()>` | Retrieve chunks via Phase 2's `search_hybrid()` → build context → stream answer via events. Returns immediately; tokens arrive via `rag:*` events. |
| `get_sources` | `() → Vec<SearchResult>` | Return the source chunks for the last generated answer |
| `clear_chat` | `() → ()` | Clear conversation history |
| `get_chat_history` | `() → Vec<ChatMessage>` | Return current chat history for UI display |
| `check_llm_model` | `() → Result<ModelStatus>` | Check if the LLM model is downloaded and ready |
| `set_llm_model` | `(model: String) → Result<()>` | Switch LLM model (e.g., "llama3.2:3b" vs "llama3.1:8b") |

> **Note:** `ask_question` reuses the existing `state.encoder.encode()` and `bit_index.search_hybrid()` from Phase 2 — no duplicated retrieval code.

### Tauri Events (Frontend Listens)

| Event | Payload | When |
|-------|---------|------|
| `rag:token` | `String` | Each token streamed from Ollama |
| `rag:sources` | `Vec<SearchResult>` | After answer completes — the source chunks used |
| `rag:done` | `String` (full answer) | Generation complete |
| `rag:error` | `String` | Error occurred during generation |

---

## Dependencies

**Zero new crates.** Everything needed is already in the dependency tree from Phase 2:

| Crate | Purpose | Added in |
|-------|---------|----------|
| `reqwest` | HTTP client for Ollama `/api/chat` | Phase 2 |
| `serde_json` | JSON deserialization | Tauri + Phase 2 |
| `futures` | Stream processing (`StreamExt`) | Phase 2 |
| `tauri` | Event emission (`app_handle.emit`) | Already |

**No new crates to add to `Cargo.toml`.**

---

## Frontend Updates

### Existing Components (Used As-Is)

| Component | File | Role in Phase 3 |
|-----------|------|-----------------|
| `ChatInput.tsx` | Already built | Input bar at bottom — unchanged |
| `ChatMessages.tsx` | Already built | Message rendering — **extended** to show streaming LLM text |
| `SourcePanel.tsx` | Already built | Slide-out PDF page viewer when user clicks a source citation |
| `ModelBanner.tsx` | Already built | Shows model status — extended to also check LLM model |
| `DropZone.tsx` | Already built | PDF drop — unchanged |

### Changes to ChatMessages.tsx

The current `ChatMessages` shows two message types:
- `type: "user"` — query bubble
- `type: "assistant"` — search result cards

Phase 3 adds a third type:
- `type: "assistant_llm"` — streaming LLM response with inline source citations

```typescript
export interface ChatMessageItem {
    id: string;
    type: "user" | "assistant" | "assistant_llm";  // NEW type
    query?: string;
    results?: SearchResult[];
    text?: string;          // NEW: accumulated LLM response text
    isStreaming?: boolean;   // NEW: true while tokens are arriving
    timestamp: number;
}
```

The `assistant_llm` message type renders:
1. The streaming text (updated token-by-token via `rag:token` events)
2. A blinking cursor while `isStreaming` is true
3. Source citation badges after `rag:sources` is received
4. Each source badge links to the page (opens `SourcePanel`)

### New: Event Listener Hook

```typescript
// src/hooks/useRagStream.ts
export function useRagStream(
    onToken: (token: string) => void,
    onSources: (sources: SearchResult[]) => void,
    onDone: (fullAnswer: string) => void,
    onError: (error: string) => void,
) {
    useEffect(() => {
        const unlisteners: Promise<() => void>[] = [];
        
        const setup = async () => {
            unlisteners.push(
                (await listen<string>("rag:token", (e) => onToken(e.payload)))
            );
            unlisteners.push(
                (await listen<SearchResult[]>("rag:sources", (e) => onSources(e.payload)))
            );
            unlisteners.push(
                (await listen<string>("rag:done", (e) => onDone(e.payload)))
            );
            unlisteners.push(
                (await listen<string>("rag:error", (e) => onError(e.payload)))
            );
        };
        setup();
        
        return () => { unlisteners.forEach(p => p.then(fn => fn())); };
    }, []);
}
```

### Phase 3 Layout

```
┌──────────────────────────────────────────────────┐
│  🧠 zoloRAG    [📄 doc1.pdf]    [🧠 Model Ready] │
├──────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────┐    │
│  │  Chat Messages (scrollable)              │    │
│  │                                          │    │
│  │  👤 You — "What is the refund policy?"   │    │
│  │  ┌──────────────────────────────────┐    │    │
│  │  │ 🤖 The refund policy states       │    │    │
│  │  │ that refunds are processed       │    │    │
│  │  │ within 5 business days after     │    │    │
│  │  │ approval. [citation: Page 12]    │    │    │
│  │  │                                  │    │    │
│  │  │ 📄 Sources: Page 12 · 87% match  │    │    │
│  │  └──────────────────────────────────┘    │    │
│  │                                          │    │
│  │  👤 You — "And exchanges?"               │    │
│  │  ┌──────────────────────────────────┐    │    │
│  │  │ 🤖 Exchanges can be requested     │    │    │
│  │  │ within 14 days... █              │    │    │ (streaming)
│  │  └──────────────────────────────────┘    │    │
│  └──────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────┐    │
│  │  Ask a question...                   [→] │    │
│  └──────────────────────────────────────────┘    │
├──────────────────────────────────────────────────┤
│  47 chunks indexed · Model: llama3.2:3b          │
└──────────────────────────────────────────────────┘
```

### User Flow in Phase 3

```
1. Open app
2. Drag PDF → auto-indexed (Phase 1 + 2)
3. Type question in ChatInput, press Enter
   → Frontend adds user message to chat
   → Frontend calls ask_question command
   → Rust: Phase 2 encoder.encode(query) → float32 + bit vector
   → Rust: Phase 2 search_hybrid() → top-5 SearchResults
   → Rust: ContextBuilder assembles system + context + history messages
   → Rust: OllamaChatClient.stream_chat() → POST /api/chat
   → Rust: Emits rag:token events for each token
   → Frontend: appends tokens to assistant message bubble
   → Rust: Emits rag:sources with the retrieved SearchResults
   → Frontend: shows source citation badges
   → Rust: Emits rag:done with full answer text
   → Frontend: finalizes message, enables input
4. Type follow-up: "And exchanges?"
   → Same pipeline, but ChatHistory includes previous Q&A
   → LLM sees conversation context
5. Click a source citation → SourcePanel slides open showing the page
6. "Clear chat" button → resets conversation history (index stays)
```

---

## Implementation Order

### Step 1: Chat History (easy)
- `chat.rs` — Vec-based in-memory history with max turn limit
- **Test:** Add messages, verify truncation at max_turns

### Step 2: Context Builder (easy)
- `context.rs` — pure function, no external dependencies
- **Test:** Pass 3 chunks + a query, verify the assembled prompt contains all chunks with page numbers, system instructions, and the query

### Step 3: Ollama Chat Client (medium)
- `ollama.rs` — POST to `/api/chat` with `stream: true`
- Parse NDJSON stream, emit `rag:*` events via `app_handle.emit()`
- **Test:** Call directly against Ollama with a known prompt, verify streaming works

### Step 4: `ask_question` Command (medium)
- Wire together: encode query → search_hybrid() → build context → stream chat → emit events
- Store sources + response in chat history
- **Test:** Full pipeline with a real PDF and Ollama running

### Step 5: Frontend Event Wiring (medium)
- Add `useRagStream` hook to `page.tsx`
- Extend `ChatMessages.tsx` to handle `assistant_llm` message type
- Add streaming text display with blinking cursor
- Add source citation badges after response completes
- **Test:** E2E: drop PDF → ask question → see streaming answer → click sources → see SourcePanel

---

## Model Selection

Phase 3 introduces the LLM selection. The Phase 2 embedding model is fixed to `all-minilm` (384-dim, matched to AskBit).

| Model | Context | Quality | Speed | Size |
|-------|:-------:|:-------:|:-----:|:----:|
| `llama3.2:3b` | 4K | Good | ⚡ Fast | ~2GB |
| `llama3.1:8b` | 128K | Better | 🐢 Slower | ~4.7GB |
| `mistral:7b` | 32K | Good | ⚡ Fast | ~4.1GB |
| `phi3:mini` | 128K | Good | ⚡ Fast | ~2.3GB |

**Default for POC:** `llama3.2:3b` — smallest, fastest, good enough for single-PDF Q&A.

**Context window consideration:**
- With 5 chunks at ~500 chars each, context is ~2500 chars
- System prompt + chat history add ~500 chars
- Total: ~3000 chars (~750 tokens) — well within 4K-token models
- For larger models with 128K+ context, can increase `top_k` and `max_context_chars`

---

## Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **Ollama not running** when user asks a question | Same check as Phase 2 model manager (`check_model_status`). If Ollama is down, `ask_question` returns an error, frontend shows "Please start Ollama." |
| **LLM model not pulled** | Auto-pull via `ollama pull llama3.2:3b` on first `ask_question`. Show progress in ModelBanner. |
| **Streaming too slow** | Show blinking cursor/typing indicator while waiting for first token. llama3.2:3b first-token latency is ~200ms on modern hardware. |
| **Context window overflow** | `ContextBuilder` truncates to `max_context_chars`. `ChatHistory` truncates to `max_turns`. Both configurable. |
| **Hallucination** | System prompt: "answer based solely on provided context." Source citations let users verify. |

---

## Build Time Estimate

| Step | Time | Deliverable |
|------|------|-------------|
| Chat History | 0.5 day | `chat.rs` — in-memory with truncation |
| Context Builder | 0.5 day | `context.rs` — chunks → prompt, tested |
| Ollama chat client | 1 day | `ollama.rs` — streaming POST, event emission |
| `ask_question` command | 0.5 day | Wire Phase 2 retriever → context → chat → events |
| Frontend event wiring | 1 day | `useRagStream` hook, extended `ChatMessages`, source badges |
| E2E validation | 0.5 day | Full pipeline test with real PDF + Ollama |
| **Total** | **~4 days** | |

---

## Discrepancies from Original Phase 2 Plan (Resolved)

The original Phase 2 plan assumed certain things that changed during implementation. These are already reflected in the updated Phase 2. Key impacts on Phase 3:

| Original assumption | Actual Phase 2 | Impact on Phase 3 |
|--------------------|----------------|-------------------|
| DocumentSidebar + PreviewPanel layout | Chat + SourcePanel layout | ✅ Phase 3 layout above is accurate |
| `search()` — pure Hamming | `search_hybrid()` — float32 rescored | ✅ `ask_question` calls `search_hybrid()` |
| `ModelStatus` enum | `ModelStatus` struct | ✅ AppState uses struct |
| `encoder: Mutex<Option<OllamaEncoder>>` | `encoder: OllamaEncoder` | ✅ No wrapping needed |
| `SearchResults.tsx` + `SearchBar.tsx` | `ChatMessages.tsx` + `ChatInput.tsx` | ✅ Phase 3 extends existing chat components |

---

## What's Next (Phase 4+ ideas)

- **Settings UI** — model selection, chunk size, top-K slider, context window limit
- **Persistent chat history** — save/load conversations alongside the index
- **Multi-document support** — query across several indexed PDFs
- **OCR fallback** — candle + vision model for scanned PDFs
- **Document management** — add/remove/re-index individual documents
