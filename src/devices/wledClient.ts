import { requestUrl } from "obsidian";
import { withTimeout } from "./httpUtil";
import type {
	ConnectionStatus,
	WledInfo,
	WledPreset,
	WledState,
	WledStateInfo,
} from "../types";

// requestUrl() instead of fetch() to avoid CORS issues (not subject to the browser fetch sandbox).

const HTTP_TIMEOUT_MS = 4000;
const RECONNECT_DELAY_MS = 1500;
const RECONNECT_MAX_DELAY_MS = 20000;
const RECONNECT_BACKOFF_FACTOR = 1.3;

export type WledClientEvent = "status" | "state" | "presets";

type Listener<T> = (payload: T) => void;

// WLED's /ws push on external state changes only includes "state", not "info".
export interface WledStatePush {
	state: WledState;
	info?: WledInfo;
}

export interface WledClientEventPayloads {
	status: { status: ConnectionStatus; error?: string };
	state: WledStatePush;
	presets: WledPreset[];
}

// HTTP + WebSocket client for a single WLED controller.
export class WledClient {
	private ws: WebSocket | null = null;
	private reconnectTimer: number | null = null;
	private reconnectDelay = RECONNECT_DELAY_MS;
	private colorWriteTimer: number | null = null;
	private pendingColorBody: Record<string, unknown> | null = null;
	private closedByUser = false;
	private status: ConnectionStatus = "connecting";

	private listeners: { [K in WledClientEvent]: Set<Listener<WledClientEventPayloads[K]>> } = {
		status: new Set(),
		state: new Set(),
		presets: new Set(),
	};

	constructor(
		private host: string,
		private colorWriteDebounceMs: number
	) {}

	on<K extends WledClientEvent>(event: K, cb: Listener<WledClientEventPayloads[K]>): void {
		this.listeners[event].add(cb);
	}

	off<K extends WledClientEvent>(event: K, cb: Listener<WledClientEventPayloads[K]>): void {
		this.listeners[event].delete(cb);
	}

	private emit<K extends WledClientEvent>(event: K, payload: WledClientEventPayloads[K]): void {
		for (const cb of this.listeners[event]) cb(payload);
	}

	private setStatus(status: ConnectionStatus, error?: string): void {
		this.status = status;
		this.emit("status", { status, error });
	}

	getStatus(): ConnectionStatus {
		return this.status;
	}

	private url(path: string): string {
		return `http://${this.host}${path}`;
	}

	async connect(): Promise<void> {
		this.closedByUser = false;
		this.setStatus("connecting");
		try {
			await this.fetchStateInfo();
			await this.fetchPresets();
			this.openWebSocket();
		} catch (err) {
			this.setStatus("error", err instanceof Error ? err.message : String(err));
			this.scheduleReconnect();
		}
	}

	disconnect(): void {
		this.closedByUser = true;
		if (this.reconnectTimer !== null) {
			window.clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.onclose = null;
			this.ws.close();
			this.ws = null;
		}
	}

	async fetchStateInfo(): Promise<WledStateInfo> {
		const res = await withTimeout(
			requestUrl({ url: this.url("/json/si"), method: "GET" }),
			HTTP_TIMEOUT_MS
		);
		const data = res.json as WledStateInfo;
		this.emit("state", data);
		return data;
	}

	async fetchPresets(): Promise<WledPreset[]> {
		try {
			const res = await withTimeout(
				requestUrl({ url: this.url("/presets.json"), method: "GET" }),
				HTTP_TIMEOUT_MS
			);
			const raw = res.json as Record<string, { n?: string; ql?: string }>;
			const presets: WledPreset[] = Object.entries(raw)
				.filter(([id]) => id !== "0")
				.map(([id, val]) => ({ id: Number(id), name: val.n, ql: val.ql }));
			this.emit("presets", presets);
			return presets;
		} catch {
			this.emit("presets", []);
			return [];
		}
	}

	private openWebSocket(): void {
		if (this.ws) return;
		const ws = new WebSocket(`ws://${this.host}/ws`);
		this.ws = ws;

		ws.onopen = () => {
			this.reconnectDelay = RECONNECT_DELAY_MS;
			this.setStatus("online");
		};

		ws.onmessage = (ev: MessageEvent) => {
			try {
				const data: unknown = JSON.parse(ev.data as string);
				if (data && typeof data === "object" && "state" in data) {
					this.emit("state", data as WledStatePush);
				}
			} catch {
				// ignore non-JSON messages
			}
		};

		ws.onclose = () => {
			this.ws = null;
			if (!this.closedByUser) {
				this.setStatus("reconnecting");
				this.scheduleReconnect();
			}
		};

		ws.onerror = () => {
			// suppressed, onclose handles the reconnect
		};
	}

	private scheduleReconnect(): void {
		if (this.closedByUser || this.reconnectTimer !== null) return;
		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = null;
			this.reconnectDelay = Math.min(
				this.reconnectDelay * RECONNECT_BACKOFF_FACTOR,
				RECONNECT_MAX_DELAY_MS
			);
			void this.connect();
		}, this.reconnectDelay);
	}

	async setState(body: Record<string, unknown>): Promise<void> {
		await withTimeout(
			requestUrl({
				url: this.url("/json/state"),
				method: "POST",
				contentType: "application/json",
				body: JSON.stringify(body),
			}),
			HTTP_TIMEOUT_MS
		);
	}

	setPower(on: boolean): Promise<void> {
		return this.setState({ on });
	}

	setBrightness(bri: number): Promise<void> {
		return this.setState({ bri });
	}

	setPreset(presetId: number): Promise<void> {
		return this.setState({ ps: presetId });
	}

	// Debounced to avoid flooding the ESP8266/ESP32 during color-wheel drags.
	setSegmentColorDebounced(segId: number, rgb: [number, number, number]): void {
		const seg = { id: segId, col: [rgb] };
		this.pendingColorBody = { seg: [seg] };
		if (this.colorWriteTimer !== null) window.clearTimeout(this.colorWriteTimer);
		this.colorWriteTimer = window.setTimeout(() => {
			this.colorWriteTimer = null;
			const body = this.pendingColorBody;
			this.pendingColorBody = null;
			if (body) void this.setState(body);
		}, this.colorWriteDebounceMs);
	}

	setSegmentOn(segId: number, on: boolean): Promise<void> {
		return this.setState({ seg: [{ id: segId, on }] });
	}

	setSegmentEffect(segId: number, fx: number): Promise<void> {
		return this.setState({ seg: [{ id: segId, fx }] });
	}
}
