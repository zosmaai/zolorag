use futures::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value;
use tauri::Emitter;

const OLLAMA_CHAT_URL: &str = "http://localhost:11434/api/chat";
const DEFAULT_MODEL: &str = "llama3.2:3b";

/// A single chunk from the streaming Ollama response.
#[derive(Debug, Deserialize)]
struct ChatChunk {
    message: Option<ChatChunkMessage>,
    done: bool,
}

#[derive(Debug, Deserialize)]
struct ChatChunkMessage {
    content: String,
}

/// Streaming chat client for Ollama's `/api/chat` endpoint.
pub struct OllamaChatClient {
    client: Client,
    model: String,
}

impl OllamaChatClient {
    pub fn new(model: Option<String>) -> Self {
        Self {
            client: Client::new(),
            model: model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        }
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    /// Stream a chat completion, emitting `rag:*` events.
    ///
    /// Events emitted:
    /// - `rag:token` — each text token
    /// - `rag:error` — if Ollama fails
    /// - Returns the full assembled response text
    pub async fn stream_chat(
        &self,
        messages: &[Value],
        app_handle: &tauri::AppHandle,
    ) -> Result<String, String> {
        let body = serde_json::json!({
            "model": self.model,
            "messages": messages,
            "stream": true,
        });

        let response = self
            .client
            .post(OLLAMA_CHAT_URL)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Ollama chat request failed: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let err_msg = format!("Ollama returned {status}: {body}");
            let _ = app_handle.emit("rag:error", err_msg.clone());
            return Err(err_msg);
        }

        let mut full_response = String::new();
        let mut stream = response.bytes_stream();

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| {
                let msg = format!("Stream error: {e}");
                let _ = app_handle.emit("rag:error", msg.clone());
                msg
            })?;

            let chunk_text = String::from_utf8_lossy(&chunk);

            for line in chunk_text.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }

                if let Ok(parsed) = serde_json::from_str::<ChatChunk>(line) {
                    if let Some(msg) = parsed.message {
                        let token = msg.content;
                        full_response.push_str(&token);
                        let _ = app_handle.emit("rag:token", token.clone());
                    }
                    if parsed.done {
                        let _ = app_handle.emit("rag:done", full_response.clone());
                        return Ok(full_response);
                    }
                }
            }
        }

        // If we exit the loop without done=true (shouldn't happen, but handle it)
        let _ = app_handle.emit("rag:done", full_response.clone());
        Ok(full_response)
    }
}
