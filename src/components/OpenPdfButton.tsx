"use client";

import { FileUp } from "lucide-react";

interface OpenPdfButtonProps {
	onBrowse: () => void;
	/**
	 * `"primary"` (mobile) renders a full prominent CTA.
	 * `"secondary"` (desktop) renders an unobtrusive link beneath the DropZone.
	 */
	variant?: "primary" | "secondary";
}

export default function OpenPdfButton({ onBrowse, variant = "primary" }: OpenPdfButtonProps) {
	if (variant === "secondary") {
		return (
			<button
				type="button"
				onClick={onBrowse}
				className="text-xs font-medium transition-opacity hover:opacity-70"
				style={{ color: "var(--text-muted)", marginTop: "var(--space-3)" }}
			>
				or browse files…
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={onBrowse}
			className="w-full text-center cursor-pointer select-none transition-all duration-200 active:scale-[0.98]"
			style={{
				borderRadius: "var(--radius-xl)",
				padding: "var(--space-10) var(--space-6)",
				backgroundColor: "var(--bg-surface)",
				border: "1px solid var(--border-default)",
				boxShadow: "var(--shadow-sm)",
				minHeight: "48px",
			}}
		>
			<div
				className="flex items-center justify-center mx-auto mb-5 rounded-2xl"
				style={{
					width: "64px",
					height: "64px",
					background: "var(--bg-accent-subtle)",
					border: "1px solid var(--border-accent-soft)",
				}}
			>
				<FileUp size={28} strokeWidth={1.5} style={{ color: "var(--text-accent)" }} />
			</div>
			<p className="text-base font-semibold mb-1.5" style={{ color: "var(--text-primary)" }}>
				Open a PDF
			</p>
			<p className="text-sm" style={{ color: "var(--text-muted)" }}>
				Pick a file to start chatting
			</p>
		</button>
	);
}
