use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

// ---------------------------------------------------------------------------
// BitVector
// ---------------------------------------------------------------------------

/// A 384-bit semantic vector stored as 6 × u64.
///
/// AskBit converts 384-dim float embeddings to bits using `(dense > 0).astype(int)`.
/// We do the exact same thing, then pack 64 bits into each u64 for compact storage
/// and fast Hamming distance via popcount CPU instructions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BitVector {
    chunks: [u64; 6],
}

impl BitVector {
    /// Create a BitVector from 384 floats, binarizing with threshold `> 0.0`.
    ///
    /// This matches AskBit's Python: `(dense > 0).astype(int)`
    pub fn from_float_slice(floats: &[f32]) -> Self {
        assert_eq!(
            floats.len(),
            384,
            "BitVector requires exactly 384 floats, got {}",
            floats.len()
        );
        let mut chunks = [0u64; 6];
        for (i, &f) in floats.iter().enumerate() {
            if f > 0.0 {
                let chunk_idx = i / 64;
                let bit_idx = i % 64;
                chunks[chunk_idx] |= 1u64 << bit_idx;
            }
        }
        Self { chunks }
    }

    /// Hamming distance = number of bits that differ between two vectors.
    ///
    /// This is identical to AskBit's:
    /// ```python
    /// np.sum(encoded_matrix != query_vec, axis=1)
    /// ```
    /// but using popcount gives it for free in hardware.
    pub fn hamming_distance(&self, other: &BitVector) -> u32 {
        let mut dist = 0;
        for i in 0..6 {
            dist += (self.chunks[i] ^ other.chunks[i]).count_ones();
        }
        dist
    }

    /// Similarity score: 1.0 = identical, 0.0 = completely opposite.
    ///
    /// This matches AskBit's:
    /// ```python
    /// np.sum(encoded_matrix == query_vec, axis=1) / encoded_matrix.shape[1]
    /// ```
    /// which is the same as `1 - hamming_distance / 384`.
    pub fn similarity(&self, other: &BitVector) -> f32 {
        1.0 - (self.hamming_distance(other) as f32 / 384.0)
    }
}

// ---------------------------------------------------------------------------
// TermIndex — keyword overlap scoring
// ---------------------------------------------------------------------------

/// Threshold for blending keyword and semantic scores.
/// 0.6 = 60% semantic (Hamming), 40% keyword (term overlap).
const TERM_ALPHA: f32 = 0.6;

/// How many extra candidates to retrieve before float32 rescoring.
const RESCORE_MULT: usize = 4;

/// Cosine similarity between two float32 vectors of equal length.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum();
    let nb: f32 = b.iter().map(|x| x * x).sum();
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

/// Simple tokenizer: lowercase, split on non-alphanumeric, min length 2.
fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 2)
        .map(String::from)
        .collect()
}

/// Lightweight term index for keyword overlap scoring.
///
/// Stored alongside the binary vectors. At query time, the query is tokenized
/// and each chunk gets a keyword score = (matching query terms) / (total query terms).
/// This is blended with the Hamming similarity to boost exact term matches.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TermIndex {
    /// Per-chunk term frequency: maps term → count within that chunk
    tf: Vec<HashMap<String, usize>>,
}

impl TermIndex {
    fn new() -> Self {
        Self { tf: Vec::new() }
    }

    /// Index a single chunk's text. Must be called in the same order as chunks are added.
    fn add(&mut self, text: &str) {
        let terms = tokenize(text);
        let mut tf_map: HashMap<String, usize> = HashMap::new();
        for term in terms {
            *tf_map.entry(term).or_insert(0) += 1;
        }
        self.tf.push(tf_map);
    }

    /// Compute keyword overlap score for a chunk: fraction of query terms present.
    fn score(&self, query_terms: &[String], chunk_idx: usize) -> f32 {
        if query_terms.is_empty() || chunk_idx >= self.tf.len() {
            return 0.0;
        }
        let tf_map = &self.tf[chunk_idx];
        let matched = query_terms.iter().filter(|t| tf_map.contains_key(*t)).count();
        matched as f32 / query_terms.len() as f32
    }
}

// ---------------------------------------------------------------------------
// ChunkInfo / SearchResult
// ---------------------------------------------------------------------------

/// An encoded text: both the 384-dim float vector (for cosine rescoring)
/// and the 384-bit binary vector (for fast Hamming search).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncodedVector {
    pub bit_vector: BitVector,
    pub float_vector: Vec<f32>,
}

/// Metadata about an indexed chunk (stored alongside the bit vector).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkInfo {
    pub chunk_id: usize,
    pub doc_name: String,
    pub page: usize,
    pub text: String,
}

/// A search result returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub chunk_id: usize,
    pub doc_name: String,
    pub page: usize,
    pub text: String,
    pub score: f32,
}

// ---------------------------------------------------------------------------
// IndexSummary
// ---------------------------------------------------------------------------

/// Summary returned after indexing completes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexSummary {
    pub doc_count: usize,
    pub chunk_count: usize,
    pub index_path: String,
}

/// Current index status returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStatus {
    pub indexed_chunks: usize,
    pub indexed_docs: Vec<String>,
}

// ---------------------------------------------------------------------------
// BitIndex — the main search index
// ---------------------------------------------------------------------------

/// A bit-vector index built from PDF chunks.
///
/// Design mirrors AskBit's `SbertBitEncoder`:
/// - `encoded_matrix` → `Vec<BitVector>` (our 384-dim bit vectors)
/// - `questions`/`answers` → `Vec<ChunkInfo>` (our chunk metadata)
/// - `retrieve_top_k` → `search()` (Hamming KNN)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BitIndex {
    chunks: Vec<ChunkInfo>,
    vectors: Vec<BitVector>,
    float_vectors: Option<Vec<Vec<f32>>>,
    term_index: Option<TermIndex>,
}

impl BitIndex {
    pub fn new() -> Self {
        Self {
            chunks: Vec::new(),
            vectors: Vec::new(),
            float_vectors: Some(Vec::new()),
            term_index: Some(TermIndex::new()),
        }
    }

    pub fn add_chunk(&mut self, info: ChunkInfo, vector: BitVector, float_vector: Vec<f32>) {
        // Build term index incrementally
        if let Some(ref mut ti) = self.term_index {
            ti.add(&info.text);
        }
        if let Some(ref mut fv) = self.float_vectors {
            fv.push(float_vector);
        }
        self.chunks.push(info);
        self.vectors.push(vector);
    }

    pub fn len(&self) -> usize {
        self.chunks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty()
    }

    pub fn doc_names(&self) -> Vec<String> {
        let mut seen = HashMap::new();
        for chunk in &self.chunks {
            seen.entry(chunk.doc_name.clone()).or_insert(true);
        }
        seen.into_keys().collect()
    }

    /// Search for top-K chunks with hybrid scoring + float32 rescoring.
    ///
    /// Scoring pipeline:
    /// 1. Fast Hamming distance on all chunks (binary × binary)
    /// 2. Keyword term overlap on all chunks
    /// 3. Float32 cosine rescoring on top candidates (if float vectors available)
    /// 4. Blend: TERM_ALPHA × cosine + (1 - TERM_ALPHA) × keyword
    ///
    /// If float vectors aren't available (legacy index), falls back to
    /// Hamming + keyword (Phase 1 hybrid).
    pub fn search(&self, query: &BitVector, k: usize) -> Vec<SearchResult> {
        self.search_hybrid(query, &[], "", k)
    }

    /// Hybrid search with float32 rescoring and keyword boost.
    ///
    /// - `query_f32` — raw float query embedding for cosine rescoring.
    ///   Pass an empty slice to skip rescoring (fall back to Hamming).
    /// - `query_text` — raw query text for keyword overlap.
    ///   Pass an empty string to skip keyword scoring.
    ///
    /// Scoring (when all data available):
    /// ```text
    /// 1. Hamming scan → top-(k × RESCORE_MULT) candidates
    /// 2. Cosine rescore on candidates with float32 vectors
    /// 3. final = TERM_ALPHA × cosine + (1 - TERM_ALPHA) × keyword
    /// ```
    pub fn search_hybrid(
        &self,
        query_bv: &BitVector,
        query_f32: &[f32],
        query_text: &str,
        k: usize,
    ) -> Vec<SearchResult> {
        let n = self.vectors.len();
        if n == 0 {
            return Vec::new();
        }

        let query_terms = tokenize(query_text);
        let has_term_index = !query_terms.is_empty() && self.term_index.is_some();
        let has_float =
            !query_f32.is_empty() && self.float_vectors.is_some()
                && self.float_vectors.as_ref().unwrap().len() == n;

        // --- Pass 1: Hamming + keyword on ALL chunks ---
        let mut scored: Vec<(usize, f32)> = self
            .vectors
            .iter()
            .enumerate()
            .map(|(i, vec)| {
                let semantic = query_bv.similarity(vec);
                let keyword = if has_term_index {
                    self.term_index
                        .as_ref()
                        .map(|ti| ti.score(&query_terms, i))
                        .unwrap_or(0.0)
                } else {
                    0.0
                };
                let score = if has_term_index {
                    TERM_ALPHA * semantic + (1.0 - TERM_ALPHA) * keyword
                } else {
                    semantic
                };
                (i, score)
            })
            .collect();

        // Sort by pass-1 score
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        if !has_float {
            // No float vectors — return top-k from pass 1
            return scored
                .into_iter()
                .take(k)
                .map(|(idx, score)| {
                    let chunk = &self.chunks[idx];
                    SearchResult {
                        chunk_id: chunk.chunk_id,
                        doc_name: chunk.doc_name.clone(),
                        page: chunk.page,
                        text: chunk.text.clone(),
                        score,
                    }
                })
                .collect();
        }

        // --- Pass 2: Float32 cosine rescoring on top candidates ---
        let candidate_count = (k * RESCORE_MULT).min(n);
        let float_vecs = self.float_vectors.as_ref().unwrap();

        // Extract top candidate indices from pass 1
        let candidate_indices: Vec<usize> = scored
            .iter()
            .take(candidate_count)
            .map(|&(idx, _)| idx)
            .collect();

        // Rescore candidates with float32 cosine
        let mut rescored: Vec<(usize, f32)> = candidate_indices
            .into_iter()
            .map(|idx| {
                let cosine = cosine_similarity(query_f32, &float_vecs[idx]);
                let keyword = if has_term_index {
                    self.term_index
                        .as_ref()
                        .map(|ti| ti.score(&query_terms, idx))
                        .unwrap_or(0.0)
                } else {
                    0.0
                };
                let score = if has_term_index {
                    TERM_ALPHA * cosine + (1.0 - TERM_ALPHA) * keyword
                } else {
                    cosine
                };
                (idx, score)
            })
            .collect();

        // Sort by rescored score, take final top-k
        rescored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        rescored.truncate(k);

        rescored
            .into_iter()
            .map(|(idx, score)| {
                let chunk = &self.chunks[idx];
                SearchResult {
                    chunk_id: chunk.chunk_id,
                    doc_name: chunk.doc_name.clone(),
                    page: chunk.page,
                    text: chunk.text.clone(),
                    score,
                }
            })
            .collect()
    }

    /// Persist index to disk using bincode.
    /// Pure semantic search (no keyword blending, no rescore).
    /// Used for comparisons and testing.
    pub fn search_semantic(&self, query: &BitVector, k: usize) -> Vec<SearchResult> {
        let mut scored: Vec<(usize, f32)> = self
            .vectors
            .iter()
            .enumerate()
            .map(|(i, vec)| (i, query.similarity(vec)))
            .collect();

        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        scored
            .into_iter()
            .take(k)
            .map(|(idx, score)| {
                let chunk = &self.chunks[idx];
                SearchResult {
                    chunk_id: chunk.chunk_id,
                    doc_name: chunk.doc_name.clone(),
                    page: chunk.page,
                    text: chunk.text.clone(),
                    score,
                }
            })
            .collect()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        let data = bincode::serialize(self).map_err(|e| format!("Serialize index: {e}"))?;
        std::fs::write(path, data).map_err(|e| format!("Write index file: {e}"))?;
        Ok(())
    }

    /// Load index from disk.
    pub fn load(path: &Path) -> Result<Self, String> {
        let data = std::fs::read(path).map_err(|e| format!("Read index file: {e}"))?;
        bincode::deserialize(&data).map_err(|e| format!("Deserialize index: {e}"))
    }
}

impl Default for BitIndex {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
#[allow(clippy::needless_range_loop)]
mod tests {
    use super::*;

    fn make_test_vector(bits: &[u64; 6]) -> BitVector {
        BitVector { chunks: *bits }
    }

    #[test]
    fn test_hamming_distance_zero() {
        let v = make_test_vector(&[0; 6]);
        assert_eq!(v.hamming_distance(&v), 0);
    }

    #[test]
    fn test_hamming_distance_max() {
        let a = make_test_vector(&[0; 6]);
        let b = make_test_vector(&[!0u64; 6]);
        assert_eq!(a.hamming_distance(&b), 384);
    }

    #[test]
    fn test_hamming_distance_some() {
        // a: first 64 bits = all ones, rest zero
        // b: first 64 bits = all zeros, rest zero
        let a = BitVector {
            chunks: [!0u64, 0, 0, 0, 0, 0],
        };
        let b = BitVector {
            chunks: [0u64, 0, 0, 0, 0, 0],
        };
        assert_eq!(a.hamming_distance(&b), 64);
    }

    #[test]
    fn test_similarity_perfect() {
        let v = make_test_vector(&[0xDEADBEEF; 6]);
        assert!((v.similarity(&v) - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn test_from_float_slice_dimension() {
        let floats = vec![0.0f32; 384];
        let bv = BitVector::from_float_slice(&floats);
        assert_eq!(bv.hamming_distance(&bv), 0);

        let floats2: Vec<f32> = (0..384).map(|i| if i < 192 { -1.0 } else { 1.0 }).collect();
        let bv2 = BitVector::from_float_slice(&floats2);
        // 192 bits should be set (positive half)
        assert_eq!(bv2.hamming_distance(&make_test_vector(&[0; 6])), 192);
    }

    #[test]
    #[should_panic(expected = "requires exactly 384 floats")]
    fn test_from_float_slice_wrong_size() {
        BitVector::from_float_slice(&[0.0; 100]);
    }

    #[test]
    fn test_search_returns_top_k() {
        let mut index = BitIndex::new();

        // Add 5 chunks with distinct vectors
        for i in 0..5 {
            let mut floats = vec![0.0f32; 384];
            // Set a unique block of bits for each
            let start = i * 77;
            let end = start + 77;
            for j in start..end.min(384) {
                floats[j] = 1.0;
            }
            let vec = BitVector::from_float_slice(&floats);
            index.add_chunk(
                ChunkInfo {
                    chunk_id: i,
                    doc_name: "test.pdf".into(),
                    page: i + 1,
                    text: format!("Chunk {i}"),
                },
                vec,
                vec![0.0f32; 384], // dummy float vector
            );
        }

        // Search with a vector similar to chunk 2
        let mut query_floats = vec![0.0f32; 384];
        let start = 2 * 77;
        let end = start + 77;
        for j in start..end.min(384) {
            query_floats[j] = 1.0;
        }
        let query = BitVector::from_float_slice(&query_floats);

        let results = index.search(&query, 3);
        assert_eq!(results.len(), 3);
        // Top result should be chunk 2
        assert_eq!(results[0].chunk_id, 2);
    }

    #[test]
    fn test_save_load_roundtrip() {
        let mut index = BitIndex::new();
        let v = BitVector {
            chunks: [1, 2, 3, 4, 5, 6],
        };
        index.add_chunk(
            ChunkInfo {
                chunk_id: 0,
                doc_name: "test.pdf".into(),
                page: 1,
                text: "Hello".into(),
            },
            v,
            vec![0.0f32; 384],
        );

        let path = std::env::temp_dir().join("test_index.bin");
        index.save(&path).unwrap();
        let loaded = BitIndex::load(&path).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded.chunks[0].text, "Hello");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_hybrid_search_boosts_named_entity() {
        let mut index = BitIndex::new();

        // Chunk containing a person's name (the relevant one)
        let text_a = "Shanvit S Shetty Software Development Engineer";
        // Chunk about something unrelated (semantically similar but no name)
        let text_b = "SUMMARY Started with web apps now exploring ML LLMs and agentic workflows";
        let text_c = "EXPERIENCE Fullstack Engineer at OpenAI building frontend features";

        let chunks = [text_a, text_b, text_c];
        for (i, text) in chunks.iter().enumerate() {
            // Give each chunk a distinct bit vector
            let mut floats = vec![0.0f32; 384];
            let start = i * 128;
            for j in start..start + 128 {
                if j < 384 {
                    floats[j] = 1.0;
                }
            }
            let vec = BitVector::from_float_slice(&floats);
            let float_vec = (0..384).map(|j| if j >= start && j < start + 128 { 1.0 } else { 0.0 }).collect();
            index.add_chunk(
                ChunkInfo {
                    chunk_id: i,
                    doc_name: "resume.pdf".into(),
                    page: 1,
                    text: text.to_string(),
                },
                vec,
                float_vec,
            );
        }

        // Query with a person's name — semantic-only would not boost the contact chunk
        let query_floats = vec![0.0f32; 384]; // no semantic signal at all
        let query = BitVector::from_float_slice(&query_floats);

        // Pure semantic: all scores ~0.5, order determined by noise
        let semantic_results = index.search_semantic(&query, 3);

        // Hybrid: keyword boost pushes the name chunk to the top
        let hybrid_results = index.search_hybrid(&query, &[], "Jhon Doe", 3);

        // The first result should be the name chunk
        assert_eq!(hybrid_results.len(), 3);
        assert_eq!(
            hybrid_results[0].chunk_id, 0,
            "Hybrid search should boost the chunk containing the query name"
        );
        // The name chunk's hybrid score should be higher than its pure semantic score
        assert!(
            hybrid_results[0].score > semantic_results[0].score,
            "Hybrid score should be higher than pure semantic for name chunk"
        );
    }

    #[test]
    fn test_hybrid_search_falls_back_to_pure_semantic_without_query_text() {
        let mut index = BitIndex::new();
        let floats = vec![0.5f32; 384];
        let vec = BitVector::from_float_slice(&floats);
        index.add_chunk(
            ChunkInfo {
                chunk_id: 0,
                doc_name: "test.pdf".into(),
                page: 1,
                text: "Some content here".into(),
            },
            vec,
            vec![0.5f32; 384],
        );

        let query_bv = BitVector::from_float_slice(&vec![0.5f32; 384]);
        // Empty query text + no float rescore → should just return semantic match
        let results = index.search_hybrid(&query_bv, &[], "", 1);
        assert_eq!(results.len(), 1);
        assert!((results[0].score - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn test_tokenize_filters_short_tokens() {
        let tokens = tokenize("a bb ccc dddd");
        assert_eq!(tokens, vec!["bb", "ccc", "dddd"]);
    }

    #[test]
    fn test_tokenize_lowercases() {
        let tokens = tokenize("Jhon Doe");
        assert!(tokens.contains(&"shanvit".to_string()));
        assert!(tokens.contains(&"shetty".to_string()));
    }

    #[test]
    fn test_term_index_score() {
        let mut ti = TermIndex::new();
        ti.add("Shanvit S Shetty Software Engineer");
        ti.add("SUMMARY web apps ML LLMs");

        let query = vec!["shanvit".to_string(), "shetty".to_string()];
        // Chunk 0 has both terms
        assert!((ti.score(&query, 0) - 1.0).abs() < f32::EPSILON);
        // Chunk 1 has neither
        assert!((ti.score(&query, 1) - 0.0).abs() < f32::EPSILON);
    }
}
