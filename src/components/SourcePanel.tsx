"use client";

import { useMemo } from "react";
import type { PdfDocument } from "@/types";

interface SourcePanelProps {
	document: PdfDocument | null;
	page: number;
	onClose: () => void;
	onNavigate: (page: number) => void;
}

const METHOD_LABELS: Record<string, string> = {
	Direct: "Text",
	HiddenLayer: "Hidden layer",
	NoText: "Scanned",
};

export default function SourcePanel({ document, page, onClose, onNavigate }: SourcePanelProps) {
	const pageData = useMemo(() => {
		if (!document) return null;
		return document.pages.find((p) => p.page_num === page) || null;
	}, [document, page]);

	if (!document || !pageData) return null;

	return (
		<aside
			className="flex flex-col h-full animate-slide-in"
			style={{
				width: 380,
				minWidth: 380,
				background: "var(--bg-surface)",
				borderLeft: "1px solid var(--border-default)",
				boxShadow: "var(--shadow-lg)",
			}}
		>
			{/* Header */}
			<div
				className="flex items-center justify-between px-4 py-3 shrink-0"
				style={{ borderBottom: "1px solid var(--border-default)" }}
			>
				<div className="flex items-center gap-2 min-w-0">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="shrink-0"
						style={{ color: "var(--text-muted)" }}
					>
						<title>Source</title>
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
						<polyline points="14 2 14 8 20 8" />
						<line x1="16" y1="13" x2="8" y2="13" />
						<line x1="16" y1="17" x2="8" y2="17" />
					</svg>
					<span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
						{document.file_name}
					</span>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 transition-colors hover:opacity-70"
					style={{ color: "var(--text-muted)" }}
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<title>Close</title>
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>

			{/* Page content */}
			<div className="flex-1 overflow-y-auto p-4">
				<div className="max-w-prose">
					<div className="flex items-center gap-2 mb-3">
						<span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
							Page {page}
						</span>
						<span
							className="text-[10px] font-medium px-1.5 py-0.5 rounded"
							style={{
								background:
									pageData.extraction_method === "Direct"
										? "var(--bg-success-subtle)"
										: pageData.extraction_method === "HiddenLayer"
											? "var(--bg-warning-subtle)"
											: "var(--bg-danger-subtle)",
								color:
									pageData.extraction_method === "Direct"
										? "var(--text-success)"
										: pageData.extraction_method === "HiddenLayer"
											? "var(--text-warning)"
											: "var(--text-danger)",
							}}
						>
							{METHOD_LABELS[pageData.extraction_method] || pageData.extraction_method}
						</span>
					</div>

					{pageData.text ? (
						<p
							className="text-sm leading-relaxed whitespace-pre-wrap"
							style={{ color: "var(--text-secondary)", lineHeight: "1.75" }}
						>
							{pageData.text}
						</p>
					) : (
						<p className="text-sm italic" style={{ color: "var(--text-muted)" }}>
							This page has no extractable text.
						</p>
					)}
				</div>
			</div>

			{/* Page navigation */}
			<div
				className="flex items-center justify-between px-4 py-3 shrink-0"
				style={{ borderTop: "1px solid var(--border-default)" }}
			>
				<button
					type="button"
					onClick={() => onNavigate(page - 1)}
					disabled={page <= 1}
					className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-30"
					style={{
						color: page <= 1 ? "var(--text-muted)" : "var(--text-secondary)",
					}}
					onMouseEnter={(e) => {
						if (page > 1) e.currentTarget.style.background = "var(--bg-hover)";
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.background = "transparent";
					}}
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<title>Previous</title>
						<polyline points="15 18 9 12 15 6" />
					</svg>
					Prev
				</button>

				<span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
					{page} / {document.total_pages}
				</span>

				<button
					type="button"
					onClick={() => onNavigate(page + 1)}
					disabled={page >= document.total_pages}
					className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-30"
					style={{
						color: page >= document.total_pages ? "var(--text-muted)" : "var(--text-secondary)",
					}}
					onMouseEnter={(e) => {
						if (page < document.total_pages) e.currentTarget.style.background = "var(--bg-hover)";
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.background = "transparent";
					}}
				>
					Next
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<title>Next</title>
						<polyline points="9 18 15 12 9 6" />
					</svg>
				</button>
			</div>
		</aside>
	);
}
