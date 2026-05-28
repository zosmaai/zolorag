"use client";

import { type FormEvent, useRef, useState } from "react";

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
	const [focused, setFocused] = useState(false);

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		const value = inputRef.current?.value.trim();
		if (!value) return;
		onSend(value);
		if (inputRef.current) inputRef.current.value = "";
	};

	return (
		<form onSubmit={handleSubmit}>
			<div
				className="flex items-center gap-2 transition-all duration-200"
				style={{
					background: focused ? "var(--bg-surface-raised)" : "var(--bg-surface)",
					borderRadius: "var(--radius-lg)",
					boxShadow: focused ? "var(--shadow-sm)" : "var(--shadow-xs)",
					padding: "8px 8px 8px 20px",
				}}
			>
				<input
					ref={inputRef}
					type="text"
					placeholder={placeholder}
					disabled={disabled}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					className="flex-1 bg-transparent min-w-0"
					style={{
						color: "var(--text-primary)",
						fontFamily: "var(--font-chakra), system-ui, sans-serif",
						fontSize: "15px",
						lineHeight: "1.5",
						outline: "none",
						boxShadow: "none",
					}}
				/>
				<button
					type="submit"
					disabled={disabled}
					className="flex items-center justify-center transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed active:scale-95"
					style={{
						width: "38px",
						height: "38px",
						background: disabled ? "transparent" : "var(--bg-accent)",
						color: "white",
						borderRadius: "var(--radius-md)",
						outline: "none",
					}}
				>
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
						<title>Send</title>
						<line x1="22" y1="2" x2="11" y2="13" />
						<polygon points="22 2 15 22 11 13 2 9 22 2" />
					</svg>
				</button>
			</div>
		</form>
	);
}
