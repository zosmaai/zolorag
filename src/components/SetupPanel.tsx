"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

interface DownloadProgress {
	downloaded: number;
	total: number;
	model: "embedding" | "llm";
}

function fmtSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

interface ModelRowProps {
	label: string;
	icon: string;
	size: string;
	state: "idle" | "checking" | "downloading" | "ready" | "error";
	progress?: DownloadProgress;
	error?: string;
	onStart: () => void;
}

function ModelRow({ label, icon, size, state, progress, error, onStart }: ModelRowProps) {
	const pct =
		progress && progress.total > 0 ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : 0;

	return (
		<div
			className="transition-all duration-200"
			style={{
				background: "var(--bg-surface)",
				border: `1px solid ${
					state === "ready"
						? "var(--border-accent-soft)"
						: state === "error"
							? "var(--bg-danger-subtle)"
							: "var(--border-default)"
				}`,
				borderRadius: "var(--radius-lg)",
				padding: "var(--space-5)",
				boxShadow: state === "ready" ? "var(--shadow-sm)" : "var(--shadow-xs)",
			}}
		>
			<div className="flex items-start gap-3.5">
				<div
					className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-lg"
					style={{
						background: state === "ready" ? "var(--bg-accent-subtle)" : "var(--bg-surface-raised)",
						border: `1px solid ${state === "ready" ? "var(--border-accent-soft)" : "var(--border-subtle)"}`,
					}}
				>
					{icon}
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center justify-between gap-3">
						<div className="min-w-0">
							<p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
								{label}
							</p>
							<p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
								{size}
							</p>
						</div>

						{/* Action / status */}
						{state === "idle" && (
							<button
								type="button"
								onClick={onStart}
								className="text-xs font-semibold whitespace-nowrap transition-all duration-150 hover:opacity-90 active:scale-95"
								style={{
									background: "var(--bg-accent)",
									color: "white",
									padding: "7px 16px",
									borderRadius: "var(--radius-md)",
								}}
							>
								Download
							</button>
						)}

						{state === "checking" && (
							<div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
								<svg
									className="animate-spin-slow"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<title>Checking</title>
									<path d="M21 12a9 9 0 1 1-6.219-8.56" />
								</svg>
								<span>Checking...</span>
							</div>
						)}

						{state === "ready" && (
							<div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--text-success)" }}>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<title>Ready</title>
									<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
									<polyline points="22 4 12 14.01 9 11.01" />
								</svg>
								<span>Ready</span>
							</div>
						)}

						{state === "error" && (
							<div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--text-danger)" }}>
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
									<title>Error</title>
									<circle cx="12" cy="12" r="10" />
									<line x1="15" y1="9" x2="9" y2="15" />
									<line x1="9" y1="9" x2="15" y2="15" />
								</svg>
								<span>Error</span>
							</div>
						)}
					</div>

					{/* Progress bar */}
					{(state === "downloading" || state === "checking") && (
						<div className="mt-4 space-y-1.5">
							<div
								className="w-full h-2 rounded-full overflow-hidden"
								style={{ background: "var(--bg-surface-raised)" }}
							>
								<div
									className="h-full rounded-full transition-all duration-500 ease-out"
									style={{
										width: `${state === "checking" ? 5 : Math.max(5, pct)}%`,
										background: "var(--bg-accent)",
									}}
								/>
							</div>
							{progress && state === "downloading" && (
								<p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
									{fmtSize(progress.downloaded)} / {fmtSize(progress.total)} ({pct}%)
								</p>
							)}
						</div>
					)}

					{/* Error message */}
					{state === "error" && error && (
						<p className="text-xs mt-2 leading-relaxed" style={{ color: "var(--text-danger)" }}>
							{error}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

interface SetupPanelProps {
	/** Called when both models are ready */
	onComplete: () => void;
}

export default function SetupPanel({ onComplete }: SetupPanelProps) {
	const [embedState, setEmbedState] = useState<ModelRowProps["state"]>("idle");
	const [embedProgress, setEmbedProgress] = useState<DownloadProgress | undefined>();
	const [embedError, setEmbedError] = useState<string | undefined>();

	const [llmState, setLlmState] = useState<ModelRowProps["state"]>("idle");
	const [llmProgress, setLlmProgress] = useState<DownloadProgress | undefined>();
	const [llmError, setLlmError] = useState<string | undefined>();

	const readyRef = useRef(false);

	// Check initial status of both models
	const checkStatus = useCallback(async () => {
		try {
			const embedStatus = await invoke<{ ready: boolean; message: string }>("check_model");
			if (embedStatus.ready) {
				setEmbedState("ready");
			} else {
				setEmbedState("idle");
			}
		} catch {
			setEmbedState("idle");
		}

		try {
			const llmStatus = await invoke<{ ready: boolean; message: string }>("check_llm_model");
			if (llmStatus.ready) {
				setLlmState("ready");
			} else {
				setLlmState("idle");
			}
		} catch {
			setLlmState("idle");
		}
	}, []);

	useEffect(() => {
		checkStatus();
	}, [checkStatus]);

	// Listen for download progress events
	useEffect(() => {
		let unlisten: UnlistenFn | undefined;

		const setup = async () => {
			unlisten = await listen<DownloadProgress>("rag:download-progress", (event) => {
				const p = event.payload;
				if (p.model === "embedding") {
					setEmbedState("downloading");
					setEmbedProgress(p);
				} else if (p.model === "llm") {
					setLlmState("downloading");
					setLlmProgress(p);
				}
			});
		};
		setup();

		return () => {
			unlisten?.();
		};
	}, []);

	// When both ready, notify parent
	useEffect(() => {
		if (embedState === "ready" && llmState === "ready" && !readyRef.current) {
			readyRef.current = true;
			// Small delay so user sees the completion
			const timer = setTimeout(() => onComplete(), 600);
			return () => clearTimeout(timer);
		}
	}, [embedState, llmState, onComplete]);

	const startEmbed = useCallback(async () => {
		setEmbedState("checking");
		setEmbedError(undefined);
		try {
			await invoke("init_candle_encoder");
			// Progress events will set state to "downloading" automatically.
			// After completion, check status to confirm.
			// Poll for completion since hf-hub doesn't emit a "done" event
			const poll = setInterval(async () => {
				const s = await invoke<{ ready: boolean; message: string }>("check_model");
				if (s.ready) {
					clearInterval(poll);
					setEmbedState("ready");
				}
			}, 500);
		} catch (err) {
			setEmbedState("error");
			setEmbedError(String(err));
		}
	}, []);

	const startLlm = useCallback(async () => {
		setLlmState("checking");
		setLlmError(undefined);
		try {
			await invoke("init_llm_engine");
			// Poll for completion (init_llm_engine loads the model after download)
			const poll = setInterval(async () => {
				const s = await invoke<{ ready: boolean; message: string }>("check_llm_model");
				if (s.ready) {
					clearInterval(poll);
					setLlmState("ready");
				}
			}, 500);
		} catch (err) {
			setLlmState("error");
			setLlmError(String(err));
		}
	}, []);

	const allReady = embedState === "ready" && llmState === "ready";

	return (
		<div className="flex items-center justify-center min-h-full" style={{ padding: "var(--space-10)" }}>
			<div className="w-full" style={{ maxWidth: "480px" }}>
				<div className="space-y-8">
					{/* Logo + heading */}
					<div className="text-center space-y-3">
						<img
							src="/zolorag-logo.png"
							alt="ZoloRAG"
							className="w-14 h-14 mx-auto"
							style={{ borderRadius: "var(--radius-lg)" }}
						/>
						<div>
							<h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
								Welcome to ZoloRAG
							</h1>
							<p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
								Download the required models to get started. Everything runs locally — no data leaves your machine.
							</p>
						</div>
					</div>

					{/* Model cards */}
					<div className="space-y-3.5">
						<ModelRow
							label="Embedding Model"
							icon="📦"
							size="~85 MB (all-MiniLM-L6-v2)"
							state={embedState}
							progress={embedProgress}
							error={embedError}
							onStart={startEmbed}
						/>
						<ModelRow
							label="Language Model"
							icon="🧠"
							size="~1.8 GB (Llama 3.2 3B Q4)"
							state={llmState}
							progress={llmProgress}
							error={llmError}
							onStart={startLlm}
						/>
					</div>

					{/* Getting started hint */}
					{allReady && (
						<div
							className="text-center text-sm font-semibold py-3.5 px-5 rounded-xl animate-fade-in"
							style={{
								background: "var(--bg-accent-subtle)",
								color: "var(--text-accent)",
								border: "1px solid var(--border-accent-soft)",
							}}
						>
							<div className="flex items-center justify-center gap-2">
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<title>Ready</title>
									<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
									<polyline points="22 4 12 14.01 9 11.01" />
								</svg>
								<span>All models ready! Drop a PDF or click &quot;Browse&quot; to start.</span>
							</div>
						</div>
					)}

					{/* Version info */}
					<p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
						ZoloRAG v0.1.0 &middot; Fully offline RAG
					</p>
				</div>
			</div>
		</div>
	);
}
