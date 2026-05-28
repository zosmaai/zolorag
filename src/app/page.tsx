"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import ChatInput from "@/components/ChatInput";
import ChatMessages, { type ChatMessageItem } from "@/components/ChatMessages";
import DropZone from "@/components/DropZone";
import ModelBanner from "@/components/ModelBanner";
import SourcePanel from "@/components/SourcePanel";
import type { IndexStatus, IndexSummary, PdfDocument, SearchResult } from "@/types";

let messageIdCounter = 0;
function nextId(): string {
	messageIdCounter += 1;
	return `msg-${messageIdCounter}-${Date.now()}`;
}

export default function Home() {
	// Document state (single doc at a time)
	const [currentDoc, setCurrentDoc] = useState<PdfDocument | null>(null);
	const [statusMessage, setStatusMessage] = useState("");

	// Phase 2 state
	const [modelReady, setModelReady] = useState(false);
	const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
	const [isSearching, setIsSearching] = useState(false);
	const [isIndexing, setIsIndexing] = useState(false);

	// Chat state
	const [messages, setMessages] = useState<ChatMessageItem[]>([]);

	// Source panel
	const [sourcePage, setSourcePage] = useState<number | null>(null);

	const hasDocument = currentDoc !== null;
	const canSearch = modelReady && indexStatus !== null && indexStatus.indexed_chunks > 0;

	// -----------------------------------------------------------------------
	// Helper: add a system welcome message after loading a doc
	// -----------------------------------------------------------------------
	const addWelcomeMessage = useCallback((doc: PdfDocument, chunkCount: number) => {
		setMessages([
			{
				id: nextId(),
				type: "assistant",
				query: "",
				results: [],
				timestamp: Date.now(),
			},
		]);
		setStatusMessage(`${doc.file_name} — ${chunkCount} chunks indexed. Ask a question!`);
	}, []);

	// -----------------------------------------------------------------------
	// Load PDF → then auto-index
	// -----------------------------------------------------------------------
	const loadPdfByPath = useCallback(
		async (path: string) => {
			setStatusMessage(`Loading ${path.split("/").pop() || path}...`);
			setMessages([]);
			setSourcePage(null);
			try {
				const doc = await invoke<PdfDocument>("load_pdf", { path });
				setCurrentDoc(doc);

				// Auto-index if model is ready
				if (modelReady) {
					// triggerIndex will run after currentDoc is set
					// We use a timeout to let state settle
					setTimeout(() => {
						setIsIndexing(true);
						setStatusMessage("Indexing document...");
						invoke<{ doc_count: number; chunk_count: number; index_path: string }>("index_document")
							.then(async (summary) => {
								const istatus = await invoke<IndexStatus>("get_index_status");
								setIndexStatus(istatus);
								addWelcomeMessage(doc, summary.chunk_count);
							})
							.catch((err: unknown) => {
								console.warn("Auto-index failed:", err);
								setStatusMessage(`Indexing failed: ${err}`);
							})
							.finally(() => setIsIndexing(false));
					}, 0);
				} else {
					setStatusMessage(`${doc.file_name} loaded. Waiting for embedding model to index...`);
					// Show a basic welcome without index stats
					setMessages([
						{
							id: nextId(),
							type: "assistant",
							query: "",
							results: [],
							timestamp: Date.now(),
						},
					]);
				}
			} catch (err) {
				setStatusMessage(`Error: ${err}`);
			}
		},
		[modelReady, addWelcomeMessage],
	);

	// Also trigger index when model becomes ready and we have a pending doc
	const pendingIndexRef = useRef(false);
	useEffect(() => {
		if (modelReady && currentDoc && !indexStatus && !pendingIndexRef.current) {
			pendingIndexRef.current = true;
			setIsIndexing(true);
			setStatusMessage("Indexing document...");
			invoke<{ doc_count: number; chunk_count: number; index_path: string }>("index_document")
				.then(async (summary) => {
					const istatus = await invoke<IndexStatus>("get_index_status");
					setIndexStatus(istatus);
					addWelcomeMessage(currentDoc, summary.chunk_count);
				})
				.catch((err: unknown) => {
					console.warn("Auto-index failed:", err);
					setStatusMessage(`Indexing failed: ${err}`);
				})
				.finally(() => {
					setIsIndexing(false);
					pendingIndexRef.current = false;
				});
		}
	}, [modelReady, currentDoc, indexStatus, addWelcomeMessage]);

	// -----------------------------------------------------------------------
	// Browse file dialog
	// -----------------------------------------------------------------------
	const handleBrowse = useCallback(async () => {
		const { open } = await import("@tauri-apps/plugin-dialog");
		const selected = await open({
			multiple: false,
			filters: [{ name: "PDF", extensions: ["pdf"] }],
		});
		if (selected) {
			const path = Array.isArray(selected) ? selected[0] : selected;
			await loadPdfByPath(path);
		}
	}, [loadPdfByPath]);

	// -----------------------------------------------------------------------
	// Drag-drop listener
	// -----------------------------------------------------------------------
	useEffect(() => {
		let unlisten: Promise<() => void> | undefined;
		const setup = async () => {
			unlisten = listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
				const pdfPaths = event.payload.paths.filter((p) => p.endsWith(".pdf"));
				if (pdfPaths.length > 0) {
					loadPdfByPath(pdfPaths[0]);
				}
			});
		};
		setup();
		return () => {
			unlisten?.then((fn) => fn());
		};
	}, [loadPdfByPath]);

	// -----------------------------------------------------------------------
	// Load existing index on startup
	// -----------------------------------------------------------------------
	useEffect(() => {
		const init = async () => {
			try {
				const summary = await invoke<IndexSummary | null>("load_index");
				if (summary) {
					setStatusMessage(`Restored index: ${summary.chunk_count} chunks from previous session`);
					const status = await invoke<IndexStatus>("get_index_status");
					setIndexStatus(status);
				}
			} catch {
				// No index yet — fine
			}
		};
		init();
	}, []);

	// -----------------------------------------------------------------------
	// Search
	// -----------------------------------------------------------------------
	const handleSearch = useCallback(
		async (query: string) => {
			if (!canSearch || !currentDoc) return;

			setIsSearching(true);

			// Add user message
			const userMsg: ChatMessageItem = {
				id: nextId(),
				type: "user",
				query,
				timestamp: Date.now(),
			};
			setMessages((prev) => [...prev, userMsg]);

			try {
				const results = await invoke<SearchResult[]>("query_index", {
					query,
					topK: 5,
				});

				// Add assistant message with results
				const assistantMsg: ChatMessageItem = {
					id: nextId(),
					type: "assistant",
					query,
					results,
					timestamp: Date.now(),
				};
				setMessages((prev) => [...prev, assistantMsg]);
			} catch (err) {
				setStatusMessage(`Search error: ${err}`);
				const errorMsg: ChatMessageItem = {
					id: nextId(),
					type: "assistant",
					query,
					results: [],
					timestamp: Date.now(),
				};
				setMessages((prev) => [...prev, errorMsg]);
			} finally {
				setIsSearching(false);
			}
		},
		[canSearch, currentDoc],
	);

	// -----------------------------------------------------------------------
	// Handle result click → open source panel
	// -----------------------------------------------------------------------
	const handleResultClick = useCallback((result: SearchResult) => {
		setSourcePage(result.page);
	}, []);

	// -----------------------------------------------------------------------
	// Model readiness callback
	// -----------------------------------------------------------------------
	const handleModelChange = useCallback((ready: boolean) => {
		setModelReady(ready);
	}, []);

	// -----------------------------------------------------------------------
	// Close document / reset
	// -----------------------------------------------------------------------
	const handleCloseDocument = useCallback(() => {
		setCurrentDoc(null);
		setIndexStatus(null);
		setMessages([]);
		setSourcePage(null);
		setStatusMessage("");
	}, []);

	// -----------------------------------------------------------------------
	// Source panel navigation
	// -----------------------------------------------------------------------
	const handleSourceNavigate = useCallback((page: number) => {
		setSourcePage(page);
	}, []);

	// -----------------------------------------------------------------------
	// Render
	// -----------------------------------------------------------------------
	return (
		<div className="h-screen flex flex-col" style={{ background: "var(--bg-main)" }}>
			{/* ── Header ── */}
			<header
				className="flex items-center justify-between px-5 py-3 shrink-0"
				style={{
					background: "var(--bg-surface)",
					borderBottom: "1px solid var(--border-default)",
				}}
			>
				<div className="flex items-center gap-3 min-w-0">
					<div
						className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
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
							<title>zoloRAG</title>
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
						</svg>
					</div>
					<div className="min-w-0">
						<h1 className="text-base font-semibold truncate" style={{ color: "var(--text-primary)" }}>
							zoloRAG
						</h1>
						<p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
							{currentDoc ? currentDoc.file_name : "Local PDF Chat"}
						</p>
					</div>
				</div>

				<div className="flex items-center gap-2 shrink-0">
					{/* Doc management */}
					{hasDocument && (
						<>
							<button
								type="button"
								onClick={handleBrowse}
								className="text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
								style={{
									color: "var(--text-accent)",
									background: "var(--bg-accent-subtle)",
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.opacity = "0.8";
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.opacity = "1";
								}}
							>
								Change PDF
							</button>
							<button
								type="button"
								onClick={handleCloseDocument}
								className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors hover:opacity-60"
								style={{ color: "var(--text-muted)" }}
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
									<title>Close document</title>
									<line x1="18" y1="6" x2="6" y2="18" />
									<line x1="6" y1="6" x2="18" y2="18" />
								</svg>
							</button>
						</>
					)}

					{/* Model status */}
					<ModelBanner onStatusChange={handleModelChange} />
				</div>
			</header>

			{/* ── Content area (chat + optional source panel) ── */}
			<div className="flex-1 flex overflow-hidden">
				{/* Main chat column */}
				<div className="flex-1 flex flex-col min-w-0">
					{/* Empty state */}
					{!hasDocument && (
						<div className="flex-1 flex items-center justify-center p-8">
							<div className="w-full max-w-md">
								<DropZone onBrowse={handleBrowse} />
							</div>
						</div>
					)}

					{/* Chat view */}
					{hasDocument && (
						<>
							<ChatMessages
								messages={messages}
								isSearching={isSearching}
								onResultClick={handleResultClick}
								currentDocName={currentDoc?.file_name}
							/>

							{/* Input area */}
							<div className="shrink-0 px-4 pb-3 pt-2">
								{isIndexing ? (
									<div
										className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm"
										style={{
											background: "var(--bg-surface)",
											border: "1px solid var(--border-default)",
											color: "var(--text-muted)",
										}}
									>
										<div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
										<span>Indexing document...</span>
									</div>
								) : canSearch ? (
									<ChatInput onSend={handleSearch} disabled={isSearching} />
								) : (
									<div
										className="px-4 py-3 rounded-xl text-sm"
										style={{
											background: "var(--bg-surface)",
											border: "1px solid var(--border-default)",
											color: "var(--text-muted)",
										}}
									>
										{modelReady
											? "No index available. Try re-loading the document."
											: "Embedding model not ready. Search is unavailable."}
									</div>
								)}
							</div>
						</>
					)}
				</div>

				{/* Source panel (slide-out) */}
				{sourcePage !== null && currentDoc && (
					<SourcePanel
						document={currentDoc}
						page={sourcePage}
						onClose={() => setSourcePage(null)}
						onNavigate={handleSourceNavigate}
					/>
				)}
			</div>

			{/* ── Footer ── */}
			{hasDocument && indexStatus && (
				<footer
					className="flex items-center gap-3 px-5 py-2 shrink-0 text-xs"
					style={{
						background: "var(--bg-surface)",
						borderTop: "1px solid var(--border-default)",
						color: "var(--text-muted)",
					}}
				>
					<span className="flex items-center gap-1.5">
						<svg
							width="10"
							height="10"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<title>Index</title>
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
							<polyline points="14 2 14 8 20 8" />
							<line x1="16" y1="13" x2="8" y2="13" />
							<line x1="16" y1="17" x2="8" y2="17" />
						</svg>
						{indexStatus.indexed_chunks} chunk
						{indexStatus.indexed_chunks !== 1 ? "s" : ""} indexed
					</span>

					{modelReady && (
						<span className="flex items-center gap-1.5">
							<svg
								width="10"
								height="10"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								style={{ color: "var(--text-success)" }}
							>
								<title>Ready</title>
								<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
								<polyline points="22 4 12 14.01 9 11.01" />
							</svg>
							Model ready
						</span>
					)}

					{isIndexing && (
						<span className="flex items-center gap-1.5">
							<div className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
							Indexing...
						</span>
					)}

					{/* Status message */}
					{statusMessage && !statusMessage.startsWith("Error:") && (
						<span className="ml-auto truncate">{statusMessage}</span>
					)}
				</footer>
			)}
		</div>
	);
}
