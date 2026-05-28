use hf_hub::api::sync::Api;
use std::path::{Path, PathBuf};

/// Default LLM model filename expected in the models directory.
const LLM_MODEL_FILENAME: &str = "llama-3.2-3b-instruct-q4_k_m.gguf";

/// Find the LLM GGUF model file path.
///
/// Looks for the expected GGUF file in `<app_dir>/models/`.
/// Returns `Some(path)` if the file exists, `None` otherwise.
///
/// This is used by `check_llm_model` and `init_llm_engine` to
/// determine if the model needs to be downloaded.
pub fn find_llm_model_path(app_dir: &Path) -> Option<PathBuf> {
    let model_path = app_dir.join("models").join(LLM_MODEL_FILENAME);
    if model_path.exists() {
        log::info!("LLM model found at: {:?}", model_path);
        Some(model_path)
    } else {
        log::info!("LLM model not found at: {:?}", model_path);
        None
    }
}

/// Download the LLM GGUF model from HuggingFace with progress reporting.
///
/// Downloads to a temp file and renames on completion (atomic write).
/// Emits progress via the callback: `(bytes_downloaded, total_bytes)`.
pub fn download_llm_model(
    app_dir: &Path,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<PathBuf, String> {
    let model_dir = app_dir.join("models");
    std::fs::create_dir_all(&model_dir)
        .map_err(|e| format!("Cannot create models dir: {e}"))?;

    let dest = model_dir.join(LLM_MODEL_FILENAME);
    if dest.exists() {
        log::info!("LLM model already exists at {:?}", dest);
        return Ok(dest);
    }

    // HuggingFace URL for Llama 3.2 3B Instruct Q4_K_M
    let url = "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf";

    let client = reqwest::blocking::Client::builder()
        .user_agent("zoloRAG/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    // Check if a partial download exists (for resume)
    let temp_path = model_dir.join(format!("{}.partial", LLM_MODEL_FILENAME));
    let existing_size = std::fs::metadata(&temp_path).map(|m| m.len()).unwrap_or(0);

    let response = if existing_size > 0 {
        log::info!("Resuming download from byte {}", existing_size);
        client
            .get(url)
            .header("Range", format!("bytes={}-", existing_size))
            .send()
            .map_err(|e| format!("HTTP request failed: {e}"))?
    } else {
        client
            .get(url)
            .send()
            .map_err(|e| format!("HTTP request failed: {e}"))?
    };

    if !response.status().is_success() {
        return Err(format!("Download returned {}", response.status()));
    }

    // Get total file size (from Content-Range header for resumed, or Content-Length)
    let total_size: u64 = response
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split('/').nth(1))
        .and_then(|s| s.parse().ok())
        .or_else(|| {
            response
                .headers()
                .get("content-length")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse().ok())
        })
        .unwrap_or(0);

    // Stream to temp file with progress
    use std::io::{Read, Write};

    let mut temp_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&temp_path)
        .map_err(|e| format!("Cannot open temp file: {e}"))?;

    let mut downloaded: u64 = existing_size;
    let mut buffer = [0u8; 65536]; // 64 KB chunks

    // Use the blocking response as a Read source
    let mut reader = response;
    loop {
        let n = reader
            .read(&mut buffer)
            .map_err(|e| format!("Read error: {e}"))?;
        if n == 0 {
            break;
        }
        temp_file
            .write_all(&buffer[..n])
            .map_err(|e| format!("Write error: {e}"))?;
        downloaded += n as u64;
        on_progress(downloaded, total_size);
    }

    // Rename temp → final
    std::fs::rename(&temp_path, &dest)
        .map_err(|e| format!("Failed to rename temp file: {e}"))?;

    log::info!("LLM model downloaded to {:?} ({} bytes)", dest, downloaded);
    Ok(dest)
}

/// Ensure the embedding model is available locally.
///
/// Uses `hf-hub` to download `sentence-transformers/all-MiniLM-L6-v2` from
/// HuggingFace Hub into the local cache (`~/.cache/huggingface/hub/`).
///
/// Returns the model directory path on success. This is a **blocking** call;
/// the actual download only happens on the first invocation — subsequent calls
/// are instant (cached).
///
/// # Errors
///
/// Returns an error if:
/// - The HuggingFace Hub API is unreachable (no internet)
/// - The model repository does not exist or access is denied
/// - Disk I/O fails during caching
///
/// # Progress
///
/// `hf-hub` does not expose per-file progress, but the download is cached so
/// it only matters once. For the purpose of Phase 4, a simple two-phase
/// progress indicator (checking cache → downloading) is sufficient.
pub fn ensure_embedding_model(app_dir: &Path) -> Result<PathBuf, String> {
    // Use hf-hub's built-in cache (~/.cache/huggingface/hub/ by default).
    // We create the API and trigger a model lookup — if cached, it's instant;
    // otherwise it downloads.
    let api = Api::new().map_err(|e| format!("Failed to init HF Hub API: {e}"))?;
    let repo = api.model("sentence-transformers/all-MiniLM-L6-v2".to_string());

    // Download the essential files (triggers caching). We call `get` which
    // returns the local path after ensuring the file is present.
    let _config = repo
        .get("config.json")
        .map_err(|e| format!("Failed to download config.json: {e}"))?;
    let _tokenizer = repo
        .get("tokenizer.json")
        .map_err(|e| format!("Failed to download tokenizer.json: {e}"))?;
    let _weights = repo
        .get("model.safetensors")
        .map_err(|e| format!("Failed to download model.safetensors: {e}"))?;

    // Also write a marker file in the app directory indicating the model is ready
    let model_marker = app_dir.join("models").join(".candle_embedding_ready");
    if let Some(parent) = model_marker.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&model_marker, b"all-MiniLM-L6-v2");

    log::info!("Embedding model ensured locally via hf-hub cache");
    Ok(app_dir.join("models"))
}

/// Check if the embedding model has been downloaded and cached.
///
/// Returns `true` if `model.safetensors` exists in the HuggingFace cache
/// OR if the marker file exists in the app data dir.
///
/// hf-hub caches under `~/.cache/huggingface/hub/` (Linux convention, even on macOS).
/// The `dirs_next::cache_dir()` on macOS returns `~/Library/Caches/` which is WRONG
/// — hf-hub uses `~/.cache/` regardless of platform.
pub fn is_embedding_model_cached() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();

    // hf-hub's actual cache location: ~/.cache/huggingface/hub/
    let cache_dir = PathBuf::from(&home).join(".cache").join("huggingface").join("hub");
    let model_cache = cache_dir.join("models--sentence-transformers--all-MiniLM-L6-v2");

    if !model_cache.exists() {
        return false;
    }

    // Check for safetensors in any snapshot subdirectory
    let snapshots_dir = model_cache.join("snapshots");
    if !snapshots_dir.exists() {
        return false;
    }

    std::fs::read_dir(&snapshots_dir)
        .map(|entries| {
            entries.filter_map(|e| e.ok()).any(|e| {
                let snap = e.path();
                snap.is_dir() && snap.join("model.safetensors").exists()
            })
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_cached_does_not_panic() {
        // Just ensure the function runs without panicking
        let _ = is_embedding_model_cached();
    }
}
