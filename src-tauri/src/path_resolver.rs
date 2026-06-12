//! Cross-platform PDF path resolution.
//!
//! On desktop a path string from the file picker is already a real filesystem
//! path. On Android the picker often returns a `content://…` URI which the
//! PDF parsers cannot read directly — we copy those URIs into the app's
//! private cache directory first.
//!
//! Callers should treat the returned `PathBuf` as a normal local path.

use std::path::PathBuf;

#[cfg(target_os = "android")]
const PDF_CACHE_SUBDIR: &str = "pdfs";

/// Convert an opaque "path" string from the file picker / intent into a real
/// local `PathBuf`.
///
/// - **Desktop**: identity — the input is already a filesystem path.
/// - **Android**: `content://` URIs are streamed into the app cache dir via
///   `ContentResolver`. Anything else is passed through unchanged.
pub fn resolve_to_local_path(raw: &str, app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        if raw.starts_with("content://") {
            use tauri::Manager;
            let cache_dir = app
                .path()
                .app_cache_dir()
                .map_err(|e| format!("resolve app_cache_dir: {e}"))?
                .join(PDF_CACHE_SUBDIR);
            return crate::mobile::storage::copy_content_uri_to_app_storage(raw, &cache_dir);
        }
    }

    // Desktop, or Android with a real path: pass through.
    let _ = app; // silence unused on desktop
    Ok(PathBuf::from(raw))
}
