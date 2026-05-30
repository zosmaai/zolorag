use std::path::{Path, PathBuf};
use std::io::{Read, Write};

/// Default LLM model filename expected in the models directory.
const LLM_MODEL_FILENAME: &str = "llama-3.2-3b-instruct-q4_k_m.gguf";

/// Embedding model files to download from HuggingFace.
const EMBEDDING_REPO: &str = "sentence-transformers/all-MiniLM-L6-v2";
const EMBEDDING_FILES: &[&str] = &["config.json", "tokenizer.json", "model.safetensors"];

/// Base URL for HuggingFace model downloads.
const HF_BASE_URL: &str = "https://huggingface.co";

/// Find the LLM GGUF model file path.
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

/// Download a file from HuggingFace with optional resume and progress callback.
fn download_file(
    url: &str,
    dest: &Path,
    on_progress: &mut dyn FnMut(u64, u64),
) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("zoloRAG/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let temp_path = dest.with_extension("partial");
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
        return Err(format!("Download returned {} for {}", response.status(), url));
    }

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

    let mut temp_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&temp_path)
        .map_err(|e| format!("Cannot open temp file: {e}"))?;

    let mut downloaded: u64 = existing_size;
    let mut buffer = [0u8; 65536];
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

    std::fs::rename(&temp_path, dest)
        .map_err(|e| format!("Failed to rename temp file: {e}"))?;

    log::info!("Downloaded {} ({} bytes)", dest.display(), downloaded);
    Ok(())
}

/// Download the LLM GGUF model from HuggingFace with progress reporting.
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

    let url = format!(
        "{}/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        HF_BASE_URL
    );

    download_file(&url, &dest, &mut on_progress)?;

    Ok(dest)
}

/// Ensure the embedding model files are available locally.
///
/// Downloads the three essential files (config.json, tokenizer.json, model.safetensors)
/// from HuggingFace into the app's models directory. Uses a marker file to track
/// completion so subsequent calls are instant.
///
/// First checks the old hf-hub cache (`~/.cache/huggingface/hub/`) and copies files
/// from there if available, avoiding re-download.
///
/// Returns the model directory path on success.
pub fn ensure_embedding_model(app_dir: &Path) -> Result<PathBuf, String> {
    let model_dir = app_dir.join("models").join(EMBEDDING_REPO);
    std::fs::create_dir_all(&model_dir)
        .map_err(|e| format!("Cannot create models dir: {e}"))?;

    // Check if already fully downloaded via marker file
    let marker = model_dir.join(".downloaded");
    if marker.exists() {
        log::info!("Embedding model already cached at {:?}", model_dir);
        return Ok(model_dir);
    }

    // Check old hf-hub cache first — copy files instead of re-downloading
    let home = std::env::var("HOME").unwrap_or_default();
    let old_cache_dir = PathBuf::from(&home)
        .join(".cache")
        .join("huggingface")
        .join("hub")
        .join("models--sentence-transformers--all-MiniLM-L6-v2");

    let old_snapshots = old_cache_dir.join("snapshots");
    if old_snapshots.exists() {
        if let Ok(entries) = std::fs::read_dir(&old_snapshots) {
            for entry in entries.flatten() {
                let snap = entry.path();
                if !snap.is_dir() {
                    continue;
                }
                let mut copied_any = false;
                for filename in EMBEDDING_FILES {
                    let src = snap.join(filename);
                    if src.exists() {
                        let dest = model_dir.join(filename);
                        if !dest.exists() {
                            log::info!("Copying {} from hf-hub cache", filename);
                            std::fs::copy(&src, &dest)
                                .map_err(|e| format!("Failed to copy cached {}: {e}", filename))?;
                            copied_any = true;
                        }
                    }
                }
                if copied_any {
                    std::fs::write(&marker, b"all-MiniLM-L6-v2")
                        .map_err(|e| format!("Failed to write marker file: {e}"))?;
                    log::info!("Embedding model copied from hf-hub cache at {:?}", snap);
                    return Ok(model_dir);
                }
            }
        }
    }

    // Download missing files from HuggingFace
    for filename in EMBEDDING_FILES {
        let dest = model_dir.join(filename);
        if dest.exists() {
            continue;
        }

        let url = format!(
            "{}/{}/resolve/main/{}",
            HF_BASE_URL, EMBEDDING_REPO, filename
        );

        log::info!("Downloading embedding model file: {}", filename);
        download_file(&url, &dest, &mut |_, _| {})?;
    }

    // Write marker file
    std::fs::write(&marker, b"all-MiniLM-L6-v2")
        .map_err(|e| format!("Failed to write marker file: {e}"))?;

    log::info!("Embedding model ready at {:?}", model_dir);
    Ok(model_dir)
}

/// Check if the embedding model has been downloaded.
pub fn is_embedding_model_cached() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    let model_dir = PathBuf::from(&home)
        .join(".cache")
        .join("huggingface")
        .join("hub")
        .join("models--sentence-transformers--all-MiniLM-L6-v2");

    if model_dir.join(".downloaded").exists() {
        return true;
    }

    // Also check snapshots dir (legacy hf-hub cache structure)
    let snapshots_dir = model_dir.join("snapshots");
    if snapshots_dir.exists() {
        std::fs::read_dir(&snapshots_dir)
            .map(|entries| {
                entries.filter_map(|e| e.ok()).any(|e| {
                    let snap = e.path();
                    snap.is_dir() && snap.join("model.safetensors").exists()
                })
            })
            .unwrap_or(false)
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_cached_does_not_panic() {
        let _ = is_embedding_model_cached();
    }
}
