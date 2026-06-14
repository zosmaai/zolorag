"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Bot, CheckCircle2, Grid3x3, LoaderCircle, XCircle } from "lucide-react";
import Image from "next/image";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

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
	icon: ReactNode;
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
					className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
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
								<LoaderCircle className="animate-spin-slow" size={14} strokeWidth={2.5} />
								<span>Checking...</span>
							</div>
						)}

						{state === "ready" && (
							<div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--text-success)" }}>
								<CheckCircle2 size={14} strokeWidth={2.5} />
								<span>Ready</span>
							</div>
						)}

						{state === "error" && (
							<div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--text-danger)" }}>
								<XCircle size={14} />
								<span>Error</span>
							</div>
						)}
					</div>

					{/* Progress bar */}
					{(state === "downloading" || state === "checking") && (
						<div className="mt-4 space-y-1.5">
							<div
								className="w-full h-2.5 rounded-full overflow-hidden"
								style={{ background: "var(--bg-surface-raised)" }}
							>
								<div
									className={`h-full rounded-full ${state === "checking" || pct === 0 ? "animate-pulse" : ""}`}
									style={{
										width: pct === 0 ? "12%" : `${pct}%`,
										background: "var(--bg-accent)",
										transition: "width 0.5s ease-out",
									}}
								/>
							</div>
							{progress && state === "downloading" && progress.downloaded > 0 && (
								<p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
									{fmtSize(progress.downloaded)} / {fmtSize(progress.total)} ({pct}%)
								</p>
							)}
							{state === "checking" && !progress && (
								<p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
									Starting...
								</p>
							)}
							{state === "downloading" && progress && progress.downloaded === 0 && (
								<p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
									Connecting...
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
	const isMobile = useIsMobile();
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

	// ── startEmbed / startLlm ──
	//
	// On Android, the Rust commands are SYNC (`fn`, not `async fn`) and spawn
	// a `std::thread` for the actual download — see
	// [[sources/android-sync-command-background-thread-pattern]].
	// They return immediately; progress comes via `rag:download-progress`
	// events, completion is detected by polling `check_model` /
	// `check_llm_model` every 800 ms.
	const startEmbed = useCallback(() => {
		setEmbedState("checking");
		setEmbedError(undefined);
		invoke("init_candle_encoder").catch((err: unknown) => {
			setEmbedState("error");
			setEmbedError(String(err));
		});
		const poll = setInterval(async () => {
			try {
				const s = await invoke<{ ready: boolean; message: string }>("check_model");
				if (s.ready) {
					clearInterval(poll);
					setEmbedState("ready");
				}
			} catch {
				/* keep polling */
			}
		}, 800);
	}, []);

	const startLlm = useCallback(() => {
		setLlmState("checking");
		setLlmError(undefined);
		invoke("init_llm_engine").catch((err: unknown) => {
			setLlmState("error");
			setLlmError(String(err));
		});
		const poll = setInterval(async () => {
			try {
				const s = await invoke<{ ready: boolean; message: string }>("check_llm_model");
				if (s.ready) {
					clearInterval(poll);
					setLlmState("ready");
				}
			} catch {
				/* keep polling */
			}
		}, 800);
	}, []);

	const allReady = embedState === "ready" && llmState === "ready";

	return (
		<div
			className="flex items-center justify-center min-h-full overflow-y-auto"
			style={{ padding: isMobile ? "var(--space-6) var(--space-4)" : "var(--space-10)" }}
		>
			<div className="w-full" style={{ maxWidth: "480px" }}>
				<div className={isMobile ? "space-y-6" : "space-y-8"}>
					{/* Logo + heading */}
					<div className="text-center space-y-3">
						<Image
							src="/zolorag-logo.png"
							alt="ZoloRAG"
							width={56}
							height={56}
							className="w-14 h-14 mx-auto"
							style={{ borderRadius: "var(--radius-lg)" }}
						/>
						<div>
							<h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
								Welcome to ZoloRAG
							</h1>
							<p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
								Download the required models to get started. Everything runs locally — no data leaves your device.
							</p>
						</div>
					</div>

					{/* Model cards */}
					<div className="space-y-3.5">
						<ModelRow
							label="Embedding Model"
							icon={<Grid3x3 size={18} />}
							size="~85 MB (all-MiniLM-L6-v2)"
							state={embedState}
							progress={embedProgress}
							error={embedError}
							onStart={startEmbed}
						/>
						<ModelRow
							label="Language Model"
							icon={<Bot size={18} />}
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
								<CheckCircle2 size={16} strokeWidth={2.5} />
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
