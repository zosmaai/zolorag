use crate::pdf::extract::{ExtractionMethod, PdfDocument};
use serde::{Deserialize, Serialize};
use unicode_segmentation::UnicodeSegmentation;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub id: usize,
    pub doc_name: String,
    pub page: usize,
    pub text: String,
    pub token_count: usize,
}

#[derive(Debug, Clone)]
pub struct ChunkConfig {
    pub target_tokens: usize,
    pub min_chars: usize,
    pub max_chars: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            target_tokens: 300,
            min_chars: 80,
            max_chars: 2500,
        }
    }
}

fn estimate_tokens(text: &str) -> usize {
    text.len() / 4
}

/// Split extracted PDF pages into chunks using default config.
pub fn chunk_document(doc: &PdfDocument) -> Vec<Chunk> {
    chunk_document_with_config(doc, &ChunkConfig::default())
}

/// Split extracted PDF pages into chunks with custom config.
pub fn chunk_document_with_config(doc: &PdfDocument, config: &ChunkConfig) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let mut chunk_id = 0;

    for page in &doc.pages {
        if page.extraction_method == ExtractionMethod::NoText || page.text.trim().is_empty() {
            continue;
        }
        let page_chunks =
            chunk_page(&page.text, &doc.file_name, page.page_num, config, &mut chunk_id);
        chunks.extend(page_chunks);
    }

    chunks
}

/// Split a single page's text into chunks.
///
/// Strategy:
/// - Each paragraph becomes its own chunk.
/// - Very small paragraphs (< min_chars) merge with the next paragraph.
/// - Very large paragraphs (> max_chars) are split at sentence boundaries.
fn chunk_page(
    text: &str,
    doc_name: &str,
    page_num: usize,
    config: &ChunkConfig,
    chunk_id: &mut usize,
) -> Vec<Chunk> {
    let paragraphs: Vec<&str> = text
        .split("\n\n")
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();

    let mut chunks = Vec::new();
    let mut pending: Option<String> = None;

    for para in paragraphs {
        if let Some(prev) = pending.take() {
            // If previous paragraph was too small, merge with current
            if prev.len() < config.min_chars {
                let merged = format!("{prev}\n\n{para}");
                if merged.len() <= config.max_chars {
                    pending = Some(merged);
                    continue;
                }
            }
            // Flush previous
            chunks.push(make_chunk(chunk_id, doc_name, page_num, &prev));
        }

        if para.len() > config.max_chars {
            // Split large paragraph by sentences
            let sentences: Vec<&str> = para
                .split_sentence_bounds()
                .collect();
            let mut buf = String::new();
            for sentence in sentences {
                let sentence: &str = sentence;
                if !buf.is_empty() && buf.len() + sentence.len() + 1 > config.max_chars {
                    chunks.push(make_chunk(chunk_id, doc_name, page_num, &buf));
                    buf.clear();
                }
                buf.push_str(sentence);
            }
            if !buf.is_empty() {
                chunks.push(make_chunk(chunk_id, doc_name, page_num, &buf));
            }
        } else {
            // Normal size paragraph — possibly merge with next if small
            if para.len() < config.min_chars {
                pending = Some(para.to_string());
            } else {
                chunks.push(make_chunk(chunk_id, doc_name, page_num, para));
            }
        }
    }

    // Flush any remaining pending paragraph
    if let Some(remaining) = pending {
        chunks.push(make_chunk(chunk_id, doc_name, page_num, &remaining));
    }

    chunks
}

fn make_chunk(id: &mut usize, doc_name: &str, page: usize, text: &str) -> Chunk {
    let chunk = Chunk {
        id: *id,
        doc_name: doc_name.to_string(),
        page,
        text: text.trim().to_string(),
        token_count: estimate_tokens(text),
    };
    *id += 1;
    chunk
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::extract::{ExtractionMethod, PdfPage};

    #[test]
    fn test_chunk_paragraphs_separate() {
        let doc = PdfDocument {
            file_name: "test.pdf".to_string(),
            total_pages: 1,
            pages: vec![PdfPage {
                page_num: 1,
                text: "The refund policy states that refunds are processed within five business days after approval. This applies to all purchases made within the last 30 days.

Customers can request an exchange within 14 days of receiving their order. The item must be in its original packaging and unused.

For any questions regarding returns, please contact our support team at support@example.com or call us at 1-800-555-0199.".to_string(),
                extraction_method: ExtractionMethod::Direct,
            }],
            total_chars: 459,
        };
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 3);
        assert!(chunks[0].text.contains("refund"));
        assert!(chunks[1].text.contains("exchange"));
        assert!(chunks[2].text.contains("support"));
    }

    #[test]
    fn test_chunk_merge_small_paragraphs() {
        let doc = PdfDocument {
            file_name: "test.pdf".to_string(),
            total_pages: 1,
            pages: vec![PdfPage {
                page_num: 1,
                text: "Hello world.\n\nThis is a second paragraph.\n\nAnd a third.".to_string(),
                extraction_method: ExtractionMethod::Direct,
            }],
            total_chars: 60,
        };
        let chunks = chunk_document(&doc);
        // Each para < 80 chars, so they merge into one chunk
        assert_eq!(chunks.len(), 1);
    }

    #[test]
    fn test_skip_empty_pages() {
        let doc = PdfDocument {
            file_name: "empty.pdf".to_string(),
            total_pages: 2,
            pages: vec![
                PdfPage {
                    page_num: 1,
                    text: "".to_string(),
                    extraction_method: ExtractionMethod::NoText,
                },
                PdfPage {
                    page_num: 2,
                    text: "Some text".to_string(),
                    extraction_method: ExtractionMethod::Direct,
                },
            ],
            total_chars: 9,
        };
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].page, 2);
    }
}
