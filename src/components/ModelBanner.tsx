"use client";

import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
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
				<CheckCircle2 size={12} strokeWidth={2.5} />
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
			<AlertTriangle size={12} />
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
