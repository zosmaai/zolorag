"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle, AlertTriangle, LoaderCircle, X, XCircle } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import ChatInput from "@/components/ChatInput";
import ChatMessages, { type ChatMessageItem } from "@/components/ChatMessages";
import DropZone from "@/components/DropZone";
import SetupPanel from "@/components/SetupPanel";
import SourcePanel from "@/components/SourcePanel";
import type { IndexStatus, IndexSummary, PdfDocument, SearchResult } from "@/types";

let messageIdCounter = 0;
function nextId(): string {
	messageIdCounter += 1;
	return `msg-${messageIdCounter}-${Date.now()}`;
}

export default function Home() {
	const [currentDoc, setCurrentDoc] = useState<PdfDocument | null>(null);
	const [setupComplete, setSetupComplete] = useState(false);
	const [modelReady, setModelReady] = useState(false);
	const [llmReady, setLlmReady] = useState(false);
	const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [isIndexing, setIsIndexing] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessageItem[]>([]);
	const [sourcePage, setSourcePage] = useState<number | null>(null);
	const streamingIdRef = useRef<string | null>(null);

	const hasDocument = currentDoc !== null;
	const canAsk = modelReady && indexStatus !== null && indexStatus.indexed_chunks > 0 && llmReady;

	// -----------------------------------------------------------------------
	const addWelcomeMessage = useCallback((doc: PdfDocument) => {
		setMessages([
			{
				id: nextId(),
				type: "assistant_llm",
				query: "",
				text: `📄 **${doc.file_name}** ready! Ask me anything about it.`,
				sources: [],
				isStreaming: false,
				timestamp: Date.now(),
			},
		]);
	}, []);

	// -----------------------------------------------------------------------
	const triggerIndexAndWelcome = useCallback(
		(doc: PdfDocument) => {
			setIsIndexing(true);
			invoke<{ doc_count: number; chunk_count: number; index_path: string }>("index_document")
				.then(async () => {
					const istatus = await invoke<IndexStatus>("get_index_status");
					setIndexStatus(istatus);
					addWelcomeMessage(doc);
				})
				.catch((err: unknown) => {
					console.warn("Auto-index failed:", err);
				})
				.finally(() => setIsIndexing(false));
		},
		[addWelcomeMessage],
	);

	// -----------------------------------------------------------------------
	const loadPdfByPath = useCallback(
		async (path: string) => {
			setMessages([]);
			setSourcePage(null);
			setIndexStatus(null);
			setLoadError(null);
			try {
				const doc = await invoke<PdfDocument>("load_pdf", { path });
				setCurrentDoc(doc);

				if (modelReady) {
					triggerIndexAndWelcome(doc);
				} else {
					setMessages([
						{
							id: nextId(),
							type: "assistant_llm",
							query: "",
							text: `📄 ${doc.file_name} loaded. Give me a moment to finish setting up...`,
							sources: [],
							isStreaming: false,
							timestamp: Date.now(),
						},
					]);
				}
			} catch (err) {
				const msg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to load PDF.";
				setLoadError(msg);
				console.warn("Load failed:", err);
			}
		},
		[modelReady, triggerIndexAndWelcome],
	);

	const pendingIndexRef = useRef(false);
	useEffect(() => {
		if (modelReady && currentDoc && !indexStatus && !pendingIndexRef.current && !isIndexing) {
			pendingIndexRef.current = true;
			triggerIndexAndWelcome(currentDoc);
		}
	}, [modelReady, currentDoc, indexStatus, isIndexing, triggerIndexAndWelcome]);

	useEffect(() => {
		if (indexStatus) {
			pendingIndexRef.current = false;
		}
	}, [indexStatus]);

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
	const refreshModelStatus = useCallback(async () => {
		try {
			const s = await invoke<{ ready: boolean }>("check_model");
			setModelReady(s.ready);
		} catch {
			setModelReady(false);
		}
		try {
			const s = await invoke<{ ready: boolean }>("check_llm_model");
			setLlmReady(s.ready);
		} catch {
			setLlmReady(false);
		}
	}, []);

	// -----------------------------------------------------------------------
	useEffect(() => {
		const init = async () => {
			await refreshModelStatus();
			try {
				const summary = await invoke<IndexSummary | null>("load_index");
				if (summary) {
					const status = await invoke<IndexStatus>("get_index_status");
					setIndexStatus(status);
				}
			} catch {
				// No index yet
			}
		};
		init();
	}, [refreshModelStatus]);

	useEffect(() => {
		if (modelReady && llmReady) {
			setSetupComplete(true);
		}
	}, [modelReady, llmReady]);

	// -----------------------------------------------------------------------
	const handleAsk = useCallback(
		async (query: string) => {
			if (!canAsk || !currentDoc) return;

			const userMsg: ChatMessageItem = {
				id: nextId(),
				type: "user",
				query,
				timestamp: Date.now(),
			};
			setMessages((prev) => [...prev, userMsg]);

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
							? { ...m, text: `${m.text || ""}\n\n⚠️ Error: ${event.payload}`, isStreaming: false }
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

			invoke("ask_question", { query, topK: 5 }).catch((err: unknown) => {
				setMessages((prev) =>
					prev.map((m) =>
						m.id === streamingIdRef.current
							? { ...m, text: `${m.text || ""}\n\n⚠️ Error: ${err}`, isStreaming: false }
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
	const handleResultClick = useCallback((result: SearchResult) => {
		setSourcePage(result.page);
	}, []);

	const handleCloseDocument = useCallback(() => {
		setCurrentDoc(null);
		setIndexStatus(null);
		setMessages([]);
		setSourcePage(null);
		setLoadError(null);
	}, []);

	const handleSourceNavigate = useCallback((page: number) => {
		setSourcePage(page);
	}, []);

	// -----------------------------------------------------------------------
	return (
		<div className="h-screen flex flex-col" style={{ background: "var(--bg-main)" }}>
			{/* ── Header ── */}
			<header
				className="flex items-center justify-between shrink-0"
				style={{
					background: "var(--bg-surface)",
					borderBottom: "1px solid var(--border-default)",
					padding: "var(--space-3) var(--space-5)",
				}}
			>
				<div className="flex items-center gap-3 min-w-0">
					<Image
						src="/zolorag-logo.png"
						alt="ZoloRAG"
						width={36}
						height={36}
						className="shrink-0"
						style={{ borderRadius: "var(--radius-md)" }}
					/>
					<div className="min-w-0">
						<h1 className="text-base font-semibold tracking-tight truncate" style={{ color: "var(--text-primary)" }}>
							ZoloRAG
						</h1>
						<p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
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
								className="text-xs font-medium transition-all duration-150 hover:opacity-80 active:scale-95"
								style={{
									color: "var(--text-accent)",
									background: "var(--bg-accent-subtle)",
									padding: "6px 14px",
									borderRadius: "var(--radius-md)",
								}}
							>
								Change PDF
							</button>
							<button
								type="button"
								onClick={handleCloseDocument}
								className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 hover:bg-hover active:scale-95"
								style={{
									color: "var(--text-muted)",
									borderRadius: "var(--radius-md)",
								}}
							>
								<X size={15} />
							</button>
						</>
					)}
				</div>
			</header>

			{/* ── Content ── */}
			<div className="flex-1 flex overflow-hidden">
				<div className="flex-1 flex flex-col min-w-0">
					{/* Setup or Drop */}
					{!hasDocument && !setupComplete && (
						<SetupPanel
							onComplete={() => {
								setSetupComplete(true);
								refreshModelStatus();
							}}
						/>
					)}
					{!hasDocument && setupComplete && (
						<div className="flex-1 flex items-center justify-center" style={{ padding: "var(--space-10)" }}>
							<div className="w-full" style={{ maxWidth: "440px" }}>
								{loadError && (
									<div
										className="flex items-start gap-3 mb-4 text-sm animate-fade-in"
										style={{
											background: "var(--bg-danger-subtle)",
											border: "1px solid var(--bg-danger-subtle)",
											borderRadius: "var(--radius-lg)",
											color: "var(--text-danger)",
											padding: "14px 16px",
										}}
									>
										<AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
										<div className="flex-1 leading-relaxed">
											<strong className="font-semibold">Couldn&rsquo;t load PDF</strong>
											<p className="mt-1" style={{ color: "var(--text-danger)" }}>
												{loadError}
											</p>
										</div>
										<button
											type="button"
											onClick={() => setLoadError(null)}
											className="shrink-0 p-1 rounded transition-all hover:opacity-70 active:scale-90"
										>
											<XCircle size={16} />
										</button>
									</div>
								)}
								<DropZone onBrowse={handleBrowse} />
							</div>
						</div>
					)}

					{/* Chat */}
					{hasDocument && (
						<>
							<ChatMessages
								messages={messages}
								isSearching={isGenerating}
								onResultClick={handleResultClick}
								currentDocName={currentDoc?.file_name}
							/>

							{/* Input area */}
							<div
								style={{
									padding: "var(--space-3) var(--space-5) var(--space-4)",
									background: "var(--bg-main)",
									borderTop: "1px solid var(--border-subtle)",
								}}
							>
								{isIndexing ? (
									<div
										style={{
											background: "var(--bg-surface)",
											border: "1px solid var(--border-default)",
											borderRadius: "var(--radius-lg)",
											padding: "16px 20px",
										}}
									>
										<div className="flex items-center gap-3 text-sm">
											<LoaderCircle
												className="animate-spin-slow shrink-0"
												size={18}
												strokeWidth={2.5}
												style={{ color: "var(--text-accent)" }}
											/>
											<div className="flex-1">
												<span className="font-medium" style={{ color: "var(--text-primary)" }}>
													Preparing your document...
												</span>
												<div
													className="mt-2 w-full h-1.5 rounded-full overflow-hidden"
													style={{ background: "var(--bg-surface-raised)" }}
												>
													<div
														className="h-full rounded-full indexing-bar"
														style={{ width: "100%", background: "var(--bg-accent)" }}
													/>
												</div>
											</div>
										</div>
									</div>
								) : canAsk ? (
									<ChatInput
										onSend={handleAsk}
										disabled={isGenerating}
										placeholder={isGenerating ? "Generating answer..." : "Ask a question about your document..."}
									/>
								) : (
									<div
										className="flex items-center gap-3 text-sm"
										style={{
											background: "var(--bg-surface)",
											border: "1px solid var(--border-default)",
											borderRadius: "var(--radius-lg)",
											color: "var(--text-muted)",
											padding: "14px 18px",
										}}
									>
										<AlertCircle size={16} />
										<span>
											{!modelReady
												? "Just a moment, still getting ready..."
												: !indexStatus
													? "Almost ready, processing your document..."
													: !llmReady
														? "Finishing up the setup..."
														: "Something isn't ready yet."}
										</span>
									</div>
								)}
							</div>
						</>
					)}
				</div>

				{/* Source panel */}
				{sourcePage !== null && currentDoc && (
					<SourcePanel
						document={currentDoc}
						page={sourcePage}
						onClose={() => setSourcePage(null)}
						onNavigate={handleSourceNavigate}
					/>
				)}
			</div>
		</div>
	);
}
