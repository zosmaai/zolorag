"use client";

import { FileText, MessageCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
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

/** Bouncing dots animation */
function ThinkingDots() {
	return (
		<span className="inline-flex items-center gap-[3px] ml-1">
			<span
				className="w-[5px] h-[5px] rounded-full animate-bounce"
				style={{ background: "var(--text-accent)", animationDelay: "0s" }}
			/>
			<span
				className="w-[5px] h-[5px] rounded-full animate-bounce"
				style={{ background: "var(--text-accent)", animationDelay: "0.15s" }}
			/>
			<span
				className="w-[5px] h-[5px] rounded-full animate-bounce"
				style={{ background: "var(--text-accent)", animationDelay: "0.3s" }}
			/>
		</span>
	);
}

export default function ChatMessages({ messages, isSearching, onResultClick, currentDocName }: ChatMessagesProps) {
	const bottomRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom
	// biome-ignore lint/correctness/useExhaustiveDependencies: we want to scroll when messages change
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	// Welcome state — no messages yet
	if (messages.length === 0 && !isSearching) {
		return (
			<div className="flex-1 flex items-center justify-center" style={{ padding: "var(--space-10)" }}>
				<div className="flex flex-col items-center gap-4 max-w-[420px]">
					<div
						className="w-16 h-16 rounded-2xl flex items-center justify-center"
						style={{ background: "var(--bg-accent-ghost)" }}
					>
						<MessageCircle size={26} style={{ color: "var(--text-accent)" }} />
					</div>
					<p className="text-lg font-semibold text-center" style={{ color: "var(--text-primary)" }}>
						Welcome Tiramisu
					</p>
					<p className="text-sm leading-relaxed text-center" style={{ color: "var(--text-secondary)" }}>
						{currentDocName
							? "Type a question below. I'll answer based on the document."
							: "Load a document, then ask anything about it."}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto" style={{ padding: "var(--space-4) var(--space-5)" }}>
			<div className="flex flex-col gap-5">
				{messages.map((msg) => (
					<div key={msg.id} className="animate-fade-in">
						{/* ── User message ── */}
						{msg.type === "user" && msg.query && (
							<div className="flex justify-end" style={{ paddingLeft: "var(--space-16)" }}>
								<div
									className="text-sm leading-relaxed font-medium"
									style={{
										background: "var(--bg-accent)",
										color: "white",
										borderRadius: "18px 18px 4px 18px",
										padding: "12px 20px",
										maxWidth: "65%",
									}}
								>
									{msg.query}
								</div>
							</div>
						)}

						{/* ── Assistant message ── */}
						{msg.type === "assistant_llm" && (
							<div className="flex flex-col gap-2.5" style={{ paddingRight: "var(--space-16)" }}>
								<div
									className="text-sm leading-relaxed"
									style={{
										background: "var(--bg-surface)",
										border: "1px solid var(--border-subtle)",
										borderRadius: "var(--radius-lg)",
										color: "var(--text-primary)",
										padding: "16px 20px",
										boxShadow: "var(--shadow-xs)",
									}}
								>
									{/* Show thinking indicator while streaming with no text yet */}
									{msg.isStreaming && !msg.text ? (
										<span className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
											Thinking
											<ThinkingDots />
										</span>
									) : msg.text ? (
										<ReactMarkdown
											components={{
												p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
												strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
											}}
										>
											{msg.text}
										</ReactMarkdown>
									) : null}
								</div>

								{/* Source page buttons — simple, no technical scores */}
								{!msg.isStreaming && msg.sources && msg.sources.length > 0 && (
									<div className="flex flex-wrap gap-2">
										{msg.sources.map((source) => (
											<button
												type="button"
												key={source.chunk_id}
												onClick={() => onResultClick(source)}
												className="inline-flex items-center gap-1.5 text-xs font-medium transition-all duration-150 hover:opacity-80 active:scale-95"
												style={{
													background: "var(--bg-accent-subtle)",
													color: "var(--text-accent)",
													border: "1px solid var(--border-accent-soft)",
													borderRadius: "var(--radius-lg)",
													padding: "5px 12px",
												}}
											>
												<FileText size={10} strokeWidth={2.5} />
												Page {source.page}
											</button>
										))}
									</div>
								)}
							</div>
						)}

						{/* ── Legacy search results ── */}
						{msg.type === "assistant" && msg.results && msg.results.length > 0 && (
							<div className="flex flex-col gap-2">
								<p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
									Results for &ldquo;{msg.query}&rdquo;
								</p>
								{msg.results.map((result) => (
									<button
										type="button"
										key={result.chunk_id}
										onClick={() => onResultClick(result)}
										className="w-full text-left transition-all duration-150 hover:opacity-85 active:scale-[0.99]"
										style={{
											background: "var(--bg-surface)",
											border: "1px solid var(--border-subtle)",
											borderRadius: "var(--radius-md)",
											boxShadow: "var(--shadow-xs)",
											padding: "14px 16px",
										}}
									>
										<div className="flex items-center gap-2 mb-2">
											<span
												className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold"
												style={{
													background: "var(--bg-accent-subtle)",
													color: "var(--text-accent)",
												}}
											>
												<FileText size={10} strokeWidth={2.5} />
												Page {result.page}
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
							<div className="flex justify-start">
								<div
									className="text-sm"
									style={{
										background: "var(--bg-surface)",
										border: "1px solid var(--border-subtle)",
										borderRadius: "var(--radius-lg)",
										color: "var(--text-secondary)",
										padding: "14px 18px",
									}}
								>
									No relevant matches found for &ldquo;{msg.query}&rdquo;.
								</div>
							</div>
						)}
					</div>
				))}

				<div ref={bottomRef} />
			</div>
		</div>
	);
}
