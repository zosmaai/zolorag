//! Quick comparison of Ollama vs Candle embeddings.
//! Run with: `cargo run --bin compare_encoders --release`
//! Requires Ollama running with `all-minilm` model.

use hf_hub::api::sync::Api;
use zolo_rag_lib::index::encoder::OllamaEncoder;
use zolo_rag_lib::ml::CandleEncoder;

fn cosine_sim(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum();
    let nb: f32 = b.iter().map(|x| x * x).sum();
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        (dot / (na.sqrt() * nb.sqrt())).clamp(-1.0, 1.0)
    }
}

fn bit_agreement(a: &[f32], b: &[f32]) -> f32 {
    let total = a.len().min(b.len());
    let matches = a
        .iter()
        .zip(b.iter())
        .filter(|(x, y)| (**x > 0.0) == (**y > 0.0))
        .count();
    matches as f32 / total as f32
}

fn main() -> Result<(), String> {
    let _ = env_logger::try_init();

    println!("╔══════════════════════════════════════════════════════════════╗");
    println!("║   Ollama vs Candle Embedding Comparison                     ║");
    println!("╚══════════════════════════════════════════════════════════════╝\n");

    // Load CandleEncoder
    println!("Loading CandleEncoder...");
    let api = Api::new().map_err(|e| format!("HF Hub API: {e}"))?;
    let candle = CandleEncoder::new(&api)?;
    println!("  ✅ CandleEncoder loaded\n");

    // Init OllamaEncoder
    let ollama = OllamaEncoder::new();
    println!("  ✅ OllamaEncoder ready (all-minilm via localhost:11434)\n");

    let texts = [
        "Shanvit Shetty",
        "Hello world",
        "Software Development Engineer at Zosma AI",
        "the refund policy allows returns within 30 days",
        "person who built chatbot packages",
        "A quick brown fox jumps over the lazy dog",
        "Natural language processing with transformer models",
        "Machine learning and deep learning fundamentals",
        "The weather today is sunny and warm",
        "Fullstack Engineer building web applications",
    ];

    let rt = tokio::runtime::Runtime::new().map_err(|e| format!("Tokio runtime: {e}"))?;

    let mut total_cosine = 0.0;
    let mut total_bits = 0.0;

    for text in &texts {
        let candle_v = candle.encode_text(text)?;
        let ollama_v = rt.block_on(ollama.encode(text))?;

        let cos = cosine_sim(&candle_v, &ollama_v.float_vector);
        let bits = bit_agreement(&candle_v, &ollama_v.float_vector);

        total_cosine += cos;
        total_bits += bits;

        let c_pos = candle_v.iter().filter(|v| **v > 0.0).count();
        let o_pos = ollama_v.float_vector.iter().filter(|v| **v > 0.0).count();

        println!("  ── {:40}", text);
        println!("     Cosine:     {:.4}  (same direction)", cos);
        println!("     Bit agree:  {:.2}%  (same sign)", bits * 100.0);
        println!("     Candle pos: {}/384  Ollama pos: {}/384", c_pos, o_pos);
        println!();

        // Show first 5 floats
        print!("     Candle[0..5]:  ");
        for v in candle_v.iter().take(5) {
            print!(" {:+.4}", v);
        }
        println!();
        print!("     Ollama[0..5]:  ");
        for v in ollama_v.float_vector.iter().take(5) {
            print!(" {:+.4}", v);
        }
        println!("\n");
    }

    let n = texts.len() as f32;
    println!("═══════════════════════════════════════════════════════════════");
    println!("  AVERAGE OVER {} TEXTS:", texts.len());
    println!("  Cosine similarity:    {:.4}", total_cosine / n);
    println!("  Bit agreement:        {:.2}%", total_bits / n * 100.0);
    println!("═══════════════════════════════════════════════════════════════");

    if total_bits / n > 0.90 {
        println!("\n  ✅ Bit agreement ≥ 90% — acceptable for ranking");
    } else if total_bits / n > 0.80 {
        println!("\n  ⚠️  Bit agreement between 80-90% — investigate tokenizer/model mismatch");
    } else {
        println!("\n  ❌ Bit agreement < 80% — serious discrepancy");
    }

    // Also show correlation for a real query
    let query_text = "Who built the chatbot package?";
    println!("\n───────────────────────────────────────────────────────────────");
    println!("  QUERY: \"{}\"", query_text);
    let q_candle_floats = candle.encode_text(query_text)?;
    let q_ollama = rt.block_on(ollama.encode(query_text))?;
    println!(
        "  Cosine sim:    {:.4}",
        cosine_sim(&q_candle_floats, &q_ollama.float_vector)
    );
    println!(
        "  Bit agreement: {:.2}%",
        bit_agreement(&q_candle_floats, &q_ollama.float_vector) * 100.0
    );

    // Compare magnitude distribution
    let c_mag: f32 = q_candle_floats.iter().map(|x| x * x).sum::<f32>().sqrt();
    let o_mag: f32 = q_ollama.float_vector.iter().map(|x| x * x).sum::<f32>().sqrt();
    println!("  Candle magnitude: {:.4}", c_mag);
    println!("  Ollama magnitude: {:.4}", o_mag);
    println!("───────────────────────────────────────────────────────────────\n");

    Ok(())
}
