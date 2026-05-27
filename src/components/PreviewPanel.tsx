"use client";

import { useState } from "react";
import type { PdfDocument } from "@/types";

interface PreviewPanelProps {
	document: PdfDocument | null;
}

const METHOD_BADGES: Record<string, { label: string; bg: string; fg: string }> = {
	Direct: { label: "Text extracted", bg: "var(--bg-success-subtle)", fg: "var(--text-success)" },
	HiddenLayer: { label: "Hidden text layer", bg: "var(--bg-warning-subtle)", fg: "var(--text-warning)" },
	NoText: { label: "No text — scanned page", bg: "var(--bg-danger-subtle)", fg: "var(--text-danger)" },
};

export default function PreviewPanel({ document }: PreviewPanelProps) {
	const [pageNum, setPageNum] = useState(1);

	if (!document) {
		return (
			<div
				className="flex-1 rounded-xl flex items-center justify-center"
				style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
			>
				<div className="text-center">
					<svg
						width="40"
						height="40"
						viewBox="0 0 24 24"
						fill="none"
						className="mx-auto mb-3"
						style={{ color: "var(--text-muted)" }}
					>
						<title>Document icon</title>
						<rect x="3" y="2" width="18" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
						<line x1="8" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
						<line x1="8" y1="14" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
					</svg>
					<p className="text-sm" style={{ color: "var(--text-muted)" }}>
						Select a document to preview
					</p>
				</div>
			</div>
		);
	}

	const page = document.pages.find((p) => p.page_num === pageNum) || null;
	const badge = page ? METHOD_BADGES[page.extraction_method] : null;

	return (
		<div
			className="flex-1 rounded-xl flex flex-col overflow-hidden"
			style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
		>
			{/* Header bar */}
			<div
				className="flex items-center justify-between px-4 py-2.5 shrink-0"
				style={{ borderBottom: "1px solid var(--border-default)" }}
			>
				<div className="flex items-center gap-3">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: "var(--text-muted)" }}>
						<title>Document icon</title>
						<rect x="3" y="2" width="18" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
						<line x1="8" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
						<line x1="8" y1="14" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
					</svg>
					<span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
						{document.file_name}
					</span>
				</div>
				{badge && (
					<span
						className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
						style={{ background: badge.bg, color: badge.fg }}
					>
						{badge.label}
					</span>
				)}
			</div>

			{/* Page content */}
			<div className="flex-1 overflow-y-auto p-5 page-scroll">
				{page?.text ? (
					<div className="max-w-prose mx-auto">
						<p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
							Page {page.page_num}
						</p>
						<p
							className="text-sm leading-relaxed whitespace-pre-wrap"
							style={{ color: "var(--text-primary)", lineHeight: "1.75" }}
						>
							{page.text}
						</p>
					</div>
				) : (
					<div className="h-full flex items-center justify-center">
						<p className="text-sm italic" style={{ color: "var(--text-muted)" }}>
							This page has no extractable text. It may be a scanned image.
						</p>
					</div>
				)}
			</div>

			{/* Page navigation */}
			<div
				className="flex items-center justify-between px-4 py-2.5 shrink-0"
				style={{ borderTop: "1px solid var(--border-default)" }}
			>
				<button
					type="button"
					onClick={() => setPageNum((p) => Math.max(1, p - 1))}
					disabled={pageNum <= 1}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150"
					style={{
						color: pageNum <= 1 ? "var(--text-muted)" : "var(--text-secondary)",
						background: pageNum <= 1 ? "transparent" : "transparent",
					}}
					onMouseEnter={(e) => {
						if (pageNum > 1) e.currentTarget.style.background = "var(--bg-hover)";
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
						<title>Previous page</title>
						<polyline points="15 18 9 12 15 6" />
					</svg>
					Previous
				</button>

				<span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
					Page {pageNum} of {document.total_pages}
				</span>

				<button
					type="button"
					onClick={() => setPageNum((p) => Math.min(document.total_pages, p + 1))}
					disabled={pageNum >= document.total_pages}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150"
					style={{
						color: pageNum >= document.total_pages ? "var(--text-muted)" : "var(--text-secondary)",
					}}
					onMouseEnter={(e) => {
						if (pageNum < document.total_pages) e.currentTarget.style.background = "var(--bg-hover)";
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
						<title>Next page</title>
						<polyline points="9 18 15 12 9 6" />
					</svg>
				</button>
			</div>
		</div>
	);
}
