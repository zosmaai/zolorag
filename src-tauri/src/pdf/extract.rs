use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExtractionMethod {
    Direct,
    HiddenLayer,
    NoText,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfPage {
    pub page_num: usize,
    pub text: String,
    pub extraction_method: ExtractionMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfDocument {
    pub file_name: String,
    pub total_pages: usize,
    pub pages: Vec<PdfPage>,
    pub total_chars: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum ExtractError {
    #[error("File not found: {0}")]
    FileNotFound(String),
    #[error("Cannot read PDF: {0}")]
    ReadError(String),
    #[error("PDF is encrypted or password-protected")]
    Encrypted,
    #[error("PDF appears corrupted: {0}")]
    Corrupted(String),
    #[error("No extractable text found in this PDF. It may be a scanned document.")]
    NoText,
    #[error("Extraction failed: {0}")]
    Other(String),
}

impl From<std::io::Error> for ExtractError {
    fn from(e: std::io::Error) -> Self {
        ExtractError::ReadError(e.to_string())
    }
}

/// Extract text from a PDF. Returns a PdfDocument with pages.
///
/// Strategy:
/// 1. Try pdf-extract (handles most text-based PDFs)
/// 2. If empty/gibberish, try lopdf for hidden text layers
/// 3. If still nothing, return NoText error
pub fn extract_text(file_path: &str) -> Result<PdfDocument, ExtractError> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(ExtractError::FileNotFound(file_path.to_string()));
    }

    let file_name = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Try pdf-extract first
    let doc = pdf_extract::extract_text(file_path)
        .map_err(|e| ExtractError::Corrupted(e.to_string()))?;

    if doc.trim().is_empty() || doc.len() < 10 {
        return extract_hidden_layer(file_path, &file_name);
    }

    // Parse pages — pdf-extract inserts form feeds (\x0c) between pages
    let raw_pages: Vec<&str> = doc.split('\x0c').collect();

    let pages: Vec<PdfPage> = raw_pages
        .iter()
        .enumerate()
        .map(|(i, text)| {
            let text = text.trim().to_string();
            if text.is_empty() {
                PdfPage {
                    page_num: i + 1,
                    text: String::new(),
                    extraction_method: ExtractionMethod::NoText,
                }
            } else {
                PdfPage {
                    page_num: i + 1,
                    text,
                    extraction_method: ExtractionMethod::Direct,
                }
            }
        })
        .collect();

    let total_chars: usize = pages.iter().map(|p| p.text.len()).sum();

    Ok(PdfDocument {
        file_name,
        total_pages: pages.len(),
        pages,
        total_chars,
    })
}

/// Fallback: try to extract text from hidden/OCR layers using lopdf.
fn extract_hidden_layer(
    file_path: &str,
    file_name: &str,
) -> Result<PdfDocument, ExtractError> {
    let doc = lopdf::Document::load(file_path)
        .map_err(|e| ExtractError::Corrupted(e.to_string()))?;

    let page_count = doc.get_pages().len();
    let mut pages = Vec::new();

    for page_num in 0..page_count {
        let text = match doc.extract_text(&[page_num as u32 + 1]) {
            Ok(t) => t.trim().to_string(),
            Err(_) => String::new(),
        };

        pages.push(PdfPage {
            page_num: page_num + 1,
            text,
            extraction_method: ExtractionMethod::HiddenLayer,
        });
    }

    let total_chars: usize = pages.iter().map(|p| p.text.len()).sum();

    if pages
        .iter()
        .all(|p| p.text.is_empty())
    {
        return Err(ExtractError::NoText);
    }

    Ok(PdfDocument {
        file_name: file_name.to_string(),
        total_pages: page_count,
        pages,
        total_chars,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_text_pdf_not_found() {
        let result = extract_text("/nonexistent/file.pdf");
        assert!(matches!(result, Err(ExtractError::FileNotFound(_))));
    }

    #[test]
    fn test_extract_method_partial_eq() {
        assert_eq!(ExtractionMethod::Direct, ExtractionMethod::Direct);
        assert_ne!(ExtractionMethod::Direct, ExtractionMethod::NoText);
    }
}
