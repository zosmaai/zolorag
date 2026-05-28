pub mod index;
pub mod ml;
pub mod pdf;
pub mod rag;

use index::{
    BitIndex, ChunkInfo, EncodedVector,
    IndexStatus, IndexSummary, ModelStatus, SearchResult,
};
use ml::{CandleEncoder, LlamaCppEngine};
use pdf::chunk::Chunk;
use pdf::extract::PdfDocument;
use rag::{ChatHistory, ContextBuilder};
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
    candle_encoder: Mutex<Option<CandleEncoder>>,
    index_path: Mutex<Option<PathBuf>>,
    // Phase 3
    chat_history: Mutex<ChatHistory>,
    context_builder: ContextBuilder,
    llm_engine: Mutex<Option<LlamaCppEngine>>,
    last_sources: Mutex<Vec<SearchResult>>,
}

// ---------------------------------------------------------------------------
// Encoder Resolution
// ---------------------------------------------------------------------------

/// Get the candle encoder, auto-loading from cache if needed.
fn ensure_encoder(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let guard = state.candle_encoder.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    // Not loaded — try to init from cache
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;

    drop(guard); // release lock before loading
    ml::download::ensure_embedding_model(&app_dir)?;

    let api = hf_hub::api::sync::Api::new()
        .map_err(|e| format!("Failed to init HF Hub API: {e}"))?;
    let encoder = CandleEncoder::new(&api)?;

    log::info!("CandleEncoder auto-loaded from cache");
    let _ = app.emit("rag:embedding-ready", true);

    *state.candle_encoder.lock().map_err(|e| e.to_string())? = Some(encoder);
    Ok(())
}

/// Encode using the candle encoder (auto-loading if needed).
fn encode_with_auto_load(
    app: &tauri::AppHandle,
    state: &AppState,
    text: &str,
) -> Result<EncodedVector, String> {
    ensure_encoder(app, state)?;
    let guard = state.candle_encoder.lock().map_err(|e| e.to_string())?;
    guard.as_ref()
        .ok_or_else(|| "CandleEncoder not available".to_string())?
        .encode(text)
}

// ---------------------------------------------------------------------------
// Phase 4 Commands (Candle encoder lifecycle)
// ---------------------------------------------------------------------------

/// Initialize the candle encoder (download model + load into memory).
#[tauri::command]
async fn init_candle_encoder(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    ensure_encoder(&app, &state)?;
    log::info!("CandleEncoder initialized and activated");
    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 5 Commands (LLM engine lifecycle)
// ---------------------------------------------------------------------------

/// Initialize the LLM engine (download GGUF + load into memory).
///
/// Downloads the Llama 3.2 3B Instruct Q4_K_M GGUF from HuggingFace
/// if not already cached, then loads it via `LlamaCppEngine`.
/// Emits `rag:download-progress` events during download.
#[tauri::command]
async fn init_llm_engine(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();

    // Check if already loaded
    {
        let guard = state.llm_engine.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            log::info!("LLM engine already initialized");
            return Ok(());
        }
    }

    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;

    // Download model if not present (blocking task with progress events)
    let app_handle = app.clone();
    let app_dir_clone = app_dir.clone();

    let model_path = tokio::task::spawn_blocking(move || {
        ml::download::download_llm_model(&app_dir_clone, |downloaded, total| {
            let _ = app_handle.emit(
                "rag:download-progress",
                serde_json::json!({
                    "downloaded": downloaded,
                    "total": total,
                    "model": "llm",
                }),
            );
        })
    })
    .await
    .map_err(|e| format!("Download task join failed: {e}"))?
    .map_err(|e| format!("Failed to download LLM model: {e}"))?;

    // Load the model
    let engine = LlamaCppEngine::new(&model_path, 4096, 1024)
        .map_err(|e| format!("Failed to initialize LLM engine: {e}"))?;

    *state.llm_engine.lock().map_err(|e| e.to_string())? = Some(engine);

    log::info!("LLM engine initialized from {:?}", model_path);
    let _ = app.emit("rag:llm-ready", true);
    Ok(())
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
    // Check if candle encoder is already loaded
    let engine_loaded = {
        let state = app.state::<AppState>();
        let guard = state.candle_encoder.lock().map_err(|e| e.to_string())?;
        guard.is_some()
    };

    let cached = ml::download::is_embedding_model_cached();

    Ok(ModelStatus {
        ready: cached || engine_loaded,
        message: if engine_loaded {
            "Embedding model ready (in-process)".to_string()
        } else if cached {
            "Embedding model files cached".to_string()
        } else {
            "Embedding model not yet downloaded".to_string()
        },
    })
}

#[tauri::command]
async fn pull_embedding_model(app: tauri::AppHandle) -> Result<(), String> {
    // Delegate to init_candle_encoder which handles download + load
    init_candle_encoder(app).await
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

    // Encode using candle encoder (auto-loads if needed)
    let first = encode_with_auto_load(&app, &state, &texts[0])?;
    let mut encoded = Vec::with_capacity(texts.len());
    encoded.push(first);
    for t in &texts[1..] {
        encoded.push(encode_with_auto_load(&app, &state, t)?);
    }

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
    app: tauri::AppHandle,
    query: String,
    top_k: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<SearchResult>, String> {
    let k = top_k.unwrap_or(5) as usize;

    // Encode using candle encoder (auto-loads if needed)
    let encoded = encode_with_auto_load(&app, &state, &query)?;

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

    // 1. Encode query using candle encoder (auto-loads if needed)
    let encoded = encode_with_auto_load(&app, &state, &query)
        .inspect_err(|e| { let _ = app.emit("rag:error", e.clone()); })?;

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

    // 6. Get or auto-initialize LLM engine
    // If the engine isn't loaded but the GGUF file exists on disk, load it on demand.
    let engine = {
        let mut guard = state.llm_engine.lock().map_err(|e| e.to_string())?;
        match guard.take() {
            Some(engine) => engine,
            None => {
                // Engine not loaded — try to init from disk
                drop(guard); // release lock before init
                let app_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;

                let model_path = ml::download::find_llm_model_path(&app_dir)
                    .ok_or_else(|| {
                        let msg = "No LLM model found. Download one first.".to_string();
                        let _ = app.emit("rag:error", msg.clone());
                        msg
                    })?;

                log::info!("Auto-loading LLM engine from {:?}", model_path);
                let engine = LlamaCppEngine::new(&model_path, 4096, 1024)
                    .map_err(|e| format!("Failed to load LLM: {e}"))?;

                let _ = app.emit("rag:llm-ready", true);
                engine
            }
        }
    };

    let prompt = state
        .context_builder
        .build_prompt(&query, &chunks, &history);

    // Run generation. Always return the engine to state, even on error.
    let app_clone = app.clone();
    let generate_result = engine.generate(&prompt, |token| {
        let _ = app_clone.emit("rag:token", token.to_string());
        true
    });

    let answer = match generate_result {
        Ok(answer) => {
            // Emit done event so frontend finalizes the streaming message
            let _ = app.emit("rag:done", answer.clone());
            answer
        }
        Err(e) => {
            let err_msg = format!("LLM generation failed: {e}");
            let _ = app.emit("rag:error", err_msg.clone());
            // Return engine to state before propagating the error
            *state.llm_engine.lock().map_err(|e| e.to_string())? = Some(engine);
            return Err(err_msg);
        }
    };

    // Return the engine to the state for reuse
    *state.llm_engine.lock().map_err(|e| e.to_string())? = Some(engine);

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

/// Check if the LLM model GGUF file exists on disk.
#[tauri::command]
async fn check_llm_model(app: tauri::AppHandle) -> Result<ModelStatus, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;

    let model_path = ml::download::find_llm_model_path(&app_dir);

    Ok(ModelStatus {
        ready: model_path.is_some(),
        message: if let Some(path) = model_path {
            let size_mb = std::fs::metadata(&path)
                .ok()
                .map(|m| m.len() as f64 / 1_048_576.0)
                .unwrap_or(0.0);
            format!("LLM model ready ({:.1} MB)", size_mb)
        } else {
            "LLM model not downloaded. Run init_llm_engine to download.".to_string()
        },
    })
}

/// Download and load the LLM GGUF model.
///
/// Delegates to `init_llm_engine` which handles both download and
/// initialization. This is the command the frontend calls from
/// the "Download LLM" button.
#[tauri::command]
async fn pull_llm_model(app: tauri::AppHandle) -> Result<(), String> {
    init_llm_engine(app).await
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging. Set RUST_LOG=debug for verbose output.
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("debug"))
        .init();

    let context_builder = ContextBuilder::default();
    let chat_history = ChatHistory::new(10); // keep last 10 turns

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            current_document: Mutex::new(None),
            current_chunks: Mutex::new(Vec::new()),
            bit_index: Mutex::new(None),
            candle_encoder: Mutex::new(None),
            index_path: Mutex::new(None),
            chat_history: Mutex::new(chat_history),
            context_builder,
            llm_engine: Mutex::new(None),
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
            // Phase 4
            init_candle_encoder,
            // Phase 5
            init_llm_engine,
            check_llm_model,
            pull_llm_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
