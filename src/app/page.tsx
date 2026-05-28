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
	const [llmReady, setLlmReady] = useState(false);
	const [pullingLlm, setPullingLlm] = useState(false);
	const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [isIndexing, setIsIndexing] = useState(false);

	// Chat state
	const [messages, setMessages] = useState<ChatMessageItem[]>([]);

	// Source panel
	const [sourcePage, setSourcePage] = useState<number | null>(null);

	// Ref for the current streaming message ID (updated without re-renders)
	const streamingIdRef = useRef<string | null>(null);

	const hasDocument = currentDoc !== null;
	const canAsk = modelReady && indexStatus !== null && indexStatus.indexed_chunks > 0 && llmReady;

	// -----------------------------------------------------------------------
	// Helper: add a welcome message after loading a doc
	// -----------------------------------------------------------------------
	const addWelcomeMessage = useCallback((doc: PdfDocument, chunkCount: number) => {
		setMessages([
			{
				id: nextId(),
				type: "assistant_llm",
				query: "",
				text: `📄 **${doc.file_name}** loaded (${doc.total_pages} pages, ${chunkCount} chunks indexed). Ask a question to get started!`,
				sources: [],
				isStreaming: false,
				timestamp: Date.now(),
			},
		]);
		setStatusMessage(`${doc.file_name} — ${chunkCount} chunks indexed`);
	}, []);

	// -----------------------------------------------------------------------
	// Index after PDF load
	// -----------------------------------------------------------------------
	const triggerIndexAndWelcome = useCallback(
		(doc: PdfDocument) => {
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
		},
		[addWelcomeMessage],
	);

	// -----------------------------------------------------------------------
	// Load PDF
	// -----------------------------------------------------------------------
	const loadPdfByPath = useCallback(
		async (path: string) => {
			setStatusMessage(`Loading ${path.split("/").pop() || path}...`);
			setMessages([]);
			setSourcePage(null);
			setIndexStatus(null);
			try {
				const doc = await invoke<PdfDocument>("load_pdf", { path });
				setCurrentDoc(doc);

				if (modelReady) {
					triggerIndexAndWelcome(doc);
				} else {
					setStatusMessage(`${doc.file_name} loaded. Waiting for embedding model to index...`);
					setMessages([
						{
							id: nextId(),
							type: "assistant_llm",
							query: "",
							text: `📄 ${doc.file_name} loaded. Model not ready yet — search will activate once the embedding model is available.`,
							sources: [],
							isStreaming: false,
							timestamp: Date.now(),
						},
					]);
				}
			} catch (err) {
				setStatusMessage(`Error: ${err}`);
			}
		},
		[modelReady, triggerIndexAndWelcome],
	);

	// Also trigger index when model becomes ready with a pending doc
	const pendingIndexRef = useRef(false);
	useEffect(() => {
		if (modelReady && currentDoc && !indexStatus && !pendingIndexRef.current && !isIndexing) {
			pendingIndexRef.current = true;
			triggerIndexAndWelcome(currentDoc);
		}
	}, [modelReady, currentDoc, indexStatus, isIndexing, triggerIndexAndWelcome]);

	// Reset pending flag when index status changes
	useEffect(() => {
		if (indexStatus) {
			pendingIndexRef.current = false;
		}
	}, [indexStatus]);

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
	// Check LLM model availability
	// -----------------------------------------------------------------------
	const checkLlmModel = useCallback(async () => {
		try {
			const status = await invoke<{ ready: boolean; message: string }>("check_llm_model");
			setLlmReady(status.ready);
			if (!status.ready) {
				setStatusMessage(`LLM: ${status.message}`);
			}
		} catch {
			setLlmReady(false);
		}
	}, []);

	const handlePullLlm = useCallback(async () => {
		setPullingLlm(true);
		setStatusMessage("Pulling LLM model (llama3.2:3b)...");
		try {
			await invoke("pull_llm_model");
			await checkLlmModel();
			setStatusMessage("LLM model ready!");
		} catch (err) {
			setStatusMessage(`Failed to pull LLM model: ${err}`);
		} finally {
			setPullingLlm(false);
		}
	}, [checkLlmModel]);

	// -----------------------------------------------------------------------
	// Load existing index on startup
	// -----------------------------------------------------------------------
	useEffect(() => {
		const init = async () => {
			// Check LLM model on startup
			checkLlmModel();

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
	}, [checkLlmModel]);

	// -----------------------------------------------------------------------
	// Ask question (Phase 3 — streaming LLM answer)
	// -----------------------------------------------------------------------
	const handleAsk = useCallback(
		async (query: string) => {
			if (!canAsk || !currentDoc) return;

			// 1. Add user message
			const userMsg: ChatMessageItem = {
				id: nextId(),
				type: "user",
				query,
				timestamp: Date.now(),
			};
			setMessages((prev) => [...prev, userMsg]);

			// 2. Create a placeholder assistant message for streaming
			const assistantId = nextId();
			const assistantMsg: ChatMessageItem = {
				id: assistantId,
				type: "assistant_llm",
				query,
				text: "",
				sources: [],
				isStreaming: true,
				timestamp: Date.now(),
			};
			setMessages((prev) => [...prev, assistantMsg]);
			streamingIdRef.current = assistantId;

			// 3. Set up event listeners before invoking
			setIsGenerating(true);

			const unlistenToken = await listen<string>("rag:token", (event) => {
				setMessages((prev) =>
					prev.map((m) => (m.id === streamingIdRef.current ? { ...m, text: (m.text || "") + event.payload } : m)),
				);
			});

			const unlistenSources = await listen<SearchResult[]>("rag:sources", (event) => {
				setMessages((prev) =>
					prev.map((m) => (m.id === streamingIdRef.current ? { ...m, sources: event.payload } : m)),
				);
			});

			const unlistenDone = await listen<string>("rag:done", () => {
				setMessages((prev) => prev.map((m) => (m.id === streamingIdRef.current ? { ...m, isStreaming: false } : m)));
				streamingIdRef.current = null;
				setIsGenerating(false);
				unlistenToken();
				unlistenSources();
				unlistenDone();
			});

			const unlistenError = await listen<string>("rag:error", (event) => {
				setMessages((prev) =>
					prev.map((m) =>
						m.id === streamingIdRef.current
							? {
									...m,
									text: `${m.text || ""}\n\n⚠️ Error: ${event.payload}`,
									isStreaming: false,
								}
							: m,
					),
				);
				streamingIdRef.current = null;
				setIsGenerating(false);
				unlistenToken();
				unlistenSources();
				unlistenDone();
				unlistenError();
			});

			// 4. Invoke the backend (fire-and-forget — responses come via events)
			invoke("ask_question", { query, topK: 5 }).catch((err: unknown) => {
				setMessages((prev) =>
					prev.map((m) =>
						m.id === streamingIdRef.current
							? {
									...m,
									text: `${m.text || ""}\n\n⚠️ Error: ${err}`,
									isStreaming: false,
								}
							: m,
					),
				);
				streamingIdRef.current = null;
				setIsGenerating(false);
				unlistenToken();
				unlistenSources();
				unlistenDone();
				unlistenError();
			});
		},
		[canAsk, currentDoc],
	);

	// -----------------------------------------------------------------------
	// Handle result click → open source panel
	// -----------------------------------------------------------------------
	const handleResultClick = useCallback((result: SearchResult) => {
		setSourcePage(result.page);
	}, []);

	// Check LLM model when embedding model becomes ready
	useEffect(() => {
		if (modelReady) {
			checkLlmModel();
		}
	}, [modelReady, checkLlmModel]);

	// -----------------------------------------------------------------------
	// Model readiness callback
	// -----------------------------------------------------------------------
	const handleModelChange = useCallback((ready: boolean) => {
		setModelReady(ready);
	}, []);

	// -----------------------------------------------------------------------
	// Close document
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
								isSearching={isGenerating}
								onResultClick={handleResultClick}
								currentDocName={currentDoc?.file_name}
							/>

							{/* LLM download banner */}
							{!llmReady && hasDocument && indexStatus && !isIndexing && (
								<div
									className="flex items-center gap-2 px-4 py-2 mx-4 mb-2 rounded-lg text-xs"
									style={{
										background: "var(--bg-warning-subtle)",
										color: "var(--text-warning)",
									}}
								>
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<title>Warning</title>
										<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
										<line x1="12" y1="9" x2="12" y2="13" />
										<line x1="12" y1="17" x2="12.01" y2="17" />
									</svg>
									<span className="flex-1">LLM model not available. Download llama3.2:3b to enable AI answers.</span>
									{!pullingLlm && (
										<button
											type="button"
											onClick={handlePullLlm}
											className="px-2.5 py-1 rounded text-xs font-medium"
											style={{ background: "var(--bg-accent)", color: "white" }}
										>
											Download LLM (~2GB)
										</button>
									)}
									{pullingLlm && (
										<div className="flex items-center gap-1">
											<div className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
											<span>Downloading...</span>
										</div>
									)}
								</div>
							)}

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
								) : canAsk ? (
									<ChatInput
										onSend={handleAsk}
										disabled={isGenerating}
										placeholder={isGenerating ? "Waiting for answer..." : "Ask a question about your document..."}
									/>
								) : (
									<div
										className="px-4 py-3 rounded-xl text-sm"
										style={{
											background: "var(--bg-surface)",
											border: "1px solid var(--border-default)",
											color: "var(--text-muted)",
										}}
									>
										{!modelReady
											? "Embedding model not ready."
											: !indexStatus
												? "No index found. Try re-loading the document."
												: !llmReady
													? "LLM model not ready. Download above to ask questions."
													: "Something isn't ready yet."}
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

					{statusMessage && <span className="ml-auto truncate">{statusMessage}</span>}
				</footer>
			)}
		</div>
	);
}
