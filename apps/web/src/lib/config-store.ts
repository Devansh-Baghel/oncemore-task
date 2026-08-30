"use client";

import { useEffect, useState } from "react";

export type Provider = "nvidia" | "bedrock";

const STORAGE_KEY = "oncemore:provider";

export function getProvider(): Provider {
	if (typeof window === "undefined") return "nvidia";
	const raw = localStorage.getItem(STORAGE_KEY);
	if (raw === "bedrock" || raw === "nvidia") return raw;
	return "nvidia";
}

export function setProvider(provider: Provider) {
	if (typeof window === "undefined") return;
	localStorage.setItem(STORAGE_KEY, provider);
	window.dispatchEvent(
		new CustomEvent("oncemore:provider-change", { detail: provider }),
	);
}

export function useProvider(): Provider {
	const [provider, setProviderState] = useState<Provider>(() => getProvider());

	useEffect(() => {
		const handler = (e: Event) => {
			const detail = (e as CustomEvent<Provider>).detail;
			if (detail) setProviderState(detail);
			else setProviderState(getProvider());
		};
		const storageHandler = (e: StorageEvent) => {
			if (e.key === STORAGE_KEY) setProviderState(getProvider());
		};
		window.addEventListener(
			"oncemore:provider-change",
			handler as EventListener,
		);
		window.addEventListener("storage", storageHandler);
		return () => {
			window.removeEventListener(
				"oncemore:provider-change",
				handler as EventListener,
			);
			window.removeEventListener("storage", storageHandler);
		};
	}, []);

	return provider;
}
