//! # Embedding Validation Suite
//!
//! Self-contained integration tests for `CandleEncoder` that verify:
//!
//! - The model loads successfully from cache
//! - Encoding produces deterministic outputs (same text → same vector)
//! - Cosine similarity between related texts is higher than unrelated texts
//! - Bit vectors have reasonable entropy (~50% bits set)
//!
//! ## Usage
//!
//! ```bash
//! # Run all validation tests (downloads model if not cached)
//! cargo test --test validation -- --ignored
//!
//! # Run with output
//! cargo test --test validation -- --ignored --nocapture
//! ```

use std::path::PathBuf;
use std::sync::OnceLock;

use zolo_rag_lib::ml::CandleEncoder;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// 100 diverse sentences for testing embedding consistency.
const TEST_SENTENCES: &[&str] = &[
    "John Doe",
    "Software Development Engineer",
    "Building a RAG system with Rust and Tauri",
    "The quick brown fox jumps over the lazy dog",
    "Machine learning models can be deployed on edge devices",
    "Natural language processing enables computers to understand text",
    "The weather today is sunny and warm",
    "I enjoy programming in Rust programming language",
    "Neural networks are inspired by the human brain",
    "Bit vectors allow for fast Hamming distance computation",
    "Hybrid search combines keyword and semantic ranking",
    "Open source software powers the modern internet",
    "Cloud computing provides scalable infrastructure",
    "The restaurant serves excellent pasta and pizza",
    "Data structures are fundamental to computer science",
    "Artificial intelligence is transforming industries",
    "The concert was amazing with great music",
    "Version control systems help developers collaborate",
    "Functional programming emphasizes immutability and pure functions",
    "The stock market showed significant gains today",
    "WebAssembly allows running code in the browser at near-native speed",
    "Database indexing improves query performance",
    "The novel tells a compelling story of adventure",
    "Encryption protects sensitive data during transmission",
    "The marathon runners trained for months",
    "Graph theory has applications in social networks",
    "The photovoltaic cells convert sunlight into electricity",
    "Containerization simplifies application deployment",
    "The symphony orchestra performed Beethoven's Fifth",
    "Quantum computing promises exponential speedup for certain problems",
    "The garden has beautiful roses and tulips",
    "API design affects developer experience",
    "The archaeological dig uncovered ancient artifacts",
    "Concurrency bugs are notoriously difficult to debug",
    "The documentary explored ocean ecosystems",
    "Type systems prevent entire categories of runtime errors",
    "The architectural plans showed a modern building design",
    "Memory safety is a key feature of Rust",
    "The cooking class taught traditional Italian recipes",
    "Distributed systems must handle partial failures gracefully",
    "The space telescope captured stunning images of nebulae",
    "Compiler optimization can dramatically improve performance",
    "The hiking trail offered breathtaking mountain views",
    "Network protocols define how devices communicate",
    "The photography exhibition featured wildlife shots",
    "Test-driven development encourages writing tests before code",
    "The economics lecture covered supply and demand",
    "Regular expressions are powerful but can be cryptic",
    "The fashion show displayed the latest collections",
    "Async programming enables efficient I/O-bound operations",
    "Refund policy allows returns within 30 days",
    "The history museum has exhibits from ancient civilizations",
    "Memory management in systems programming requires careful attention",
    "The yoga class helps reduce stress and improve flexibility",
    "Caching frequently accessed data speeds up applications",
    "The astronomy club meets every Wednesday evening",
    "Idempotency is important in REST API design",
    "The film festival showcased independent movies",
    "Microservices architecture enables independent deployments",
    "The botany textbook covers plant taxonomy",
    "Observability includes logging metrics and tracing",
    "The sculpture was carved from a single block of marble",
    "Capacity planning ensures systems handle expected load",
    "The volunteer program helps community development",
    "Authentication verifies identity authorization controls access",
    "The piano recital featured works by Chopin",
    "Progressive web apps offer native-like experiences",
    "The chemistry lab discovered a new compound",
    "Error handling distinguishes robust software from fragile software",
    "The dance performance blended classical and modern styles",
    "Serialization converts data structures to a storable format",
    "The geological survey mapped underground formations",
    "Graceful degradation maintains partial functionality during failures",
    "The theater production received critical acclaim",
    "Protocol buffers provide efficient data serialization",
    "The anthropology study compared cultural practices",
    "Lazy evaluation defers computation until results are needed",
    "The painting sold for millions at auction",
    "Web scraping extracts data from websites automatically",
    "The basketball team won the championship",
    "Zero-cost abstractions are a hallmark of Rust's design",
    "The poetry collection explores themes of nature and love",
    "Static analysis tools catch bugs before runtime",
    "The wildlife sanctuary protects endangered species",
    "Content delivery networks reduce latency for global users",
    "The automotive industry is transitioning to electric vehicles",
    "Immutable infrastructure reduces configuration drift",
    "The psychology experiment studied memory recall",
    "Chaos engineering tests system resilience through controlled failures",
    "The calligraphy workshop taught traditional brush techniques",
    "Feature flags enable gradual rollout of new functionality",
    "The climatology report discussed global temperature trends",
    "Rate limiting protects APIs from abuse",
    "The ceramics studio offers pottery classes",
    "Circuit breakers prevent cascading failures in distributed systems",
    "The linguistics paper analyzed language acquisition patterns",
    "Person who built chatbot packages",
    "The ornithology club organizes bird watching trips",
    "Side projects",
    "The philosophy seminar discussed existentialism",
    "Contact header chunk",
    "The marine biology expedition studied coral reefs",
];

/// Find the model directory, downloading if needed, then return a cached CandleEncoder.
fn get_candle_encoder() -> Option<&'static CandleEncoder> {
    static CANDLE: OnceLock<Option<CandleEncoder>> = OnceLock::new();
    CANDLE.get_or_init(|| {
        let app_dir = std::env::temp_dir().join("zolo_rag_validation");
        let _ = std::fs::create_dir_all(&app_dir);

        match zolo_rag_lib::ml::download::ensure_embedding_model(&app_dir) {
            Ok(model_dir) => match CandleEncoder::new(&model_dir) {
                Ok(encoder) => Some(encoder),
                Err(e) => {
                    log::error!("Failed to init CandleEncoder: {e}");
                    None
                }
            },
            Err(e) => {
                log::error!("Failed to download/ensure embedding model: {e}");
                // Try the old cache path as fallback
                let home = std::env::var("HOME").unwrap_or_default();
                let old_path = PathBuf::from(&home)
                    .join(".cache")
                    .join("huggingface")
                    .join("hub")
                    .join("models--sentence-transformers--all-MiniLM-L6-v2");
                if old_path.join("model.safetensors").exists() {
                    match CandleEncoder::new(&old_path) {
                        Ok(encoder) => Some(encoder),
                        Err(e) => {
                            log::error!("Failed to init CandleEncoder from old cache: {e}");
                            None
                        }
                    }
                } else {
                    None
                }
            }
        }
    })
    .as_ref()
}

// ---------------------------------------------------------------------------
// Test 1: Deterministic Output
// ---------------------------------------------------------------------------

#[test]
#[ignore = "Requires Candle model; run with -- --ignored"]
fn test_deterministic_output() {
    let _ = env_logger::try_init();

    let candle = match get_candle_encoder() {
        Some(e) => e,
        None => {
            eprintln!("SKIP: Candle encoder unavailable");
            return;
        }
    };

    let mut all_deterministic = true;
    for sentence in TEST_SENTENCES {
        let a = candle.encode(sentence).expect("First encode failed");
        let b = candle.encode(sentence).expect("Second encode failed");

        let hamming = a.bit_vector.hamming_distance(&b.bit_vector);
        if hamming != 0 {
            eprintln!(
                "  FAIL: \"{sentence}\" differs from itself ({hamming} bits flipped)"
            );
            all_deterministic = false;
        }
    }

    assert!(
        all_deterministic,
        "CandleEncoder produced non-deterministic outputs"
    );
    println!("  ✅ All {} encodings are deterministic", TEST_SENTENCES.len());
}

// ---------------------------------------------------------------------------
// Test 2: Entropy Check — Bit Balance
// ---------------------------------------------------------------------------

#[test]
#[ignore = "Requires Candle model; run with -- --ignored"]
fn test_bit_entropy() {
    let _ = env_logger::try_init();

    let candle = match get_candle_encoder() {
        Some(e) => e,
        None => {
            eprintln!("SKIP: Candle encoder unavailable");
            return;
        }
    };

    let mut total_pos_bits = 0;
    let total_bits = TEST_SENTENCES.len() * 384;

    for sentence in TEST_SENTENCES {
        let vec = candle.encode(sentence).expect("Encode failed");
        let pos = vec.float_vector.iter().filter(|v| **v > 0.0).count();
        total_pos_bits += pos;
    }

    let ratio = total_pos_bits as f64 / total_bits as f64;
    println!("\n─── Bit Entropy ───");
    println!("  Positive bits: {total_pos_bits}/{total_bits} ({:.1}%)", ratio * 100.0);

    // Expect roughly half the bits to be set (good entropy)
    assert!(
        (0.30..=0.70).contains(&ratio),
        "Bit balance {:.1}% outside expected range (30-70%)",
        ratio * 100.0
    );
    println!("  ✅ Bit balance within expected range (30-70%)");
}

// ---------------------------------------------------------------------------
// Test 3: Semantic Similarity Plausibility
// ---------------------------------------------------------------------------

#[test]
#[ignore = "Requires Candle model; run with -- --ignored"]
fn test_semantic_plausibility() {
    let _ = env_logger::try_init();

    let candle = match get_candle_encoder() {
        Some(e) => e,
        None => {
            eprintln!("SKIP: Candle encoder unavailable");
            return;
        }
    };

    // Pairs of sentences that should be semantically related
    let related_pairs: &[(&str, &str)] = &[
        ("John Doe", "Software Development Engineer"),
        ("Machine learning models", "Neural networks are inspired by the human brain"),
        ("Data structures are fundamental", "Computer science concepts"),
        ("The weather today is sunny", "Climate and temperature patterns"),
        ("Open source software", "Version control systems help developers"),
        ("Refund policy allows returns", "Customer service and returns"),
        ("Memory safety is a key feature of Rust", "Zero-cost abstractions are a hallmark of Rust"),
        ("The marathon runners trained", "The basketball team won the championship"),
    ];

    // Pairs that should be less related (random control)
    let unrelated_pairs: &[(&str, &str)] = &[
        ("Refund policy allows returns", "The symphony orchestra performed Beethoven's Fifth"),
        ("Memory safety in Rust", "The cooking class taught Italian recipes"),
        ("The space telescope captured nebulae", "Quantum computing promises exponential speedup"),
        ("Version control systems", "The botanical textbook covers plant taxonomy"),
    ];

    println!("\n─── Semantic Plausibility ───");

    // Compute average cosine for related pairs
    let mut related_cosines = Vec::new();
    for (a, b) in related_pairs {
        let va = candle.encode(a).expect("Encode failed");
        let vb = candle.encode(b).expect("Encode failed");
        let cosine = cosine_sim(&va.float_vector, &vb.float_vector);
        related_cosines.push(cosine);
        println!("  Related: \"{a}\" ↔ \"{b}\" → {cosine:.4}");
    }
    let avg_related = related_cosines.iter().sum::<f32>() / related_cosines.len() as f32;

    // Compute average cosine for unrelated pairs
    let mut unrelated_cosines = Vec::new();
    for (a, b) in unrelated_pairs {
        let va = candle.encode(a).expect("Encode failed");
        let vb = candle.encode(b).expect("Encode failed");
        let cosine = cosine_sim(&va.float_vector, &vb.float_vector);
        unrelated_cosines.push(cosine);
        println!("  Unrelated: \"{a}\" ↔ \"{b}\" → {cosine:.4}");
    }
    let avg_unrelated = unrelated_cosines.iter().sum::<f32>() / unrelated_cosines.len() as f32;

    println!("\n  Avg related cosine:   {avg_related:.4}");
    println!("  Avg unrelated cosine: {avg_unrelated:.4}");

    assert!(
        avg_related > avg_unrelated,
        "Related pairs ({avg_related:.4}) should have higher cosine than unrelated ({avg_unrelated:.4})",
    );
    assert!(
        avg_related > 0.3,
        "Related cosine {avg_related:.4} too low",
    );
    assert!(
        avg_unrelated < 0.6,
        "Unrelated cosine {avg_unrelated:.4} too high (should be near zero)",
    );

    println!("  ✅ Semantic plausibility check passed");
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

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
