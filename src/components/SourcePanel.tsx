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
				width: 400,
				minWidth: 400,
				background: "var(--bg-surface)",
				borderLeft: "1px solid var(--border-default)",
				boxShadow: "var(--shadow-xl)",
			}}
		>
			{/* Header */}
			<div
				className="flex items-center justify-between shrink-0"
				style={{
					padding: "var(--space-4) var(--space-5)",
					borderBottom: "1px solid var(--border-default)",
				}}
			>
				<div className="flex items-center gap-2.5 min-w-0">
					<div
						className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
						style={{ background: "var(--bg-accent-subtle)" }}
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
							style={{ color: "var(--text-accent)" }}
						>
							<title>Source</title>
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
							<polyline points="14 2 14 8 20 8" />
							<line x1="16" y1="13" x2="8" y2="13" />
							<line x1="16" y1="17" x2="8" y2="17" />
						</svg>
					</div>
					<div className="min-w-0">
						<p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
							Source
						</p>
						<p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
							{document.file_name}
						</p>
					</div>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 hover:bg-hover active:scale-95 shrink-0"
					style={{
						color: "var(--text-muted)",
						borderRadius: "var(--radius-md)",
					}}
				>
					<svg
						width="15"
						height="15"
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
			<div className="flex-1 overflow-y-auto" style={{ padding: "var(--space-5)" }}>
				<div style={{ maxWidth: "65ch" }}>
					{/* Page meta */}
					<div className="flex items-center gap-2.5 mb-4">
						<span
							className="text-sm font-semibold"
							style={{
								color: "var(--text-primary)",
								background: "var(--bg-surface-raised)",
								border: "1px solid var(--border-subtle)",
								borderRadius: "var(--radius-sm)",
								padding: "2px 10px",
							}}
						>
							Page {page}
						</span>
						<span
							className="text-[11px] font-semibold px-2 py-0.5 rounded"
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

					{/* Page text */}
					{pageData.text ? (
						<div
							className="text-sm leading-relaxed whitespace-pre-wrap"
							style={{
								color: "var(--text-primary)",
								lineHeight: "1.75",
							}}
						>
							{pageData.text}
						</div>
					) : (
						<div
							className="text-sm py-8 text-center"
							style={{
								color: "var(--text-muted)",
								border: "1px dashed var(--border-subtle)",
								borderRadius: "var(--radius-md)",
							}}
						>
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="mx-auto mb-2"
							>
								<title>No text</title>
								<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
								<line x1="9" y1="9" x2="15" y2="9" />
								<line x1="9" y1="13" x2="15" y2="13" />
								<line x1="9" y1="17" x2="13" y2="17" />
							</svg>
							This page has no extractable text.
						</div>
					)}
				</div>
			</div>

			{/* Page navigation */}
			<div
				className="flex items-center justify-between shrink-0"
				style={{
					padding: "var(--space-3) var(--space-5)",
					borderTop: "1px solid var(--border-default)",
					background: "var(--bg-sidebar)",
				}}
			>
				<button
					type="button"
					onClick={() => onNavigate(page - 1)}
					disabled={page <= 1}
					className="inline-flex items-center gap-1.5 text-xs font-semibold transition-all duration-150 disabled:opacity-25 active:scale-95"
					style={{
						color: page <= 1 ? "var(--text-muted)" : "var(--text-secondary)",
						padding: "6px 12px",
						borderRadius: "var(--radius-md)",
					}}
					onMouseEnter={(e) => {
						if (page > 1) e.currentTarget.style.background = "var(--bg-hover)";
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.background = "transparent";
					}}
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
						<title>Previous</title>
						<polyline points="15 18 9 12 15 6" />
					</svg>
					Prev
				</button>

				<span className="text-xs font-mono font-semibold" style={{ color: "var(--text-muted)" }}>
					{page} / {document.total_pages}
				</span>

				<button
					type="button"
					onClick={() => onNavigate(page + 1)}
					disabled={page >= document.total_pages}
					className="inline-flex items-center gap-1.5 text-xs font-semibold transition-all duration-150 disabled:opacity-25 active:scale-95"
					style={{
						color: page >= document.total_pages ? "var(--text-muted)" : "var(--text-secondary)",
						padding: "6px 12px",
						borderRadius: "var(--radius-md)",
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
						width="14"
						height="14"
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
