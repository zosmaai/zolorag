pub mod chat;
pub mod context;
pub mod ollama;

pub use chat::{ChatHistory, ChatMessage, Role};
pub use context::ContextBuilder;
pub use ollama::OllamaChatClient;
