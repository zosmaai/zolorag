//! Memory Profiling for Android
//!
//! Measures peak RSS during model loading and inference.
//!
//! Usage on device:
//!   adb shell LD_LIBRARY_PATH=/data/local/tmp /data/local/tmp/mem_profile /data/local/tmp/llama-model.gguf

#![cfg(feature = "ml")]

use std::path::PathBuf;
use std::time::Instant;
use zolo_rag_lib::ml::LlamaCppEngine;

/// Read current RSS in KB from /proc/self/status
fn rss_kb() -> u64 {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    for line in status.lines() {
        if line.starts_with("VmRSS:") {
            if let Some(val) = line.split_whitespace().nth(1) {
                return val.parse().unwrap_or(0);
            }
        }
    }
    0
}

/// Read peak RSS in KB from /proc/self/status
fn peak_rss_kb() -> u64 {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    for line in status.lines() {
        if line.starts_with("VmHWM:") {
            if let Some(val) = line.split_whitespace().nth(1) {
                return val.parse().unwrap_or(0);
            }
        }
    }
    0
}

/// Read VM size in KB
fn vm_size_kb() -> u64 {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    for line in status.lines() {
        if line.starts_with("VmSize:") {
            if let Some(val) = line.split_whitespace().nth(1) {
                return val.parse().unwrap_or(0);
            }
        }
    }
    0
}

fn main() -> Result<(), String> {
    let _ = env_logger::try_init();

    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <path-to-gguf>", args[0]);
        std::process::exit(1);
    }
    let model_path = PathBuf::from(&args[1]);

    let model_size_mb = std::fs::metadata(&model_path)
        .ok()
        .map(|m| m.len() as f64 / 1_048_576.0)
        .unwrap_or(0.0);

    println!("=== Memory Profile ===");
    println!("Model: {}", model_path.display());
    println!("Model file size: {:.1} MB", model_size_mb);

    // --- Baseline ---
    let baseline_rss = rss_kb();
    let baseline_vm = vm_size_kb();
    println!("\n--- Baseline (before model load) ---");
    println!("  RSS:  {} KB ({:.1} MB)", baseline_rss, baseline_rss as f64 / 1024.0);
    println!("  VM:   {} KB ({:.1} MB)", baseline_vm, baseline_vm as f64 / 1024.0);

    // --- Model Loading ---
    println!("\n--- Loading model... ---");
    let load_start = Instant::now();
    let engine = LlamaCppEngine::new(&model_path, 1024, 32)?;
    let load_time = load_start.elapsed();

    let after_load_rss = rss_kb();
    let after_load_peak = peak_rss_kb();
    let after_load_vm = vm_size_kb();
    println!("  Load time: {:.2}s", load_time.as_secs_f64());
    println!("  RSS after load:  {} KB ({:.1} MB)", after_load_rss, after_load_rss as f64 / 1024.0);
    println!("  RSS delta:       {} KB ({:.1} MB)", after_load_rss.saturating_sub(baseline_rss), (after_load_rss.saturating_sub(baseline_rss)) as f64 / 1024.0);
    println!("  Peak RSS:        {} KB ({:.1} MB)", after_load_peak, after_load_peak as f64 / 1024.0);
    println!("  VM after load:   {} KB ({:.1} MB)", after_load_vm, after_load_vm as f64 / 1024.0);

    // --- Inference ---
    let prompt = "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\nYou are a helpful assistant.<|eot_id|><|start_header_id|>user<|end_header_id|>\n\nWhat is Rust?<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n";

    println!("\n--- Running inference... ---");
    let gen_start = Instant::now();
    let mut token_count = 0u32;
    let result = engine.generate(prompt, |_token| {
        token_count += 1;
        true // continue
    });
    let gen_time = gen_start.elapsed();

    let after_infer_rss = rss_kb();
    let after_infer_peak = peak_rss_kb();
    let after_infer_vm = vm_size_kb();

    match result {
        Ok(answer) => {
            let tok_per_sec = if gen_time.as_secs_f64() > 0.0 {
                token_count as f64 / gen_time.as_secs_f64()
            } else {
                0.0
            };
            println!("  Tokens generated: {}", token_count);
            println!("  Generation time: {:.2}s", gen_time.as_secs_f64());
            println!("  Tokens/second: {:.2}", tok_per_sec);
            println!("  Output length: {} chars", answer.len());
        }
        Err(e) => {
            println!("  Generation error: {e}");
        }
    }

    println!("  RSS after inference: {} KB ({:.1} MB)", after_infer_rss, after_infer_rss as f64 / 1024.0);
    println!("  Peak RSS (overall):  {} KB ({:.1} MB)", after_infer_peak, after_infer_peak as f64 / 1024.0);
    println!("  VM after inference:  {} KB ({:.1} MB)", after_infer_vm, after_infer_vm as f64 / 1024.0);

    // Summary
    let rss_model = after_load_rss.saturating_sub(baseline_rss) as f64 / 1024.0;
    let rss_infer = after_infer_rss.saturating_sub(after_load_rss) as f64 / 1024.0;
    println!("\n=== Summary ===");
    println!("  Model load RSS delta:   {:.1} MB", rss_model);
    println!("  Inference RSS delta:    {:.1} MB", rss_infer);
    println!("  Total peak RSS:         {:.1} MB", after_infer_peak as f64 / 1024.0);
    println!("  Model file size:        {:.1} MB", model_size_mb);
    println!("  Context window:         1024 tokens");
    println!("  KV cache:               ~112 MB (allocated by llama.cpp)");

    Ok(())
}
