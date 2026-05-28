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
			className={`
        relative w-full rounded-2xl text-center cursor-pointer select-none
        py-16 px-8 transition-all duration-200 border-2 border-dashed
        ${isDragOver ? "animate-[pulse-border_1.2s_ease-in-out_infinite]" : ""}
      `}
			style={{
				backgroundColor: isDragOver ? "var(--bg-drag)" : "var(--bg-surface)",
				borderColor: isDragOver ? "var(--border-accent)" : "var(--border-default)",
				boxShadow: isDragOver ? "var(--shadow-md)" : "var(--shadow-sm)",
			}}
		>
			<div className="mb-5 flex justify-center">
				<svg
					width="48"
					height="48"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					style={{ color: "var(--text-muted)" }}
				>
					<title>Upload PDF</title>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<polyline points="14 2 14 8 20 8" />
					<line x1="12" y1="12" x2="12" y2="18" />
					<polyline points="9 15 12 18 15 15" />
				</svg>
			</div>
			<p className="text-base font-medium mb-1" style={{ color: "var(--text-primary)" }}>
				Drop a PDF to start
			</p>
			<p className="text-sm" style={{ color: "var(--text-secondary)" }}>
				or click to browse &middot; only .pdf files
			</p>
		</button>
	);
}
