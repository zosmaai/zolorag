pub mod download;
pub mod embed;
pub mod llm;

pub use download::{ensure_embedding_model, find_llm_model_path};
pub use embed::CandleEncoder;
pub use llm::LlamaCppEngine;
