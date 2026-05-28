"use client";

import { type FormEvent, useRef } from "react";

interface ChatInputProps {
	onSend: (query: string) => void;
	disabled?: boolean;
	placeholder?: string;
}

export default function ChatInput({
	onSend,
	disabled = false,
	placeholder = "Ask a question about your document...",
}: ChatInputProps) {
	const inputRef = useRef<HTMLInputElement>(null);

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		const value = inputRef.current?.value.trim();
		if (!value) return;
		onSend(value);
		if (inputRef.current) inputRef.current.value = "";
	};

	return (
		<form onSubmit={handleSubmit} className="w-full">
			<div
				className="flex items-center gap-2 px-4 py-3 rounded-xl transition-all duration-150"
				style={{
					background: "var(--bg-surface)",
					border: "1px solid var(--border-default)",
					boxShadow: "var(--shadow-sm)",
				}}
			>
				<input
					ref={inputRef}
					type="text"
					placeholder={placeholder}
					disabled={disabled}
					className="flex-1 bg-transparent outline-none text-sm"
					style={{ color: "var(--text-primary)" }}
				/>
				<button
					type="submit"
					disabled={disabled}
					className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 disabled:opacity-30"
					style={{
						background: disabled ? "transparent" : "var(--bg-accent)",
						color: "white",
					}}
				>
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
						<title>Send</title>
						<line x1="22" y1="2" x2="11" y2="13" />
						<polygon points="22 2 15 22 11 13 2 9 22 2" />
					</svg>
				</button>
			</div>
		</form>
	);
}
