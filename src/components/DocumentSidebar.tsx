"use client";

import type { PdfDocument } from "@/types";

interface DocumentSidebarProps {
	documents: PdfDocument[];
	selectedDoc: PdfDocument | null;
	onSelect: (doc: PdfDocument) => void;
}

export default function DocumentSidebar({ documents, selectedDoc, onSelect }: DocumentSidebarProps) {
	return (
		<aside
			className="rounded-xl flex flex-col overflow-hidden sidebar-scroll"
			style={{
				width: 240,
				minWidth: 240,
				background: "var(--bg-sidebar)",
				border: "1px solid var(--border-default)",
			}}
		>
			{/* Header */}
			<div
				className="px-4 py-3 flex items-center justify-between"
				style={{ borderBottom: "1px solid var(--border-default)" }}
			>
				<span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
					Documents
				</span>
				{documents.length > 0 && (
					<span
						className="text-xs font-medium px-2 py-0.5 rounded-full"
						style={{
							background: "var(--bg-accent-subtle)",
							color: "var(--text-accent)",
						}}
					>
						{documents.length}
					</span>
				)}
			</div>

			{/* List */}
			<div className="flex-1 overflow-y-auto p-2 space-y-1">
				{documents.length === 0 ? (
					<div className="px-2 py-8 text-center">
						<p className="text-xs" style={{ color: "var(--text-muted)" }}>
							No documents loaded
						</p>
					</div>
				) : (
					documents.map((doc) => {
						const isActive = selectedDoc?.file_name === doc.file_name;
						return (
							<button
								key={doc.file_name}
								type="button"
								onClick={() => onSelect(doc)}
								className="w-full text-left rounded-lg p-3 transition-all duration-150"
								style={{
									background: isActive ? "var(--bg-surface)" : "transparent",
									boxShadow: isActive ? "var(--shadow-sm)" : "none",
								}}
								onMouseEnter={(e) => {
									if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
								}}
								onMouseLeave={(e) => {
									if (!isActive) e.currentTarget.style.background = "transparent";
								}}
							>
								<div className="flex items-start gap-2.5">
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										className="mt-0.5 shrink-0"
										style={{ color: isActive ? "var(--text-accent)" : "var(--text-muted)" }}
									>
										<title>Document icon</title>
										<rect
											x="3"
											y="2"
											width="18"
											height="20"
											rx="3"
											stroke="currentColor"
											strokeWidth="1.5"
											fill="none"
										/>
										<line x1="8" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
										<line
											x1="8"
											y1="14"
											x2="14"
											y2="14"
											stroke="currentColor"
											strokeWidth="1.5"
											strokeLinecap="round"
										/>
									</svg>
									<div className="min-w-0">
										<p
											className="text-sm font-medium truncate"
											style={{ color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}
										>
											{doc.file_name}
										</p>
										<p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
											{doc.total_pages} page{doc.total_pages !== 1 ? "s" : ""} &middot;{" "}
											{doc.total_chars.toLocaleString()} chars
										</p>
									</div>
								</div>
							</button>
						);
					})
				)}
			</div>
		</aside>
	);
}
