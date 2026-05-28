use serde::{Deserialize, Serialize};

use crate::index::SearchResult;

/// Role of a message in the conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Role {
    User,
    Assistant,
}

/// A single message in the chat history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
    pub sources: Option<Vec<SearchResult>>,
}

/// In-memory chat history with a max turn limit.
pub struct ChatHistory {
    messages: Vec<ChatMessage>,
    max_turns: usize,
}

impl ChatHistory {
    pub fn new(max_turns: usize) -> Self {
        Self {
            messages: Vec::new(),
            max_turns,
        }
    }

    pub fn add_user(&mut self, content: String) {
        self.messages.push(ChatMessage {
            role: Role::User,
            content,
            sources: None,
        });
        self.truncate();
    }

    pub fn add_assistant(&mut self, content: String, sources: Vec<SearchResult>) {
        self.messages.push(ChatMessage {
            role: Role::Assistant,
            content,
            sources: Some(sources),
        });
        self.truncate();
    }

    /// Return all messages for serialization to the frontend.
    pub fn all_messages(&self) -> &[ChatMessage] {
        &self.messages
    }

    /// Return the last N turns (user + assistant pairs) for the LLM context.
    pub fn recent_turns(&self, count: usize) -> Vec<&ChatMessage> {
        let total = self.messages.len();
        let start = total.saturating_sub(count * 2);
        self.messages[start..].iter().collect()
    }

    pub fn clear(&mut self) {
        self.messages.clear();
    }

    fn truncate(&mut self) {
        // Keep at most max_turns * 2 messages (each turn = user + assistant)
        let max_messages = self.max_turns * 2;
        while self.messages.len() > max_messages {
            self.messages.remove(0);
        }
    }
}
