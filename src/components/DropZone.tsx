"use client";

import { useState } from "react";

interface DropZoneProps {
	hasDocuments: boolean;
	onBrowse: () => void;
}

export default function DropZone({ hasDocuments, onBrowse }: DropZoneProps) {
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
        relative rounded-xl text-center cursor-pointer select-none
        transition-all duration-200
        ${
					isDragOver
						? "border-2 border-dashed animate-[pulse-border_1.2s_ease-in-out_infinite]"
						: "border-2 border-dashed"
				}
        ${hasDocuments ? "py-3 px-4 mt-2" : "py-16 px-8 mt-4"}
      `}
			style={{
				backgroundColor: isDragOver ? "var(--bg-drag)" : "var(--bg-surface)",
				borderColor: isDragOver ? "var(--border-accent)" : "var(--border-default)",
				boxShadow: isDragOver ? "var(--shadow-md)" : "var(--shadow-sm)",
			}}
		>
			{hasDocuments ? (
				<p style={{ color: "var(--text-secondary)" }} className="text-sm">
					Drop PDFs here or click to browse
				</p>
			) : (
				<div>
					<div className="mb-4 flex justify-center">
						<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
							<title>Upload document icon</title>
							<rect
								x="8"
								y="4"
								width="32"
								height="40"
								rx="4"
								stroke="currentColor"
								strokeWidth="2"
								fill="none"
								style={{ color: "var(--text-muted)" }}
							/>
							<line
								x1="16"
								y1="16"
								x2="32"
								y2="16"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								style={{ color: "var(--text-muted)" }}
							/>
							<line
								x1="16"
								y1="24"
								x2="28"
								y2="24"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								style={{ color: "var(--text-muted)" }}
							/>
							<line
								x1="16"
								y1="32"
								x2="24"
								y2="32"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								style={{ color: "var(--text-muted)" }}
							/>
						</svg>
					</div>
					<p className="text-base font-medium mb-1" style={{ color: "var(--text-primary)" }}>
						Drop PDFs here
					</p>
					<p className="text-sm" style={{ color: "var(--text-secondary)" }}>
						or click to browse &middot; only .pdf files
					</p>
				</div>
			)}
		</button>
	);
}
