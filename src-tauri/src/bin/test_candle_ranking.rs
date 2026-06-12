//! Test CandleEncoder end-to-end: index PDF, run queries, display results.
//!
//! Usage: cargo run --bin test_candle_ranking --release -- /path/to/resume.pdf
//!
//! Only builds when the `ml` feature is enabled.

#![cfg(feature = "ml")]

use zolo_rag_lib::index::index::{BitIndex, ChunkInfo};
use std::path::PathBuf;
use zolo_rag_lib::ml::CandleEncoder;
use zolo_rag_lib::pdf::chunk::chunk_document;
use zolo_rag_lib::pdf::extract::extract_text;

fn main() -> Result<(), String> {
    let _ = env_logger::try_init();

    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <path-to-pdf>", args[0]);
        std::process::exit(1);
    }
    let pdf_path = &args[1];

    // ── 1. Extract chunks ──
    println!("📄 Loading PDF: {pdf_path}");
    let doc = extract_text(pdf_path).map_err(|e| format!("Extract: {e}"))?;
    let chunks = chunk_document(&doc);
    println!("   → {} chunks extracted\n", chunks.len());

    for (i, chunk) in chunks.iter().enumerate() {
        let snippet: String = chunk.text.chars().take(100).collect();
        println!("  [{i}] Page {}: {snippet:100}", chunk.page);
    }
    println!();

    // ── 2. Load CandleEncoder ──
    println!("🤖 Loading CandleEncoder (all-MiniLM-L6-v2)...");
    let home = std::env::var("HOME").unwrap_or_default();
    let model_dir = PathBuf::from(&home)
        .join(".cache")
        .join("huggingface")
        .join("hub")
        .join("models--sentence-transformers--all-MiniLM-L6-v2");
    if !model_dir.exists() {
        // Fall back to the ensure function which downloads if needed
        let app_dir = PathBuf::from(&home).join(".cache").join("zolo-rag");
        zolo_rag_lib::ml::download::ensure_embedding_model(&app_dir)?;
    }
    let candle = CandleEncoder::new(&model_dir)?;
    println!("   ✅ CandleEncoder ready\n");

    // ── 3. Build index ──
    println!("📊 Building index with CandleEncoder...");
    let mut index = BitIndex::new();
    for (i, chunk) in chunks.iter().enumerate() {
        let encoded = candle.encode(&chunk.text)?;
        index.add_chunk(
            ChunkInfo {
                chunk_id: chunk.id,
                doc_name: chunk.doc_name.clone(),
                page: chunk.page,
                text: chunk.text.clone(),
            },
            encoded.bit_vector,
            encoded.float_vector,
        );
        println!("   [{i}] encoded");
    }
    println!("   ✅ Index built: {} chunks\n", index.len());

    // ── 4. Run queries ──
    let queries = vec![
        "Jhon Doe",
        "person who built chatbot packages",
        "Who built the chatbot package?",
        "How many years of experience does the candidate have?",
        "Fullstack Engineer at OpenAI",
        "Frontend Engineer",
        "Python programming",
        "Education and university",
        "refund policy",
        "Software Development Engineer",
    ];

    println!("🔍 Running queries with CandleEncoder (in-process)...\n");

    for query in &queries {
        println!("═══ Q: \"{query}\" ═══");
        let encoded = candle.encode(query)?;
        let results = index.search_hybrid(
            &encoded.bit_vector,
            &encoded.float_vector,
            query,
            5,
        );

        for (rank, r) in results.iter().enumerate() {
            let snippet: String = r.text.chars().take(90).collect();
            println!("  #{:2} [{:6.4}] {}", rank + 1, r.score, snippet);
        }
        println!();
    }

    // ── 5. Duration estimate ──
    println!("⚡ Performance: started");

    let start = std::time::Instant::now();
    for chunk in &chunks {
        let _ = candle.encode(&chunk.text)?;
    }
    let elapsed = start.elapsed();
    let per_chunk = elapsed / chunks.len() as u32;
    println!(
        "   Batch encode: {} chunks in {:?} ({:?} per chunk)",
        chunks.len(),
        elapsed,
        per_chunk
    );

    Ok(())
}
