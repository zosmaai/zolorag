use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config as BertConfig};
use tokenizers::Tokenizer;

use crate::index::index::BitVector;
use crate::index::EncodedVector;

/// In-process BERT-based encoder using candle.
///
/// Loads `sentence-transformers/all-MiniLM-L6-v2` from HuggingFace Hub
/// and runs the forward pass locally.
pub struct CandleEncoder {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
    /// Maximum sequence length from the loaded config.
    max_seq_len: usize,
}

impl CandleEncoder {
    /// Load the model from the directory returned by `ensure_embedding_model`.
    ///
    /// Expects the following files in `model_dir`:
    /// - config.json
    /// - tokenizer.json
    /// - model.safetensors
    pub fn new(model_dir: &std::path::Path) -> Result<Self, String> {
        let device = Device::Cpu;

        // --- Load config ---
        let config_path = model_dir.join("config.json");
        let config: BertConfig = serde_json::from_str(
            &std::fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read config.json: {e}"))?,
        )
        .map_err(|e| format!("Failed to parse config.json: {e}"))?;

        let max_seq_len = config.max_position_embeddings;

        // --- Load tokenizer ---
        let tokenizer_path = model_dir.join("tokenizer.json");
        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| format!("Failed to load tokenizer: {e}"))?;

        // --- Load weights ---
        let weights_path = model_dir.join("model.safetensors");

        // SAFETY: `from_mmaped_safetensors` mmaps the file; this is the standard
        // pattern used in all candle examples and benchmarks.
        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(
                &[weights_path],
                candle_core::DType::F32,
                &device,
            )
            .map_err(|e| format!("Failed to load model weights: {e}"))?
        };

        // --- Build model ---
        let model =
            BertModel::load(vb, &config)
                .map_err(|e| format!("Failed to build BERT model: {e}"))?;

        log::info!(
            "CandleEncoder loaded: all-MiniLM-L6-v2 (max_seq_len={}, hidden=384)",
            max_seq_len
        );

        Ok(Self {
            model,
            tokenizer,
            device,
            max_seq_len,
        })
    }

    /// Encode a single text into a 384-dimensional float vector.
    ///
    /// Pipeline:
    /// 1. Tokenize (WordPiece via the HuggingFace tokenizer)
    /// 2. BERT forward pass
    /// 3. Mean-pool the last hidden state (accounting for padding)
    /// 4. Return a flat `Vec<f32>` of length 384
    pub fn encode_text(&self, text: &str) -> Result<Vec<f32>, String> {
        // 1. Tokenize — add_special_tokens = true prepends [CLS] and appends [SEP]
        let encoding = self
            .tokenizer
            .encode(text, /* add_special_tokens */ true)
            .map_err(|e| format!("Tokenization failed: {e}"))?;

        let ids = encoding.get_ids();
        let attention_mask = encoding.get_attention_mask();

        // 2. Truncate to model's max sequence length (leave room for [CLS], [SEP])
        let max_len = self.max_seq_len.min(256); // MiniLM uses 256
        let ids: Vec<u32> = if ids.len() > max_len {
            ids[..max_len].to_vec()
        } else {
            ids.to_vec()
        };
        let attention_mask: Vec<u32> = if attention_mask.len() > max_len {
            attention_mask[..max_len].to_vec()
        } else {
            attention_mask.to_vec()
        };

        // 3. Create tensors: shape (1, seq_len)
        let input_ids = Tensor::new(ids.as_slice(), &self.device)
            .map_err(|e| format!("Failed to create input_ids tensor: {e}"))?
            .unsqueeze(0)
            .map_err(|e| format!("Failed to unsqueeze input_ids: {e}"))?;

        let attention_mask_t = Tensor::new(attention_mask.as_slice(), &self.device)
            .map_err(|e| format!("Failed to create attention_mask tensor: {e}"))?
            .unsqueeze(0)
            .map_err(|e| format!("Failed to unsqueeze attention_mask: {e}"))?;

        // 4. BERT forward pass
        //    Returns tensor of shape (1, seq_len, hidden_size) — for MiniLM, hidden_size = 384
        let outputs = self
            .model
            .forward(&input_ids, &attention_mask_t, None)
            .map_err(|e| format!("BERT forward pass failed: {e}"))?;

        let (_batch_size, _seq_len, hidden_size) = outputs
            .shape()
            .dims3()
            .map_err(|e| format!("Unexpected output shape: {e}"))?;

        // 5. Mean pooling: zero out padding, sum over sequence, divide by mask count
        //    attention_mask_t: (1, seq_len) → expand to (1, seq_len, hidden_size)
        let mask_f32 = attention_mask_t
            .to_dtype(candle_core::DType::F32)
            .map_err(|e| format!("DType conversion failed: {e}"))?
            .unsqueeze(2usize)
            .map_err(|e| format!("Failed to unsqueeze mask: {e}"))?
            .expand((1, _seq_len, hidden_size))
            .map_err(|e| format!("Failed to expand mask: {e}"))?;

        // Zero out padding positions
        let masked_output = (&outputs * &mask_f32)
            .map_err(|e| format!("Mask multiplication failed: {e}"))?;

        // Sum over sequence dimension → (1, hidden_size)
        let sum_hidden = masked_output
            .sum(1)
            .map_err(|e| format!("Sum over seq_len failed: {e}"))?;

        // Count real tokens
        let mask_sum = mask_f32
            .sum(1)
            .map_err(|e| format!("Mask sum failed: {e}"))?;

        // Mean
        let pooled = sum_hidden
            .broadcast_div(&mask_sum)
            .map_err(|e| format!("Mean pooling failed: {e}"))?;

        // 6. L2 normalize (sentence-transformers standard post-processing)
        //    pooled shape: (1, 384)
        let norm_sq = pooled
            .sqr()
            .map_err(|e| format!("Failed to square pooled: {e}"))?
            .sum(1)
            .map_err(|e| format!("Failed to sum pooled squares: {e}"))?;
        let norm = norm_sq
            .sqrt()
            .map_err(|e| format!("Failed to sqrt norm: {e}"))?;
        let normalized = pooled
            .broadcast_div(&norm)
            .map_err(|e| format!("L2 normalization failed: {e}"))?;

        // 7. Squeeze batch dimension → shape (384,) and extract f32 vector
        let result: Vec<f32> = normalized
            .squeeze(0)
            .map_err(|e| format!("Failed to squeeze batch dim: {e}"))?
            .to_vec1()
            .map_err(|e| format!("Failed to extract vector: {e}"))?;

        log::debug!(
            "CandleEncoder.encode_text: text_len={}, tokens={}, dim={}",
            text.len(),
            ids.len(),
            result.len()
        );

        Ok(result)
    }

    /// Encode a single text → `EncodedVector` (bit vector + float vector).
    pub fn encode(&self, text: &str) -> Result<EncodedVector, String> {
        let floats = self.encode_text(text)?;
        let bit_vector = BitVector::from_float_slice(&floats);
        Ok(EncodedVector {
            bit_vector,
            float_vector: floats,
        })
    }

    /// Encode multiple texts → `Vec<EncodedVector>`.
    pub fn encode_batch(&self, texts: &[String]) -> Result<Vec<EncodedVector>, String> {
        texts.iter().map(|t| self.encode(t)).collect()
    }
}

impl std::fmt::Debug for CandleEncoder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CandleEncoder")
            .field("max_seq_len", &self.max_seq_len)
            .field("device", &"cpu")
            .finish()
    }
}
