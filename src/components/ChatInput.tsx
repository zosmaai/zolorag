"use client";

import { Send } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

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
	const [empty, setEmpty] = useState(true);
	const isMobile = useIsMobile();

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		const value = inputRef.current?.value.trim();
		if (!value) return;
		onSend(value);
		if (inputRef.current) inputRef.current.value = "";
		setEmpty(true);
	};

	// Mobile: bigger touch targets (≥48px), bigger font to skip iOS/Android
	// auto-zoom on focus (which happens for <16px input).
	const sendSize = isMobile ? 48 : 38;
	const inputFont = isMobile ? "16px" : "15px";
	const pad = isMobile ? "10px 10px 10px 20px" : "8px 8px 8px 20px";

	const sendDisabled = disabled || empty;

	return (
		<form onSubmit={handleSubmit}>
			<div
				className="flex items-center gap-2 transition-all duration-200"
				style={{
					background: focused ? "var(--bg-surface-raised)" : "var(--bg-surface)",
					borderRadius: "var(--radius-lg)",
					boxShadow: focused ? "var(--shadow-sm)" : "var(--shadow-xs)",
					padding: pad,
				}}
			>
				<input
					ref={inputRef}
					type="text"
					placeholder={placeholder}
					disabled={disabled}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onChange={(e) => setEmpty(e.target.value.trim().length === 0)}
					enterKeyHint="send"
					autoComplete="off"
					autoCorrect="off"
					spellCheck={false}
					className="flex-1 bg-transparent min-w-0"
					style={{
						color: "var(--text-primary)",
						fontFamily: "var(--font-chakra), system-ui, sans-serif",
						fontSize: inputFont,
						lineHeight: "1.5",
						outline: "none",
						boxShadow: "none",
					}}
				/>
				<button
					type="submit"
					disabled={sendDisabled}
					aria-label="Send question"
					className="flex items-center justify-center transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed active:scale-95 shrink-0"
					style={{
						width: `${sendSize}px`,
						height: `${sendSize}px`,
						background: sendDisabled ? "transparent" : "var(--bg-accent)",
						color: "white",
						borderRadius: "var(--radius-md)",
						outline: "none",
					}}
				>
					<Send size={isMobile ? 18 : 16} />
				</button>
			</div>
		</form>
	);
}
