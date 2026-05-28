use serde::{Deserialize, Serialize};

/// Simplified model status for frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStatus {
    pub ready: bool,
    pub message: String,
}
