//! Embedding Verification Tool
//!
//! Encodes known strings with CandleEncoder and prints vectors.
//! Use this to establish a desktop baseline for Android comparison.
//!
//! Usage:
//!   cargo run --bin embed_verify --release
//!
//! Output: bit vectors (hex) + first 10 float values for each test string.
//! Save the output and compare against Android build results.

#![cfg(feature = "ml")]

use std::path::PathBuf;
use zolo_rag_lib::ml::CandleEncoder;

const TEST_STRINGS: &[&str] = &[
    "John Doe",
    "Software Development Engineer",
    "What is the refund policy?",
    "The quick brown fox jumps over the lazy dog",
    "Machine learning models for edge devices",
    "Memory safety is a key feature of Rust",
    "Building a RAG system with Rust and Tauri",
];

fn main() -> Result<(), String> {
    let _ = env_logger::try_init();

    // Model path from CLI arg, or auto-detect from cache
    let args: Vec<String> = std::env::args().collect();
    let model_dir = if args.len() >= 2 {
        PathBuf::from(&args[1])
    } else {
        let home = std::env::var("HOME").unwrap_or_default();
        let old_cache = PathBuf::from(&home)
            .join(".cache")
            .join("huggingface")
            .join("hub")
            .join("models--sentence-transformers--all-MiniLM-L6-v2");
        if old_cache.join("model.safetensors").exists() {
            old_cache
        } else if old_cache.join("snapshots").exists() {
            std::fs::read_dir(old_cache.join("snapshots"))
                .map_err(|e| format!("Cannot read snapshots: {e}"))?
                .filter_map(|e| e.ok())
                .find(|e| e.path().is_dir())
                .map(|e| e.path())
                .ok_or_else(|| "No snapshot dir found".to_string())?
        } else {
            return Err("No model found. Pass model directory as argument.".to_string());
        }
    };

    eprintln!("Loading CandleEncoder from: {:?}", model_dir);
    let encoder = CandleEncoder::new(&model_dir)?;
    eprintln!("CandleEncoder loaded successfully\n");

    println!("=== Embedding Verification Baseline ===");
    println!("Model: all-MiniLM-L6-v2");
    println!("Dimension: 384");
    println!("");

    for text in TEST_STRINGS {
        let encoded = encoder.encode(text)?;

        // Bit vector (hex)
        let bit_hex: Vec<String> = encoded
            .bit_vector
            .chunks
            .iter()
            .map(|c| format!("{c:016x}"))
            .collect();

        // First 10 floats
        let floats_head: Vec<f32> = encoded.float_vector.iter().take(10).copied().collect();

        // Count of positive bits
        let positive_bits: usize = encoded
            .float_vector
            .iter()
            .filter(|v| **v > 0.0)
            .count();

        println!("---");
        println!("Text: \"{text}\"");
        println!("  bit_vector:  [{}]", bit_hex.join(", "));
        println!("  floats[..10]: {floats_head:?}");
        println!("  positive_bits: {positive_bits}/384 ({:.1}%)", positive_bits as f64 / 3.84);
        println!("");
    }

    // Determinism check
    eprintln!("Checking determinism...");
    let first = TEST_STRINGS[0];
    let a = encoder.encode(first)?;
    let b = encoder.encode(first)?;
    let hamming = a.bit_vector.hamming_distance(&b.bit_vector);
    if hamming == 0 {
        eprintln!("✅ Deterministic: \"{first}\" → identical vectors on re-encode");
    } else {
        eprintln!("❌ Non-deterministic: \"{first}\" → {hamming} bits differ!");
    }

    Ok(())
}
