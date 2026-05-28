"use client";

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
			className="relative w-full text-center cursor-pointer select-none transition-all duration-200 border-2 border-dashed group"
			style={{
				borderRadius: "var(--radius-xl)",
				padding: "48px 32px",
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
				<svg
					width="28"
					height="28"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					style={{ color: isDragOver ? "var(--text-accent)" : "var(--text-muted)" }}
				>
					<title>Upload PDF</title>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<polyline points="14 2 14 8 20 8" />
					<line x1="12" y1="12" x2="12" y2="18" />
					<polyline points="9 15 12 18 15 15" />
				</svg>
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
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<title>Drop</title>
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
						<polyline points="7 10 12 15 17 10" />
						<line x1="12" y1="15" x2="12" y2="3" />
					</svg>
					Release to load
				</div>
			)}
		</button>
	);
}
