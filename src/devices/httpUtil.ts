import { requestUrl } from "obsidian";
import type { WledInfo } from "../types";

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error("Timeout")), ms);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(err: unknown) => {
				window.clearTimeout(timer);
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		);
	});
}

// Checks whether a WLED controller responds at `host`, returns its /json/info on success.
export async function probeWledInfo(host: string, timeoutMs = 400): Promise<WledInfo | null> {
	try {
		const res = await withTimeout(
			requestUrl({ url: `http://${host}/json/info`, method: "GET", throw: false }),
			timeoutMs
		);
		if (res.status !== 200) return null;
		const info = res.json as WledInfo;
		if (typeof info?.ver !== "string" || typeof info?.leds !== "object") return null;
		return info;
	} catch {
		return null;
	}
}
