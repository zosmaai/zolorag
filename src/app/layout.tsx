import type { Metadata } from "next";
import { Chakra_Petch } from "next/font/google";
import "./globals.css";

const chakra = Chakra_Petch({
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
	variable: "--font-chakra",
	display: "swap",
});

export const metadata: Metadata = {
	title: "ZoloRAG",
	description: "Local PDF Chat — drag, drop, and ask questions about your documents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={chakra.variable}>
			<body>{children}</body>
		</html>
	);
}
