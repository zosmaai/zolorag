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
			<body>
				{/* HMR WebSocket fix — redirects "tauri.localhost" WebSocket
				   connections to the dev server. This must be INLINE so it
				   runs synchronously before Next.js bootstraps. An external
				   <script src="..."> would lag by a network round-trip,
				   letting async chunks from <head> execute first. */}
				<script
					dangerouslySetInnerHTML={{
						__html: `(function(){var W=window.WebSocket,H=window.location.hostname;if(H!=="tauri.localhost")return;var s=document.querySelectorAll("script[src*='_next']"),i,src,u,th;for(i=0;i<s.length;i++){src=s[i].src;if(src&&src.indexOf(H)===-1){try{u=new URL(src),th=u.host;window.WebSocket=function(a,b){if(typeof a==="string"){a=a.replace(H,th)}return new W(a,b)};window.WebSocket.prototype=W.prototype;Object.keys(W).forEach(function(k){window.WebSocket[k]=W[k]})}catch(e){}break}}})()`,
					}}
				/>
				{children}
			</body>
		</html>
	);
}
