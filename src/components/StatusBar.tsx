"use client";

export default function StatusBar({ message }: { message: string }) {
	if (!message) return null;

	const isError = message.startsWith("Error:");

	return (
		<div
			className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-200"
			style={{
				background: isError ? "var(--bg-danger-subtle)" : "transparent",
				color: isError ? "var(--text-danger)" : "var(--text-secondary)",
			}}
		>
			{isError ? (
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="shrink-0"
				>
					<title>Error icon</title>
					<circle cx="12" cy="12" r="10" />
					<line x1="15" y1="9" x2="9" y2="15" />
					<line x1="9" y1="9" x2="15" y2="15" />
				</svg>
			) : (
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="shrink-0"
					style={{ color: "var(--text-muted)" }}
				>
					<title>Info icon</title>
					<circle cx="12" cy="12" r="10" />
					<polyline points="12 6 12 12 16 14" />
				</svg>
			)}
			<span>{message}</span>
		</div>
	);
}
