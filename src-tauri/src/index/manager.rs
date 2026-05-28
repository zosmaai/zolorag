use reqwest::Client;
use serde::{Deserialize, Serialize};

/// Simplified model status for frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStatus {
    pub ready: bool,
    pub message: String,
}

/// State for the model banner component.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelBannerState {
    pub status: ModelStatus,
    pub is_pulling: bool,
    pub pull_progress: f32,
}

impl Default for ModelBannerState {
    fn default() -> Self {
        Self {
            status: ModelStatus {
                ready: false,
                message: "Checking Ollama...".into(),
            },
            is_pulling: false,
            pull_progress: 0.0,
        }
    }
}

/// Check if Ollama is running and the `all-minilm` model is available.
pub async fn check_model_status(client: &Client) -> ModelStatus {
    // First check if Ollama is reachable
    match client.get("http://localhost:11434/api/tags").send().await {
        Ok(resp) if resp.status().is_success() => {
            // Check if all-minilm is in the model list
            match resp.json::<serde_json::Value>().await {
                Ok(body) => {
                    let models = body["models"].as_array();
                    if let Some(models) = models {
                        let has_model = models.iter().any(|m| {
                            m["name"]
                                .as_str()
                                .map_or(false, |n| n.starts_with("all-minilm"))
                        });
                        if has_model {
                            ModelStatus {
                                ready: true,
                                message: "Ready — all-minilm model available".into(),
                            }
                        } else {
                            ModelStatus {
                                ready: false,
                                message: "all-minilm model not pulled yet. Run: ollama pull all-minilm, or click Pull Model.".into(),
                            }
                        }
                    } else {
                        ModelStatus {
                            ready: false,
                            message: "Unexpected response from Ollama".into(),
                        }
                    }
                }
                Err(e) => ModelStatus {
                    ready: false,
                    message: format!("Failed to parse Ollama response: {e}"),
                },
            }
        }
        Ok(resp) => ModelStatus {
            ready: false,
            message: format!("Ollama returned error: {}", resp.status()),
        },
        Err(e) => ModelStatus {
            ready: false,
            message: format!(
                "Ollama not running. Start Ollama and try again. ({})",
                e.to_string()
                    .lines()
                    .next()
                    .unwrap_or("connection refused")
            ),
        },
    }
}

/// Pull a model via Ollama's API.
pub async fn pull_model(client: &Client, model_name: &str) -> Result<(), String> {
    let resp = client
        .post("http://localhost:11434/api/pull")
        .json(&serde_json::json!({"model": model_name}))
        .send()
        .await
        .map_err(|e| format!("Failed to pull model: {e}"))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("Pull failed with status: {}", resp.status()))
    }
}

/// Check if a specific model is available in Ollama.
pub async fn check_llm_model_status(client: &Client, model_name: &str) -> ModelStatus {
    match client.get("http://localhost:11434/api/tags").send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<serde_json::Value>().await {
                Ok(body) => {
                    let models = body["models"].as_array();
                    if let Some(models) = models {
                        let has_model = models.iter().any(|m| {
                            m["name"].as_str().map_or(false, |n| n.starts_with(model_name))
                        });
                        if has_model {
                            ModelStatus {
                                ready: true,
                                message: format!("Ready — {} model available", model_name),
                            }
                        } else {
                            ModelStatus {
                                ready: false,
                                message: format!(
                                    "{} model not pulled yet. Click Pull Model to download.",
                                    model_name
                                ),
                            }
                        }
                    } else {
                        ModelStatus {
                            ready: false,
                            message: "Unexpected response from Ollama".into(),
                        }
                    }
                }
                Err(e) => ModelStatus {
                    ready: false,
                    message: format!("Failed to parse Ollama response: {e}"),
                },
            }
        }
        Ok(resp) => ModelStatus {
            ready: false,
            message: format!("Ollama returned error: {}", resp.status()),
        },
        Err(e) => ModelStatus {
            ready: false,
            message: format!(
                "Ollama not running. Start Ollama and try again. ({})",
                e.to_string().lines().next().unwrap_or("connection refused")
            ),
        },
    }
}
