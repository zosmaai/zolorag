use crate::index::SearchResult;
use crate::rag::chat::{ChatMessage, Role};
use serde_json::Value;

/// Assembles LLM messages from query + chunks + history.
pub struct ContextBuilder {
    pub max_context_chars: usize,
    pub top_k: usize,
    pub system_prompt: String,
}

impl Default for ContextBuilder {
    fn default() -> Self {
        Self {
            max_context_chars: 6000,
            top_k: 5,
            system_prompt: concat!(
                "You are a helpful PDF assistant. ",
                "Answer the user's question based solely on the provided context. ",
                "If the context does not contain enough information, say so clearly. ",
                "Cite the source page numbers in your answer where applicable."
            )
            .to_string(),
        }
    }
}

impl ContextBuilder {
    /// Build a list of messages for Ollama's `/api/chat` endpoint.
    ///
    /// Structure:
    /// 1. System message with instructions + context
    /// 2. Recent chat history (last N turns, excluding the current query)
    /// 3. Current user query
    pub fn build_messages(
        &self,
        query: &str,
        chunks: &[SearchResult],
        history: &[ChatMessage],
    ) -> Vec<Value> {
        let mut messages: Vec<Value> = Vec::new();

        // --- 1. System + context ---
        let context_str = self.format_context(chunks);
        let system_content = if context_str.is_empty() {
            self.system_prompt.clone()
        } else {
            format!("{}\n\nContext:\n{}", self.system_prompt, context_str)
        };
        messages.push(serde_json::json!({
            "role": "system",
            "content": system_content,
        }));

        // --- 2. Chat history (skip system, skip the last user message if it matches query) ---
        // We include recent history for follow-up context
        for msg in history.iter() {
            // Skip messages that are the same as the current query to avoid duplication
            if matches!(msg.role, Role::User) && msg.content == query {
                continue;
            }
            let role_str = match msg.role {
                Role::User => "user",
                Role::Assistant => "assistant",
            };
            messages.push(serde_json::json!({
                "role": role_str,
                "content": msg.content,
            }));
        }

        // --- 3. Current query ---
        messages.push(serde_json::json!({
            "role": "user",
            "content": query,
        }));

        messages
    }

    /// Format chunks into a readable context block with page markers.
    fn format_context(&self, chunks: &[SearchResult]) -> String {
        let mut context = String::new();
        let mut remaining = self.max_context_chars;

        for chunk in chunks.iter().take(self.top_k) {
            if remaining == 0 {
                break;
            }

            let header = format!("--- Page {} ---", chunk.page);
            let entry = format!("{}\n{}\n\n", header, chunk.text);

            if entry.len() <= remaining {
                context.push_str(&entry);
                remaining = remaining.saturating_sub(entry.len());
            } else {
                // Truncate the chunk text to fit
                let available = remaining.saturating_sub(header.len() + 3); // 3 for "\n\n"
                if available > 20 {
                    let truncated: String = chunk.text.chars().take(available).collect();
                    context.push_str(&format!("{}\n{}...\n\n", header, truncated));
                }
                break;
            }
        }

        context
    }
}
