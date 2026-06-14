"use client";

import { useEffect, useState } from "react";

/**
 * `true` when the runtime is a touch-first mobile form factor (Android WebView,
 * small tablet in portrait). Uses `pointer: coarse` to detect touch and a
 * width threshold to exclude touch laptops. Stays reactive on resize.
 *
 * On desktop browsers / Tauri desktop windows this is always `false`.
 *
 * Initialised to `false` on BOTH server and client so the server-rendered
 * HTML matches the first client render (no hydration mismatch).  After mount,
 * a `useEffect` computes the real value from the media query and triggers a
 * re-render — at that point React has already hydrated, so the mismatch only
 * causes a brief visual flash before the correct layout appears.
 */
export function useIsMobile(): boolean {
	const [isMobile, setIsMobile] = useState(false);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const mql = window.matchMedia("(pointer: coarse) and (max-width: 900px)");
		const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		setIsMobile(mql.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);

	return isMobile;
}
