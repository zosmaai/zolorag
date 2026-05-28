pub mod index;
pub mod pdf;

use index::{
    check_model_status, pull_model, BitIndex, ChunkInfo, EncodedVector, IndexStatus, IndexSummary,
    ModelStatus, OllamaEncoder, SearchResult,
};
use pdf::chunk::Chunk;
use pdf::extract::PdfDocument;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

// ---------------------------------------------------------------------------
// App State
// ---------------------------------------------------------------------------

struct AppState {
    current_document: Mutex<Option<PdfDocument>>,
    current_chunks: Mutex<Vec<Chunk>>,
    bit_index: Mutex<Option<BitIndex>>,
    encoder: OllamaEncoder,
    index_path: Mutex<Option<PathBuf>>,
}

// ---------------------------------------------------------------------------
// Phase 1 Commands
// ---------------------------------------------------------------------------

/// Load a PDF file: extract text and chunk it.
#[tauri::command]
fn load_pdf(path: String, state: State<AppState>) -> Result<PdfDocument, String> {
    let doc = pdf::extract::extract_text(&path).map_err(|e| e.to_string())?;
    let chunks = pdf::chunk::chunk_document(&doc);

    *state.current_document.lock().unwrap() = Some(doc.clone());
    *state.current_chunks.lock().unwrap() = chunks;

    Ok(doc)
}

/// Get chunks for the currently loaded document.
#[tauri::command]
fn get_chunks(state: State<AppState>) -> Result<Vec<Chunk>, String> {
    let chunks = state.current_chunks.lock().unwrap().clone();
    Ok(chunks)
}

// ---------------------------------------------------------------------------
// Phase 2 Commands
// ---------------------------------------------------------------------------

/// Check Ollama status and whether all-minilm model is available.
#[tauri::command]
async fn check_model(app: tauri::AppHandle) -> Result<ModelStatus, String> {
    let state = app.state::<AppState>();
    let client = &state.encoder;
    // reqwest::Client is cheaply cloneable (Arc internally)
    let client_clone = client.client();
    let status = check_model_status(&client_clone).await;
    Ok(status)
}

/// Pull the all-minilm model via Ollama.
#[tauri::command]
async fn pull_embedding_model(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let client_clone = state.encoder.client();
    pull_model(&client_clone).await
}

/// Encode all current chunks into the bit-vector index and persist to disk.
#[tauri::command]
async fn index_document(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<IndexSummary, String> {
    // 1. Grab chunks (drop lock before await)
    let chunks = {
        let guard = state.current_chunks.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    if chunks.is_empty() {
        return Err("No chunks to index. Load a PDF first.".into());
    }

    // 2. Encode all chunks (async — no lock held)
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let encoded: Vec<EncodedVector> = state.encoder.encode_batch(&texts).await?;

    // 3. Build bit index (binary + float32 + term index)
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

    // 4. Persist to disk
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("Cannot create app dir: {e}"))?;
    let index_path = app_dir.join("index.bin");
    bit_index.save(&index_path)?;

    // 5. Store in state
    *state.bit_index.lock().map_err(|e| e.to_string())? = Some(bit_index);
    *state.index_path.lock().map_err(|e| e.to_string())? = Some(index_path.clone());

    Ok(IndexSummary {
        doc_count: 1,
        chunk_count: chunks.len(),
        index_path: index_path.to_string_lossy().to_string(),
    })
}

/// Try to load an existing index from disk on startup.
#[tauri::command]
async fn load_index(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<IndexSummary>, String> {
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

/// Search the index for top-K chunks matching a query.
#[tauri::command]
async fn query_index(
    query: String,
    top_k: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<SearchResult>, String> {
    let k = top_k.unwrap_or(5) as usize;

    // 1. Encode the query (both bit vector + float32)
    let encoded = state.encoder.encode(&query).await?;

    // 2. Search the index (binary Hamming → float32 rescore → keyword blend)
    let bit_index = state
        .bit_index
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No index found. Load and index a PDF first.".to_string())?;

    let results = bit_index.search_hybrid(
        &encoded.bit_vector,
        &encoded.float_vector,
        &query,
        k,
    );
    Ok(results)
}

/// Get current index status (model + chunk counts).
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

    Ok(index::index::IndexStatus {
        indexed_chunks: chunk_count,
        indexed_docs: docs,
    })
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let encoder = OllamaEncoder::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            current_document: Mutex::new(None),
            current_chunks: Mutex::new(Vec::new()),
            bit_index: Mutex::new(None),
            encoder,
            index_path: Mutex::new(None),
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
