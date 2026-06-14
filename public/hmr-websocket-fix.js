// HMR WebSocket fix for Tauri Android dev mode.
//
// Problem: Next.js App Router's getAssetPrefix() returns "" because all
// chunk scripts are at /_next/ root path -> getSocketUrl("") falls back
// to window.location -> "ws://tauri.localhost" -> Tauri's Android proxy
// doesn't forward WebSocket upgrades -> ERR_CONNECTION_REFUSED.
//
// Fix: Intercept WebSocket connections to "tauri.localhost" and redirect
// them to the actual dev server host (extracted from any chunk <script>).
// This runs synchronously during HTML parse, before Next.js bootstraps.
(() => {
	var W = window.WebSocket,
		H = window.location.hostname,
		s,
		i,
		src,
		u,
		th;

	if (H !== "tauri.localhost") return;

	s = document.querySelectorAll("script[src*='_next']");
	for (i = 0; i < s.length; i++) {
		src = s[i].src;
		if (src && src.indexOf(H) === -1) {
			try {
				u = new URL(src);
				th = u.host;
				window.WebSocket = (a, b) => {
					if (typeof a === "string") {
						a = a.replace(H, th);
					}
					return new W(a, b);
				};
				window.WebSocket.prototype = W.prototype;
				Object.keys(W).forEach((k) => {
					window.WebSocket[k] = W[k];
				});
			} catch (_e) {
				/* ignore */
			}
			break;
		}
	}
})();
