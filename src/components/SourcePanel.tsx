"use client";

import { ChevronLeft, ChevronRight, FileText, FileX, X } from "lucide-react";
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
						<FileText size={14} style={{ color: "var(--text-accent)" }} />
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
					<X size={15} />
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
							<FileX size={20} strokeWidth={1.5} className="mx-auto mb-2" />
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
					<ChevronLeft size={14} />
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
					<ChevronRight size={14} />
				</button>
			</div>
		</aside>
	);
}
