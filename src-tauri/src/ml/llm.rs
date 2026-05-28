use std::num::NonZeroU32;
use std::path::Path;

use encoding_rs::UTF_8;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;

/// In-process LLM engine using llama.cpp via Rust FFI.
///
/// Loads a GGUF model file and generates tokens with streaming
/// via a callback. Replaces the old `OllamaChatClient`.
///
/// Model loading is lazy: the model is loaded in `new()` and kept
/// alive for the lifetime of the engine. Contexts are created
/// per-generation to avoid self-referential lifetime issues
/// (`LlamaContext` borrows from `LlamaModel`).
pub struct LlamaCppEngine {
    backend: LlamaBackend,
    model: LlamaModel,
    model_name: String,
    n_ctx: i32,
    n_len: i32,
}

impl LlamaCppEngine {
    /// Load a GGUF model file.
    ///
    /// - `model_path`: path to the `.gguf` file
    /// - `n_ctx`: context size (e.g., 4096)
    /// - `n_len`: max tokens to generate
    pub fn new(model_path: &Path, n_ctx: i32, n_len: i32) -> Result<Self, String> {
        log::info!("LlamaCppEngine: loading model from {:?}", model_path);

        let backend =
            LlamaBackend::init().map_err(|e| format!("Failed to init llama backend: {e}"))?;

        let model_params = LlamaModelParams::default().with_n_gpu_layers(0); // CPU-only
        let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
            .map_err(|e| format!("Failed to load LLM model: {e}"))?;

        let model_name = model_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "llm".to_string());

        log::info!(
            "LlamaCppEngine loaded: {} (n_ctx={}, n_len={})",
            model_name,
            n_ctx,
            n_len
        );

        Ok(Self {
            backend,
            model,
            model_name,
            n_ctx,
            n_len,
        })
    }

    /// Get the model name.
    pub fn model_name(&self) -> &str {
        &self.model_name
    }

    /// Create a new context for generation.
    ///
    /// Context creation is relatively cheap after model load
    /// (it allocates the KV cache). Each `generate()` call
    /// creates a fresh context to avoid lifetime complexity.
    fn create_context(&self) -> Result<LlamaContext<'_>, String> {
        let n_ctx_val = NonZeroU32::new(self.n_ctx as u32)
            .ok_or_else(|| "n_ctx must be positive".to_string())?;
        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(Some(n_ctx_val));
        self.model
            .new_context(&self.backend, ctx_params)
            .map_err(|e| format!("Failed to create llama context: {e}"))
    }

    /// Generate tokens from a prompt, streaming via callback.
    ///
    /// Each token is passed to `on_token` as a string. The callback
    /// returns `true` to continue or `false` to stop early.
    ///
    /// Returns the full generated text.
    pub fn generate(
        &self,
        prompt: &str,
        mut on_token: impl FnMut(&str) -> bool,
    ) -> Result<String, String> {
        log::info!("generate: creating context");
        let mut ctx = match self.create_context() {
            Ok(ctx) => ctx,
            Err(e) => {
                log::error!("generate: context creation failed: {}", e);
                return Err(e);
            }
        };
        log::info!("generate: context created successfully");
        let mut batch = LlamaBatch::new(self.n_ctx as usize, 1);
        log::info!("generate: batch created");

        log::info!("generate: tokenizing prompt ({} chars)", prompt.len());
        let tokens_list = self
            .model
            .str_to_token(prompt, AddBos::Never)
            .map_err(|e| format!("Tokenization failed: {e}"))?;

        if tokens_list.is_empty() {
            return Err("Empty tokenization".to_string());
        }
        log::info!("generate: got {} tokens", tokens_list.len());

        for (i, token) in (0_i32..).zip(tokens_list.iter()) {
            let is_last = i == tokens_list.len() as i32 - 1;
            batch
                .add(*token, i, &[0], is_last)
                .map_err(|e| format!("Failed to add token to batch: {e}"))?;
        }

        log::info!("generate: decoding prompt");
        ctx.decode(&mut batch)
            .map_err(|e| format!("Prompt decoding failed: {e}"))?;

        let mut n_cur = batch.n_tokens();
        let mut decoder = UTF_8.new_decoder();
        let mut sampler = LlamaSampler::greedy();
        let mut full_output = String::new();
        let eos = self.model.token_eos();

        log::info!("generate: starting loop (n_cur={}, n_len={})", n_cur, self.n_len);
        let mut token_count = 0;

        while n_cur <= self.n_len {
            let idx = batch.n_tokens() - 1;
            let token = sampler.sample(&ctx, idx);
            sampler.accept(token);

            if token == eos {
                log::info!("generate: EOS token at step {}", token_count);
                break;
            }

            let output_string = self
                .model
                .token_to_piece(token, &mut decoder, true, None)
                .map_err(|e| format!("Token decode failed: {e}"))?;

            full_output.push_str(&output_string);

            if !on_token(&output_string) {
                log::info!("generate: early stop at step {}", token_count);
                break;
            }

            batch.clear();
            batch
                .add(token, n_cur, &[0], true)
                .map_err(|e| format!("Failed to add generated token: {e}"))?;

            n_cur += 1;
            token_count += 1;

            ctx.decode(&mut batch)
                .map_err(|e| format!("Generation decode failed: {e}"))?;
        }

        log::info!("generate: done, {} tokens, {} chars output", token_count, full_output.len());
        Ok(full_output)
    }
}

impl std::fmt::Debug for LlamaCppEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LlamaCppEngine")
            .field("model_name", &self.model_name)
            .field("n_ctx", &self.n_ctx)
            .field("n_len", &self.n_len)
            .finish()
    }
}
