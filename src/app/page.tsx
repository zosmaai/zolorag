"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import DocumentSidebar from "@/components/DocumentSidebar";
import DropZone from "@/components/DropZone";
import PreviewPanel from "@/components/PreviewPanel";
import StatusBar from "@/components/StatusBar";
import type { PdfDocument } from "@/types";

export default function Home() {
	const [documents, setDocuments] = useState<PdfDocument[]>([]);
	const [selectedDoc, setSelectedDoc] = useState<PdfDocument | null>(null);
	const [statusMessage, setStatusMessage] = useState("");

	const loadPdfByPath = useCallback(async (path: string) => {
		setStatusMessage(`Loading ${path.split("/").pop() || path}...`);
		try {
			const doc = await invoke<PdfDocument>("load_pdf", { path });
			setDocuments((prev) => [...prev, doc]);
			setSelectedDoc(doc);
			setStatusMessage(
				`Loaded ${doc.file_name} (${doc.total_pages} pages, ${doc.total_chars.toLocaleString()} characters)`,
			);
		} catch (err) {
			setStatusMessage(`Error: ${err}`);
		}
	}, []);

	const handleBrowse = useCallback(async () => {
		const { open } = await import("@tauri-apps/plugin-dialog");
		const selected = await open({
			multiple: true,
			filters: [{ name: "PDF", extensions: ["pdf"] }],
		});
		if (selected) {
			const paths = Array.isArray(selected) ? selected : [selected];
			for (const path of paths) {
				await loadPdfByPath(path);
			}
		}
	}, [loadPdfByPath]);

	useEffect(() => {
		let unlisten: Promise<() => void> | undefined;
		const setup = async () => {
			unlisten = listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
				const pdfPaths = event.payload.paths.filter((p) => p.endsWith(".pdf"));
				for (const path of pdfPaths) {
					loadPdfByPath(path);
				}
			});
		};
		setup();
		return () => {
			unlisten?.then((fn) => fn());
		};
	}, [loadPdfByPath]);

	return (
		<div className="h-screen flex flex-col" style={{ background: "var(--bg-main)" }}>
			{/* Top bar */}
			<header
				className="flex items-center justify-between px-5 py-3 shrink-0"
				style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border-default)" }}
			>
				<div className="flex items-center gap-3">
					<div
						className="w-8 h-8 rounded-lg flex items-center justify-center"
						style={{ background: "var(--bg-accent)" }}
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="white"
							strokeWidth="2.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<title>Document icon</title>
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
							<polyline points="14 2 14 8 20 8" />
							<line x1="16" y1="13" x2="8" y2="13" />
							<line x1="16" y1="17" x2="8" y2="17" />
							<polyline points="10 9 9 9 8 9" />
						</svg>
					</div>
					<div>
						<h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
							zoloRAG
						</h1>
						<p className="text-xs" style={{ color: "var(--text-muted)" }}>
							Local PDF Chat
						</p>
					</div>
				</div>
			</header>

			{/* Status bar */}
			<div className="px-5 pt-2 shrink-0">
				<StatusBar message={statusMessage} />
			</div>

			{/* Empty state */}
			{documents.length === 0 && (
				<div className="flex-1 flex items-center justify-center px-5 pb-12">
					<div className="w-full max-w-md">
						<DropZone hasDocuments={false} onBrowse={handleBrowse} />
					</div>
				</div>
			)}

			{/* Loaded state */}
			{documents.length > 0 && (
				<div className="flex-1 flex flex-col px-5 pb-3 overflow-hidden gap-2">
					<DropZone hasDocuments={true} onBrowse={handleBrowse} />

					<div className="flex flex-1 gap-3 overflow-hidden">
						<DocumentSidebar documents={documents} selectedDoc={selectedDoc} onSelect={setSelectedDoc} />
						<PreviewPanel document={selectedDoc} />
					</div>
				</div>
			)}
		</div>
	);
}
