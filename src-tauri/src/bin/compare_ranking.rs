//! End-to-end ranking comparison: Ollama vs Candle.
//!
//! Indexes the same PDF with both encoders, runs diagnostic queries,
//! and compares top-5 results.
//!
//! Usage: cargo run --bin compare_ranking --release -- /path/to/resume.pdf

use hf_hub::api::sync::Api;
use zolo_rag_lib::index::encoder::OllamaEncoder;
use zolo_rag_lib::index::index::{BitIndex, ChunkInfo};
use zolo_rag_lib::index::SearchResult;
use zolo_rag_lib::ml::CandleEncoder;
use zolo_rag_lib::pdf::chunk::chunk_document;
use zolo_rag_lib::pdf::extract::extract_text;
use std::path::PathBuf;

fn main() -> Result<(), String> {
    let _ = env_logger::try_init();

    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <path-to-pdf>", args[0]);
        std::process::exit(1);
    }
    let pdf_path = &args[1];

    let rt = tokio::runtime::Runtime::new().map_err(|e| format!("Tokio: {e}"))?;

    // ── 1. Extract chunks from PDF ──
    println!("📄 Loading PDF: {pdf_path}");
    let doc = extract_text(pdf_path).map_err(|e| format!("Extract: {e}"))?;
    let chunks = chunk_document(&doc);
    println!("   → {} chunks extracted\n", chunks.len());

    // ── 2. Load encoders ──
    println!("🤖 Loading CandleEncoder...");
    let api = Api::new().map_err(|e| format!("HF Hub: {e}"))?;
    let candle = CandleEncoder::new(&api)?;
    let ollama = OllamaEncoder::new();
    println!("   ✅ Both encoders ready\n");

    // ── 3. Build two indexes ──
    println!("📊 Building indexes...");

    // Ollama index
    let mut o_index = BitIndex::new();
    for (i, chunk) in chunks.iter().enumerate() {
        let encoded = rt.block_on(ollama.encode(&chunk.text))?;
        o_index.add_chunk(
            ChunkInfo {
                chunk_id: chunk.id,
                doc_name: chunk.doc_name.clone(),
                page: chunk.page,
                text: chunk.text.clone(),
            },
            encoded.bit_vector,
            encoded.float_vector,
        );
        if (i + 1) % 20 == 0 {
            print!(".");
        }
    }
    println!("   ✅ Ollama index: {} chunks", o_index.len());

    // Candle index
    let mut c_index = BitIndex::new();
    for (i, chunk) in chunks.iter().enumerate() {
        let encoded = candle.encode(&chunk.text)?;
        c_index.add_chunk(
            ChunkInfo {
                chunk_id: chunk.id,
                doc_name: chunk.doc_name.clone(),
                page: chunk.page,
                text: chunk.text.clone(),
            },
            encoded.bit_vector,
            encoded.float_vector,
        );
        if (i + 1) % 20 == 0 {
            print!(".");
        }
    }
    println!("   ✅ Candle index: {} chunks\n", c_index.len());

    // ── 4. Diagnostic queries ──
    let queries = vec![
        ("Shanvit Shetty", "Name/person lookup"),
        ("person who built chatbot packages", "Side-project experience"),
        ("refund policy", "Policy (negative test)"),
        ("Frontend Engineer", "Job title"),
        ("Fullstack Engineer at Zosma AI", "Current role"),
        ("Python programming experience", "Technical skill"),
        ("Education and university", "Education"),
    ];

    println!("🔍 Running diagnostic queries...\n");
    let k = 5;

    for (query, label) in &queries {
        println!("═══ QUERY: \"{query}\" ({label}) ═══");

        // Ollama search
        let q_ollama = rt.block_on(ollama.encode(query))?;
        let o_results = o_index.search_hybrid(
            &q_ollama.bit_vector,
            &q_ollama.float_vector,
            query,
            k,
        );

        // Candle search
        let q_candle = candle.encode(query)?;
        let c_results = c_index.search_hybrid(
            &q_candle.bit_vector,
            &q_candle.float_vector,
            query,
            k,
        );

        // Print side-by-side
        println!("  ┌──────────────────────────────────────────────────────┐");
        println!("  │  Rank │ Ollama score │ Candle score │ Match?        │");
        println!("  ├──────────────────────────────────────────────────────┤");

        let max_rank = o_results.len().max(c_results.len());
        for rank in 0..max_rank {
            let o = o_results.get(rank);
            let c = c_results.get(rank);
            let o_score = o.map(|r| r.score).unwrap_or(0.0);
            let c_score = c.map(|r| r.score).unwrap_or(0.0);
            let o_id = o.map(|r| r.chunk_id).unwrap_or(999);
            let c_id = c.map(|r| r.chunk_id).unwrap_or(999);
            let same = if o_id == c_id { "✅" } else { "❌" };

            println!("  │  {:>3}  │   {:.4}    │   {:.4}    │ {}         │",
                rank + 1, o_score, c_score, same);

            // Show text snippet (first 80 chars)
            if let Some(r) = o {
                let snippet: String = r.text.chars().take(80).collect();
                if rank == 0 {
                    println!("  │  Ollama top: {snippet:80} │");
                }
            }
            if let Some(r) = c {
                let snippet: String = r.text.chars().take(80).collect();
                if rank == 0 {
                    println!("  │  Candle top: {snippet:80} │");
                }
            }
        }
        println!("  └──────────────────────────────────────────────────────┘\n");

        // Check top-1 and top-5 overlap
        if let (Some(o_top), Some(c_top)) = (o_results.first(), c_results.first()) {
            if o_top.chunk_id == c_top.chunk_id {
                println!("  ✅ Top-1 MATCH: chunk #{}", o_top.chunk_id);
            } else {
                println!("  ⚠️  Top-1 MISMATCH: Ollama=#{} Candle=#{}",
                    o_top.chunk_id, c_top.chunk_id);
            }
        }

        let o_ids: std::collections::HashSet<_> = o_results.iter().map(|r| r.chunk_id).collect();
        let c_ids: std::collections::HashSet<_> = c_results.iter().map(|r| r.chunk_id).collect();
        let overlap = o_ids.intersection(&c_ids).count();
        let top5_overlap = overlap as f64 / 5.0;
        println!("  Top-5 overlap: {}/5 ({:.0}%)\n", overlap, top5_overlap * 100.0);

        if top5_overlap < 0.6 {
            println!("  ⚠️  Low overlap — investigate\n");
        }
    }

    // ── 5. Summary ──
    println!("═══════════════════════════════════════════════════════════════");
    println!("  COMPARISON SUMMARY");
    println!("═══════════════════════════════════════════════════════════════");

    Ok(())
}
