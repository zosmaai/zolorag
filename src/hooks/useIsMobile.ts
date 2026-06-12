"use client";

import { useEffect, useState } from "react";

/**
 * `true` when the runtime is a touch-first mobile form factor (Android WebView,
 * small tablet in portrait). Uses `pointer: coarse` to detect touch and a
 * width threshold to exclude touch laptops. Stays reactive on resize.
 *
 * On desktop browsers / Tauri desktop windows this is always `false`.
 */
export function useIsMobile(): boolean {
	const [isMobile, setIsMobile] = useState<boolean>(() => {
		if (typeof window === "undefined") return false;
		return window.matchMedia("(pointer: coarse) and (max-width: 900px)").matches;
	});

	useEffect(() => {
		if (typeof window === "undefined") return;
		const mql = window.matchMedia("(pointer: coarse) and (max-width: 900px)");
		const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);

	return isMobile;
}
