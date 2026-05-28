use crate::index::index::BitVector;
use reqwest::Client;
use serde::{Deserialize, Serialize};

const OLLAMA_EMBED_URL: &str = "http://localhost:11434/api/embeddings";
const EMBED_MODEL: &str = "all-minilm";

/// Response from Ollama's /api/embeddings endpoint.
#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    embedding: Vec<f64>,
}

/// An encoded text: both the 384-dim float vector (for cosine rescoring)
/// and the 384-bit binary vector (for fast Hamming search).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncodedVector {
    pub bit_vector: BitVector,
    pub float_vector: Vec<f32>,
}

impl EncodedVector {
    fn from_floats(floats: Vec<f32>) -> Self {
        let bit_vector = BitVector::from_float_slice(&floats);
        Self {
            bit_vector,
            float_vector: floats,
        }
    }
}

/// Encoder that calls Ollama's embedding API to convert text to bit vectors.
///
/// # Bit-exact with AskBit
///
/// This uses the **same model** (`all-MiniLM-L6-v2` via Ollama's `all-minilm`)
/// and the **same binarization threshold** (`> 0.0`) as AskBit's Python code:
///
/// ```python
/// # AskBit (Python):
/// bit_vector = (dense > 0).astype(int)
/// ```
///
/// ```text
/// // zoloRAG (Rust):
/// let bit_vector: BitVector = floats.iter().map(|f| *f > 0.0).collect();
/// ```
#[derive(Debug, Clone)]
pub struct OllamaEncoder {
    client: Client,
}

impl OllamaEncoder {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    /// Access the underlying reqwest Client (for status checks, etc.).
    pub fn client(&self) -> Client {
        self.client.clone()
    }

    /// Encode a single text string into both float + bit vectors.
    pub async fn encode(&self, text: &str) -> Result<EncodedVector, String> {
        let raw = self.encode_raw(text).await?;
        Ok(EncodedVector::from_floats(raw))
    }

    /// Encode multiple texts (sequential for reliability).
    pub async fn encode_batch(&self, texts: &[String]) -> Result<Vec<EncodedVector>, String> {
        let mut results = Vec::with_capacity(texts.len());
        for text in texts {
            results.push(self.encode(text).await?);
        }
        Ok(results)
    }

    /// Internal: fetch the raw 384-dim float embedding from Ollama.
    async fn encode_raw(&self, text: &str) -> Result<Vec<f32>, String> {
        let resp = self
            .client
            .post(OLLAMA_EMBED_URL)
            .json(&serde_json::json!({
                "model": EMBED_MODEL,
                "prompt": text,
            }))
            .send()
            .await
            .map_err(|e| format!("Ollama embed request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Ollama returned {status}: {body}"));
        }

        let body: EmbeddingResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse embed response: {e}"))?;

        Ok(body.embedding.iter().map(|&v| v as f32).collect())
    }
}

impl Default for OllamaEncoder {
    fn default() -> Self {
        Self::new()
    }
}
