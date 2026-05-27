"use client";

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";

export function useTauriEvent<T>(eventName: string, callback: (payload: T) => void) {
	useEffect(() => {
		let unlisten: UnlistenFn | undefined;
		const setup = async () => {
			unlisten = await listen<T>(eventName, (event) => {
				callback(event.payload);
			});
		};
		setup();
		return () => {
			if (unlisten) unlisten();
		};
	}, [eventName, callback]);
}
