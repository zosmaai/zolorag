import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const internalHost = process.env.TAURI_DEV_HOST || "localhost";

const nextConfig: NextConfig = {
	output: "export",
	images: { unoptimized: true },
	assetPrefix: isProd ? undefined : `http://${internalHost}:3000`,

	// ── CORS for Tauri Android dev ──
	// On Android the WebView page origin is `http://tauri.localhost` while
	// Next.js chunks/HMR are served from `http://<LAN_IP>:3000`. That makes
	// every asset cross-origin. Without CORS:
	//   • module scripts (`<script type="module">`) load (200 OK) but the
	//     browser REFUSES to execute them → React never mounts, buttons inert.
	//   • HMR websocket + RSC fetch get blocked too.
	// `headers()` is ignored by `output: "export"` in production build, but
	// IS honoured by `next dev`, which is exactly what we need.
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{ key: "Access-Control-Allow-Origin", value: "*" },
					{ key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
					{ key: "Access-Control-Allow-Headers", value: "*" },
				],
			},
		];
	},
};

export default nextConfig;
