pub mod download;

#[cfg(feature = "ml")]
pub mod embed;
#[cfg(feature = "ml")]
pub mod llm;

pub use download::{ensure_embedding_model, find_llm_model_path};

#[cfg(feature = "ml")]
pub use embed::CandleEncoder;
#[cfg(feature = "ml")]
pub use llm::LlamaCppEngine;
