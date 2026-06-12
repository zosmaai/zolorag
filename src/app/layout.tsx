import type { Metadata, Viewport } from "next";
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

// Note: deliberately NO `userScalable: false` — we want desktop accessibility
// zoom AND mobile pinch-to-zoom to keep working. `viewportFit: "cover"` lets
// the WebView draw edge-to-edge under Android system bars; we honour the
// safe-area insets in globals.css.
export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
	themeColor: "#017cf3",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={chakra.variable}>
			<body>{children}</body>
		</html>
	);
}
