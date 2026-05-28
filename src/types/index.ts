// Phase 1 types
export interface PdfPage {
	page_num: number;
	text: string;
	extraction_method: "Direct" | "HiddenLayer" | "NoText";
}

export interface PdfDocument {
	file_name: string;
	total_pages: number;
	pages: PdfPage[];
	total_chars: number;
}

export interface Chunk {
	id: number;
	doc_name: string;
	page: number;
	text: string;
	token_count: number;
}

// Phase 2 types
export interface ModelStatus {
	ready: boolean;
	message: string;
}

export interface SearchResult {
	chunk_id: number;
	doc_name: string;
	page: number;
	text: string;
	score: number;
}

export interface IndexSummary {
	doc_count: number;
	chunk_count: number;
	index_path: string;
}

export interface IndexStatus {
	indexed_chunks: number;
	indexed_docs: string[];
}
