"use client";

import { useEffect, useState } from "react";

/**
 * Returns the number of pixels currently obscured at the *bottom* of the
 * viewport by the soft keyboard (Android) or any other overlay (iOS Safari
 * accessory bar). Returns 0 on desktop / when keyboard is closed.
 *
 * Uses the `visualViewport` API (supported in Android WebView 60+, iOS Safari
 * 13+). Falls back to 0 if unavailable. Reactive: updates on resize / scroll.
 *
 * Apply as `paddingBottom: keyboardInset` on a `position: sticky; bottom: 0`
 * input row so the input slides above the keyboard without manual scroll.
 */
export function useKeyboardInset(): number {
	const [inset, setInset] = useState(0);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const vv = window.visualViewport;
		if (!vv) return;

		const update = () => {
			// layout viewport height - (visual viewport height + how far we've
			// scrolled past the top) === how many px the keyboard is covering.
			const bottomGap = window.innerHeight - (vv.height + vv.offsetTop);
			setInset(Math.max(0, Math.round(bottomGap)));
		};

		update();
		vv.addEventListener("resize", update);
		vv.addEventListener("scroll", update);
		return () => {
			vv.removeEventListener("resize", update);
			vv.removeEventListener("scroll", update);
		};
	}, []);

	return inset;
}
