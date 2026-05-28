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
			className="rounded-xl p-4 border"
			style={{
				background: "var(--bg-surface)",
				borderColor: state === "ready" ? "var(--border-success, #22c55e40)" : "var(--border-default)",
			}}
		>
			<div className="flex items-start gap-3">
				<span className="text-xl mt-0.5">{icon}</span>
				<div className="flex-1 min-w-0">
					<div className="flex items-center justify-between gap-2">
						<div>
							<p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
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
								className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-opacity hover:opacity-80"
								style={{ background: "var(--bg-accent)", color: "white" }}
							>
								Download
							</button>
						)}

						{state === "checking" && (
							<div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
								<div className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
								<span>Checking...</span>
							</div>
						)}

						{state === "ready" && (
							<div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-success, #22c55e)" }}>
								<svg
									width="12"
									height="12"
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
							<div className="text-xs" style={{ color: "var(--text-danger, #ef4444)" }}>
								Error
							</div>
						)}
					</div>

					{/* Progress bar */}
					{(state === "downloading" || state === "checking") && (
						<div className="mt-3 space-y-1">
							<div
								className="w-full h-2 rounded-full overflow-hidden"
								style={{ background: "var(--bg-input, #e5e7eb)" }}
							>
								<div
									className="h-full rounded-full transition-all duration-300 ease-out"
									style={{
										width: `${state === "checking" ? 5 : Math.max(5, pct)}%`,
										background: "var(--bg-accent)",
									}}
								/>
							</div>
							{progress && state === "downloading" && (
								<p className="text-xs" style={{ color: "var(--text-muted)" }}>
									{fmtSize(progress.downloaded)} / {fmtSize(progress.total)} ({pct}%)
								</p>
							)}
						</div>
					)}

					{/* Error message */}
					{state === "error" && error && (
						<p className="text-xs mt-1" style={{ color: "var(--text-danger, #ef4444)" }}>
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
		<div className="flex items-center justify-center p-8 min-h-full">
			<div className="w-full max-w-md space-y-6">
				{/* Logo + heading */}
				<div className="text-center space-y-2">
					<div
						className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto"
						style={{ background: "var(--bg-accent)" }}
					>
						<svg
							width="24"
							height="24"
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
					<h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
						Welcome to zoloRAG
					</h1>
					<p className="text-sm" style={{ color: "var(--text-muted)" }}>
						Download the required models to get started. Everything runs locally — no data leaves your machine.
					</p>
				</div>

				{/* Model cards */}
				<div className="space-y-3">
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
						className="text-center text-sm py-3 px-4 rounded-xl animate-pulse"
						style={{
							background: "var(--bg-accent-subtle)",
							color: "var(--text-accent)",
						}}
					>
						✅ All models ready! Drop a PDF or click &quot;Browse&quot; to start.
					</div>
				)}

				{/* Version info */}
				<p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
					zoloRAG v0.1.0 — Fully offline RAG
				</p>
			</div>
		</div>
	);
}
