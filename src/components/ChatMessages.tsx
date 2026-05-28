"use client";

import { useEffect, useRef } from "react";
import type { SearchResult } from "@/types";

export interface ChatMessageItem {
	id: string;
	type: "user" | "assistant" | "assistant_llm";
	query?: string;
	results?: SearchResult[];
	text?: string;
	sources?: SearchResult[];
	isStreaming?: boolean;
	timestamp: number;
}

interface ChatMessagesProps {
	messages: ChatMessageItem[];
	isSearching: boolean;
	onResultClick: (result: SearchResult) => void;
	currentDocName?: string;
}

function formatScore(score: number): string {
	return `${(score * 100).toFixed(0)}%`;
}

export default function ChatMessages({ messages, isSearching, onResultClick, currentDocName }: ChatMessagesProps) {
	const bottomRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom when messages change
	// biome-ignore lint/correctness/useExhaustiveDependencies: ref doesn't track message count
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	// Welcome message when no conversation yet
	if (messages.length === 0 && !isSearching) {
		return (
			<div className="flex-1 flex items-center justify-center p-8">
				<div className="text-center max-w-sm">
					<div
						className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
						style={{ background: "var(--bg-accent-subtle)" }}
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ color: "var(--text-accent)" }}
						>
							<title>Chat</title>
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
						</svg>
					</div>
					<p className="text-sm font-medium mb-1" style={{ color: "var(--text-primary)" }}>
						{currentDocName ? `Ask questions about ${currentDocName}` : "Drop a PDF to get started"}
					</p>
					<p className="text-xs" style={{ color: "var(--text-muted)" }}>
						{currentDocName
							? "Type a question below. The AI will answer based on the document."
							: "Load a document, then ask anything about it."}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto px-1">
			<div className="flex flex-col gap-4 py-4 max-w-3xl mx-auto">
				{messages.map((msg) => (
					<div key={msg.id}>
						{/* User message */}
						{msg.type === "user" && msg.query && (
							<div className="flex justify-end mb-1">
								<div
									className="rounded-2xl px-4 py-2.5 max-w-[75%] text-sm leading-relaxed"
									style={{
										background: "var(--bg-accent-subtle)",
										color: "var(--text-primary)",
									}}
								>
									{msg.query}
								</div>
							</div>
						)}

						{/* Assistant message (LLM answer) */}
						{msg.type === "assistant_llm" && (
							<div className="flex flex-col gap-2 mt-2">
								<div
									className="rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
									style={{
										background: "var(--bg-surface)",
										border: "1px solid var(--border-default)",
										color: "var(--text-primary)",
									}}
								>
									{msg.text || ""}
									{msg.isStreaming && (
										<span
											className="inline-block w-1.5 h-4 ml-0.5 animate-pulse"
											style={{ background: "var(--text-accent)" }}
										/>
									)}
								</div>

								{/* Source citations (shown after streaming completes) */}
								{!msg.isStreaming && msg.sources && msg.sources.length > 0 && (
									<div className="flex flex-wrap gap-1.5 px-1">
										{msg.sources.map((source) => (
											<button
												type="button"
												key={source.chunk_id}
												onClick={() => onResultClick(source)}
												className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors hover:opacity-80"
												style={{
													background: "var(--bg-accent-subtle)",
													color: "var(--text-accent)",
													border: "1px solid var(--border-accent)",
												}}
											>
												<svg
													width="9"
													height="9"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2.5"
													strokeLinecap="round"
													strokeLinejoin="round"
												>
													<title>Page</title>
													<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
													<polyline points="14 2 14 8 20 8" />
												</svg>
												Page {source.page}
												<span style={{ opacity: 0.6 }}>{formatScore(source.score)}</span>
											</button>
										))}
									</div>
								)}
							</div>
						)}

						{/* Legacy: Phase 2 search results (keep for backward compat) */}
						{msg.type === "assistant" && msg.results && msg.results.length > 0 && (
							<div className="flex flex-col gap-2 mt-2">
								<p className="text-xs font-medium px-1" style={{ color: "var(--text-muted)" }}>
									Results for "{msg.query}"
								</p>
								{msg.results.map((result) => (
									<button
										type="button"
										key={result.chunk_id}
										onClick={() => onResultClick(result)}
										className="w-full text-left rounded-xl p-3.5 transition-all duration-150 hover:opacity-85 active:scale-[0.99]"
										style={{
											background: "var(--bg-surface)",
											border: "1px solid var(--border-default)",
											boxShadow: "var(--shadow-sm)",
										}}
									>
										<div className="flex items-center justify-between gap-2 mb-1.5">
											<span
												className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
												style={{
													background: "var(--bg-accent-subtle)",
													color: "var(--text-accent)",
												}}
											>
												<svg
													width="10"
													height="10"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2.5"
													strokeLinecap="round"
													strokeLinejoin="round"
												>
													<title>Page</title>
													<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
													<polyline points="14 2 14 8 20 8" />
												</svg>
												Page {result.page}
											</span>
											<span className="text-[11px] font-mono font-semibold" style={{ color: "var(--text-muted)" }}>
												{formatScore(result.score)} match
											</span>
										</div>
										<p className="text-sm leading-relaxed line-clamp-3" style={{ color: "var(--text-secondary)" }}>
											{result.text}
										</p>
									</button>
								))}
							</div>
						)}

						{/* Assistant message with no results */}
						{msg.type === "assistant" && msg.results && msg.results.length === 0 && (
							<div className="flex justify-start mt-2">
								<div
									className="rounded-2xl px-4 py-2.5 text-sm"
									style={{
										background: "var(--bg-surface)",
										border: "1px solid var(--border-default)",
										color: "var(--text-secondary)",
									}}
								>
									No relevant matches found for "{msg.query}".
								</div>
							</div>
						)}
					</div>
				))}

				{/* Searching/generating indicator */}
				{isSearching && (
					<div className="flex items-center gap-2 px-1 py-2">
						<div
							className="w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin"
							style={{ color: "var(--text-muted)" }}
						/>
						<span className="text-sm" style={{ color: "var(--text-muted)" }}>
							Generating answer...
						</span>
					</div>
				)}

				<div ref={bottomRef} />
			</div>
		</div>
	);
}
