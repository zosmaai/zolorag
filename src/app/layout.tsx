import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "zoloRAG",
	description: "Local PDF Chat — drag, drop, and ask questions about your documents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
