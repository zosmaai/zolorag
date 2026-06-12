"use client";

import { ChevronLeft, ChevronRight, FileText, FileX, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { PdfDocument } from "@/types";

interface BottomSheetProps {
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

/**
 * Mobile-only source viewer. Same data as <SourcePanel> (desktop sidebar), but
 * rendered as a bottom sheet that:
 *   - slides up from the bottom edge,
 *   - has a backdrop tap-to-dismiss + swipe-down gesture (pure CSS),
 *   - respects safe-area inset (Android gesture nav),
 *   - locks body scroll while open.
 */
export default function BottomSheet({ document, page, onClose, onNavigate }: BottomSheetProps) {
	const sheetRef = useRef<HTMLDivElement>(null);
	const touchStartY = useRef<number | null>(null);
	const touchDeltaY = useRef(0);

	const pageData = useMemo(() => {
		if (!document) return null;
		return document.pages.find((p) => p.page_num === page) || null;
	}, [document, page]);

	// Close on Escape (also works with hardware back via Tauri once wired in M4+)
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	if (!document || !pageData) return null;

	// Lightweight swipe-down-to-dismiss handler on the drag handle area.
	const onTouchStart = (e: React.TouchEvent) => {
		touchStartY.current = e.touches[0].clientY;
		touchDeltaY.current = 0;
	};
	const onTouchMove = (e: React.TouchEvent) => {
		if (touchStartY.current === null || !sheetRef.current) return;
		const dy = e.touches[0].clientY - touchStartY.current;
		if (dy > 0) {
			touchDeltaY.current = dy;
			sheetRef.current.style.transform = `translateY(${dy}px)`;
		}
	};
	const onTouchEnd = () => {
		if (!sheetRef.current) return;
		if (touchDeltaY.current > 120) {
			onClose();
		} else {
			sheetRef.current.style.transform = "";
		}
		touchStartY.current = null;
		touchDeltaY.current = 0;
	};

	return (
		<div className="fixed inset-0 z-50 flex flex-col justify-end">
			{/* Backdrop */}
			<button
				type="button"
				aria-label="Close source"
				onClick={onClose}
				className="absolute inset-0 animate-sheet-backdrop"
				style={{ background: "oklch(0 0 0 / 0.45)" }}
			/>

			{/* Sheet */}
			<div
				ref={sheetRef}
				className="relative animate-sheet-slide-up flex flex-col"
				style={{
					background: "var(--bg-surface)",
					borderTopLeftRadius: "var(--radius-2xl)",
					borderTopRightRadius: "var(--radius-2xl)",
					boxShadow: "var(--shadow-xl)",
					maxHeight: "85dvh",
					paddingBottom: "env(safe-area-inset-bottom, 0px)",
					transition: "transform 0.2s ease-out",
				}}
			>
				{/* Drag handle — also the swipe-down area */}
				<div
					onTouchStart={onTouchStart}
					onTouchMove={onTouchMove}
					onTouchEnd={onTouchEnd}
					className="flex flex-col items-center justify-center shrink-0"
					style={{ padding: "12px 0 6px", touchAction: "pan-y" }}
				>
					<div
						style={{
							width: "44px",
							height: "5px",
							borderRadius: "999px",
							background: "var(--border-default)",
						}}
					/>
				</div>

				{/* Header */}
				<div
					className="flex items-center justify-between shrink-0"
					style={{
						padding: "var(--space-3) var(--space-5) var(--space-4)",
						borderBottom: "1px solid var(--border-subtle)",
					}}
				>
					<div className="flex items-center gap-2.5 min-w-0">
						<div
							className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
							style={{ background: "var(--bg-accent-subtle)" }}
						>
							<FileText size={16} style={{ color: "var(--text-accent)" }} />
						</div>
						<div className="min-w-0">
							<p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
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
						className="tap-target flex items-center justify-center rounded-lg active:scale-95 transition-all"
						style={{
							color: "var(--text-muted)",
							width: "44px",
							height: "44px",
							borderRadius: "var(--radius-md)",
						}}
					>
						<X size={18} />
					</button>
				</div>

				{/* Page content */}
				<div className="flex-1 overflow-y-auto" style={{ padding: "var(--space-5)" }}>
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

					{pageData.text ? (
						<div
							className="text-[15px] leading-relaxed whitespace-pre-wrap"
							style={{ color: "var(--text-primary)", lineHeight: "1.75" }}
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

				{/* Navigation */}
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
						className="tap-target inline-flex items-center gap-1.5 text-sm font-semibold transition-all duration-150 disabled:opacity-25 active:scale-95"
						style={{
							color: page <= 1 ? "var(--text-muted)" : "var(--text-secondary)",
							padding: "10px 16px",
							borderRadius: "var(--radius-md)",
						}}
					>
						<ChevronLeft size={16} />
						Prev
					</button>

					<span className="text-xs font-mono font-semibold" style={{ color: "var(--text-muted)" }}>
						{page} / {document.total_pages}
					</span>

					<button
						type="button"
						onClick={() => onNavigate(page + 1)}
						disabled={page >= document.total_pages}
						className="tap-target inline-flex items-center gap-1.5 text-sm font-semibold transition-all duration-150 disabled:opacity-25 active:scale-95"
						style={{
							color: page >= document.total_pages ? "var(--text-muted)" : "var(--text-secondary)",
							padding: "10px 16px",
							borderRadius: "var(--radius-md)",
						}}
					>
						Next
						<ChevronRight size={16} />
					</button>
				</div>
			</div>
		</div>
	);
}
