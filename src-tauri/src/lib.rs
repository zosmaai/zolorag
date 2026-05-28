pub mod index;
pub mod pdf;
pub mod rag;

use index::{
    check_llm_model_status, check_model_status, pull_model, BitIndex, ChunkInfo, EncodedVector,
    IndexStatus, IndexSummary, ModelStatus, OllamaEncoder, SearchResult,
};
use pdf::chunk::Chunk;
use pdf::extract::PdfDocument;
use rag::{ChatHistory, ContextBuilder, OllamaChatClient};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

// ---------------------------------------------------------------------------
// App State
// ---------------------------------------------------------------------------

struct AppState {
    current_document: Mutex<Option<PdfDocument>>,
    current_chunks: Mutex<Vec<Chunk>>,
    bit_index: Mutex<Option<BitIndex>>,
    encoder: OllamaEncoder,
    index_path: Mutex<Option<PathBuf>>,
    // Phase 3
    chat_history: Mutex<ChatHistory>,
    context_builder: ContextBuilder,
    llm_client: OllamaChatClient,
    last_sources: Mutex<Vec<SearchResult>>,
}

// ---------------------------------------------------------------------------
// Phase 1 Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn load_pdf(path: String, state: State<AppState>) -> Result<PdfDocument, String> {
    let doc = pdf::extract::extract_text(&path).map_err(|e| e.to_string())?;
    let chunks = pdf::chunk::chunk_document(&doc);

    *state.current_document.lock().unwrap() = Some(doc.clone());
    *state.current_chunks.lock().unwrap() = chunks;

    Ok(doc)
}

#[tauri::command]
fn get_chunks(state: State<AppState>) -> Result<Vec<Chunk>, String> {
    let chunks = state.current_chunks.lock().unwrap().clone();
    Ok(chunks)
}

// ---------------------------------------------------------------------------
// Phase 2 Commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn check_model(app: tauri::AppHandle) -> Result<ModelStatus, String> {
    let state = app.state::<AppState>();
    let client_clone = state.encoder.client();
    let status = check_model_status(&client_clone).await;
    Ok(status)
}

#[tauri::command]
async fn pull_embedding_model(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let client_clone = state.encoder.client();
    pull_model(&client_clone, "all-minilm").await
}

#[tauri::command]
async fn index_document(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<IndexSummary, String> {
    let chunks = {
        let guard = state.current_chunks.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    if chunks.is_empty() {
        return Err("No chunks to index. Load a PDF first.".into());
    }

    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let encoded: Vec<EncodedVector> = state.encoder.encode_batch(&texts).await?;

    let mut bit_index = BitIndex::new();
    for (i, chunk) in chunks.iter().enumerate() {
        bit_index.add_chunk(
            ChunkInfo {
                chunk_id: chunk.id,
                doc_name: chunk.doc_name.clone(),
                page: chunk.page,
                text: chunk.text.clone(),
            },
            encoded[i].bit_vector.clone(),
            encoded[i].float_vector.clone(),
        );
    }

    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("Cannot create app dir: {e}"))?;
    let index_path = app_dir.join("index.bin");
    bit_index.save(&index_path)?;

    *state.bit_index.lock().map_err(|e| e.to_string())? = Some(bit_index);
    *state.index_path.lock().map_err(|e| e.to_string())? = Some(index_path.clone());

    Ok(IndexSummary {
        doc_count: 1,
        chunk_count: chunks.len(),
        index_path: index_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn load_index(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<IndexSummary>, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    let index_path = app_dir.join("index.bin");

    if !index_path.exists() {
        return Ok(None);
    }

    match BitIndex::load(&index_path) {
        Ok(bit_index) => {
            let chunk_count = bit_index.len();
            *state.bit_index.lock().map_err(|e| e.to_string())? = Some(bit_index);
            *state.index_path.lock().map_err(|e| e.to_string())? = Some(index_path.clone());
            Ok(Some(IndexSummary {
                doc_count: 1,
                chunk_count,
                index_path: index_path.to_string_lossy().to_string(),
            }))
        }
        Err(e) => Err(format!("Failed to load existing index: {e}")),
    }
}

#[tauri::command]
async fn query_index(
    query: String,
    top_k: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<SearchResult>, String> {
    let k = top_k.unwrap_or(5) as usize;

    let encoded = state.encoder.encode(&query).await?;

    let bit_index = state
        .bit_index
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No index found. Load and index a PDF first.".to_string())?;

    let results = bit_index.search_hybrid(&encoded.bit_vector, &encoded.float_vector, &query, k);
    Ok(results)
}

#[tauri::command]
fn get_index_status(state: State<AppState>) -> Result<IndexStatus, String> {
    let chunk_count = state
        .bit_index
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|idx| idx.len())
        .unwrap_or(0);

    let docs = state
        .bit_index
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|idx| idx.doc_names())
        .unwrap_or_default();

    Ok(IndexStatus {
        indexed_chunks: chunk_count,
        indexed_docs: docs,
    })
}

// ---------------------------------------------------------------------------
// Phase 3 Commands
// ---------------------------------------------------------------------------

/// Ask a question: retrieve chunks → build context → stream LLM answer via events.
///
/// Events emitted:
/// - `rag:token` (String) — each token from the LLM
/// - `rag:sources` (Vec<SearchResult>) — source chunks used
/// - `rag:done` (String) — full answer text
/// - `rag:error` (String) — error message
#[tauri::command]
async fn ask_question(
    query: String,
    top_k: Option<u32>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let k = top_k.unwrap_or(5) as usize;

    // 1. Encode query
    let encoded = state.encoder.encode(&query).await.map_err(|e| {
        let err_msg = e.clone();
        let _ = app.emit("rag:error", err_msg);
        e
    })?;

    // 2. Retrieve chunks
    let bit_index = state
        .bit_index
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| {
            let msg = "No index found. Load and index a PDF first.".to_string();
            let _ = app.emit("rag:error", msg.clone());
            msg
        })?;

    let chunks = bit_index.search_hybrid(
        &encoded.bit_vector,
        &encoded.float_vector,
        &query,
        k,
    );

    // 3. Store sources
    *state.last_sources.lock().map_err(|e| e.to_string())? = chunks.clone();

    // 4. Add user message to history
    state
        .chat_history
        .lock()
        .map_err(|e| e.to_string())?
        .add_user(query.clone());

    // 5. Build context from chunks + history
    let history = state
        .chat_history
        .lock()
        .map_err(|e| e.to_string())?
        .all_messages()
        .to_vec();

    let messages = state
        .context_builder
        .build_messages(&query, &chunks, &history);

    // 6. Stream answer from Ollama
    let answer = state.llm_client.stream_chat(&messages, &app).await?;

    // 7. Store answer + sources in history
    state
        .chat_history
        .lock()
        .map_err(|e| e.to_string())?
        .add_assistant(answer, chunks);

    Ok(())
}

/// Return the source chunks for the last generated answer.
#[tauri::command]
fn get_sources(state: State<AppState>) -> Result<Vec<SearchResult>, String> {
    let sources = state.last_sources.lock().map_err(|e| e.to_string())?.clone();
    Ok(sources)
}

/// Clear conversation history.
#[tauri::command]
fn clear_chat(state: State<AppState>) -> Result<(), String> {
    state
        .chat_history
        .lock()
        .map_err(|e| e.to_string())?
        .clear();
    Ok(())
}

/// Get current chat history for UI display.
#[tauri::command]
fn get_chat_history(state: State<AppState>) -> Result<Vec<rag::ChatMessage>, String> {
    let messages = state
        .chat_history
        .lock()
        .map_err(|e| e.to_string())?
        .all_messages()
        .to_vec();
    Ok(messages)
}

/// Check if the LLM model is available in Ollama.
#[tauri::command]
async fn check_llm_model(app: tauri::AppHandle) -> Result<ModelStatus, String> {
    let state = app.state::<AppState>();
    let client_clone = state.encoder.client();
    let model = state.llm_client.model().to_string();
    let status = check_llm_model_status(&client_clone, &model).await;
    Ok(status)
}

/// Pull the LLM model via Ollama.
#[tauri::command]
async fn pull_llm_model(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let client_clone = state.encoder.client();
    let model = state.llm_client.model().to_string();
    pull_model(&client_clone, &model).await
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let encoder = OllamaEncoder::new();
    let llm_client = OllamaChatClient::new(None); // defaults to llama3.2:3b
    let context_builder = ContextBuilder::default();
    let chat_history = ChatHistory::new(10); // keep last 10 turns

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            current_document: Mutex::new(None),
            current_chunks: Mutex::new(Vec::new()),
            bit_index: Mutex::new(None),
            encoder,
            index_path: Mutex::new(None),
            chat_history: Mutex::new(chat_history),
            context_builder,
            llm_client,
            last_sources: Mutex::new(Vec::new()),
        })
        .invoke_handler(tauri::generate_handler![
            // Phase 1
            load_pdf,
            get_chunks,
            // Phase 2
            check_model,
            pull_embedding_model,
            index_document,
            load_index,
            query_index,
            get_index_status,
            // Phase 3
            ask_question,
            get_sources,
            clear_chat,
            get_chat_history,
            check_llm_model,
            pull_llm_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
