//! LLM Inference Test for Android
//!
//! Loads a GGUF model and runs a single generate(), measuring tokens/sec.
//!
//! Usage:
//!   cargo ndk -t arm64-v8a build --bin llm_test --release
//!   adb push ... /data/local/tmp/
//!   adb shell LD_LIBRARY_PATH=/data/local/tmp /data/local/tmp/llm_test /data/local/tmp/llama-model.gguf

#![cfg(feature = "ml")]

use std::path::PathBuf;
use std::time::Instant;
use zolo_rag_lib::ml::LlamaCppEngine;

fn main() -> Result<(), String> {
    let _ = env_logger::try_init();

    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <path-to-gguf>", args[0]);
        std::process::exit(1);
    }
    let model_path = PathBuf::from(&args[1]);

    eprintln!("Loading model from: {:?}", model_path);
    eprintln!("Model size: {} MB", std::fs::metadata(&model_path)
        .ok()
        .map(|m| m.len() as f64 / 1_048_576.0)
        .unwrap_or(0.0));

    let start = Instant::now();
    let engine = LlamaCppEngine::new(&model_path, 1024, 32)?; // small context, short output
    let load_time = start.elapsed();
    eprintln!("Model loaded in {:.2}s", load_time.as_secs_f64());

    let prompt = "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\nYou are a helpful assistant.<|eot_id|><|start_header_id|>user<|end_header_id|>\n\nWhat is Rust programming language?<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n";

    eprintln!("Generating...");
    let gen_start = Instant::now();
    let mut token_count = 0u32;
    let result = engine.generate(prompt, |token| {
        token_count += 1;
        print!("{token}");
        let _ = std::io::Write::flush(&mut std::io::stdout());
        true
    });
    let gen_time = gen_start.elapsed();

    match result {
        Ok(answer) => {
            let tok_per_sec = token_count as f64 / gen_time.as_secs_f64();
            eprintln!("\n\n✅ Generation complete");
            eprintln!("   Tokens generated: {token_count}");
            eprintln!("   Generation time: {:.2}s", gen_time.as_secs_f64());
            eprintln!("   Tokens/second: {:.2}", tok_per_sec);
            eprintln!("   Total chars: {}", answer.len());
        }
        Err(e) => {
            eprintln!("\n❌ Generation failed: {e}");
            return Err(e);
        }
    }

    Ok(())
}
