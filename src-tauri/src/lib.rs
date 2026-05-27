pub mod pdf;

use pdf::chunk::Chunk;
use pdf::extract::PdfDocument;
use std::sync::Mutex;
use tauri::State;

struct AppState {
    current_document: Mutex<Option<PdfDocument>>,
    current_chunks: Mutex<Vec<Chunk>>,
}

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            current_document: Mutex::new(None),
            current_chunks: Mutex::new(Vec::new()),
        })
        .invoke_handler(tauri::generate_handler![
            load_pdf,
            get_chunks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
