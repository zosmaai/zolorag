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
