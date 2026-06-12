"use client";

import { ArrowDownToLine, FileUp } from "lucide-react";
import { useState } from "react";

interface DropZoneProps {
	onBrowse: () => void;
}

export default function DropZone({ onBrowse }: DropZoneProps) {
	const [isDragOver, setIsDragOver] = useState(false);

	return (
		<button
			type="button"
			onClick={onBrowse}
			onDragOver={(e) => {
				e.preventDefault();
				setIsDragOver(true);
			}}
			onDragLeave={() => setIsDragOver(false)}
			onDrop={(e) => {
				e.preventDefault();
				setIsDragOver(false);
			}}
			// Desktop-only component. Mobile path renders <OpenPdfButton> instead
			// (drag-and-drop is meaningless on touch). The conditional render lives
			// in page.tsx behind `isMobile`.
			className="relative w-full text-center cursor-pointer select-none transition-all duration-200 border-2 border-dashed group"
			style={{
				borderRadius: "var(--radius-xl)",
				padding: "var(--space-12) var(--space-8)",
				backgroundColor: isDragOver ? "var(--bg-drag)" : "var(--bg-surface)",
				borderColor: isDragOver ? "var(--border-accent)" : "var(--border-subtle)",
				boxShadow: isDragOver ? "var(--shadow-md)" : "var(--shadow-xs)",
			}}
		>
			{/* Icon */}
			<div
				className="flex items-center justify-center mx-auto mb-5 rounded-2xl transition-all duration-200"
				style={{
					width: "64px",
					height: "64px",
					background: isDragOver ? "var(--bg-accent-subtle)" : "var(--bg-surface-raised)",
					border: `1px solid ${isDragOver ? "var(--border-accent-soft)" : "var(--border-subtle)"}`,
				}}
			>
				<FileUp
					size={28}
					strokeWidth={1.5}
					style={{ color: isDragOver ? "var(--text-accent)" : "var(--text-muted)" }}
				/>
			</div>

			{/* Text */}
			<p className="text-base font-semibold mb-1.5" style={{ color: "var(--text-primary)" }}>
				Drop a PDF to start
			</p>
			<p className="text-sm" style={{ color: isDragOver ? "var(--text-accent)" : "var(--text-muted)" }}>
				or click to browse &middot; PDF only
			</p>

			{/* Drag-over hint */}
			{isDragOver && (
				<div
					className="mt-5 text-xs font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full animate-fade-in"
					style={{
						background: "var(--bg-accent)",
						color: "white",
					}}
				>
					<ArrowDownToLine size={12} strokeWidth={2.5} />
					Release to load
				</div>
			)}
		</button>
	);
}
