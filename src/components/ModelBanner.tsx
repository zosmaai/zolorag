"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { ModelStatus } from "@/types";

interface ModelBannerProps {
	onStatusChange?: (ready: boolean) => void;
}

export default function ModelBanner({ onStatusChange }: ModelBannerProps) {
	const [status, setStatus] = useState<ModelStatus | null>(null);
	const [isPulling, setIsPulling] = useState(false);

	const checkStatus = useCallback(async () => {
		try {
			const s = await invoke<ModelStatus>("check_model");
			setStatus(s);
			onStatusChange?.(s.ready);
		} catch {
			setStatus({ ready: false, message: "Could not reach backend" });
			onStatusChange?.(false);
		}
	}, [onStatusChange]);

	const handleInit = async () => {
		setIsPulling(true);
		try {
			await invoke("init_candle_encoder");
			await checkStatus();
		} catch (err) {
			setStatus({ ready: false, message: `Init failed: ${err}` });
		} finally {
			setIsPulling(false);
		}
	};

	useEffect(() => {
		checkStatus();
	}, [checkStatus]);

	if (!status) {
		return (
			<div
				className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
				style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}
			>
				<div className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
				<span>Checking embedding model...</span>
			</div>
		);
	}

	if (status.ready) {
		return (
			<div
				className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
				style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
			>
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
				<span style={{ color: "var(--text-success)" }}>{status.message}</span>
			</div>
		);
	}

	return (
		<div
			className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
			style={{
				background: "var(--bg-warning-subtle, #fef3c7)",
				color: "var(--text-warning, #92400e)",
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
			<span className="flex-1">{status.message}</span>
			{!isPulling && (
				<button
					type="button"
					onClick={handleInit}
					className="px-2 py-0.5 rounded text-xs font-medium transition-colors"
					style={{
						background: "var(--bg-accent)",
						color: "white",
					}}
				>
					Download Model
				</button>
			)}
			{isPulling && (
				<div className="flex items-center gap-1">
					<div className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
					<span>Downloading...</span>
				</div>
			)}
		</div>
	);
}
