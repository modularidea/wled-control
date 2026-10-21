import { requestUrl } from "obsidian";
import type {
	DeviceClient,
	DeviceClientEvent,
	DeviceClientEventPayloads,
	Listener,
} from "./deviceClient";
import { withTimeout } from "./httpUtil";
import { LineFramer } from "./lineFramer";
import { PendingColors, type Rgb } from "./pendingColors";
import { mergePresets, parsePresetsJson } from "./presets";
import type { SerialTransport } from "./serial";
import type { ConnectionStatus, WledInfo, WledPreset, WledState } from "../types";

// A controller may still be booting (or resetting) when the port opens. Stay on the same open
// port and keep asking instead of reopening, which could reset it again.
const FIRST_RESPONSE_TIMEOUT_MS = 30000;
const FIRST_REQUEST_RETRY_MS = 1000;
const POLL_INTERVAL_MS = 5000;
const HTTP_PRESETS_TIMEOUT_MS = 2500;
const RECONNECT_DELAY_MS = 1500;
const RECONNECT_MAX_DELAY_MS = 20000;
const RECONNECT_BACKOFF_FACTOR = 1.5;

export type SerialTransportFactory = () => Promise<SerialTransport>;

export interface SerialClientOptions {
	path: string;
	baudRate: number;
	presets: WledPreset[];
	// Optional: only used to fetch preset names over HTTP if the controller also has WiFi.
	host?: string;
	colorWriteDebounceMs: number;
	transportFactory?: SerialTransportFactory;
}

// Controls one WLED controller over USB serial: one JSON object per line, `"v":true` makes WLED
// answer every command with the full state.
export class SerialWledClient implements DeviceClient {
	private transport: SerialTransport | null = null;
	private framer = new LineFramer();
	private writeChain: Promise<void> = Promise.resolve();
	private pollTimer: number | null = null;
	private reconnectTimer: number | null = null;
	private reconnectDelay = RECONNECT_DELAY_MS;
	private colorWriteTimer: number | null = null;
	private pendingColors = new PendingColors();
	private closedByUser = false;
	private status: ConnectionStatus = "connecting";
	private httpPresets: WledPreset[] = [];
	private firstState: { resolve: () => void } | null = null;

	private listeners: { [K in DeviceClientEvent]: Set<Listener<DeviceClientEventPayloads[K]>> } = {
		status: new Set(),
		state: new Set(),
		presets: new Set(),
	};

	constructor(private options: SerialClientOptions) {}

	on<K extends DeviceClientEvent>(event: K, cb: Listener<DeviceClientEventPayloads[K]>): void {
		this.listeners[event].add(cb);
	}

	off<K extends DeviceClientEvent>(event: K, cb: Listener<DeviceClientEventPayloads[K]>): void {
		this.listeners[event].delete(cb);
	}

	private emit<K extends DeviceClientEvent>(event: K, payload: DeviceClientEventPayloads[K]): void {
		for (const cb of this.listeners[event]) cb(payload);
	}

	private setStatus(status: ConnectionStatus, error?: string): void {
		this.status = status;
		this.emit("status", { status, error });
	}

	getStatus(): ConnectionStatus {
		return this.status;
	}

	async connect(): Promise<void> {
		this.closedByUser = false;
		this.setStatus("connecting");
		try {
			const transport = await this.createTransport();
			this.framer.reset();
			transport.onData((chunk) => this.handleData(chunk));
			transport.onClose((err) => this.handleTransportLost(transport, err));
			await transport.open();
			this.transport = transport;

			const firstState = this.waitForFirstState();
			const retry = window.setInterval(() => {
				void this.send({}).catch(() => undefined);
			}, FIRST_REQUEST_RETRY_MS);
			try {
				await this.send({});
				await firstState.promise;
			} catch (err) {
				firstState.cancel();
				throw err;
			} finally {
				window.clearInterval(retry);
			}
			if (this.closedByUser) return;

			this.reconnectDelay = RECONNECT_DELAY_MS;
			this.emit("presets", mergePresets(this.options.presets, this.httpPresets));
			this.setStatus("online");
			this.startPolling();
			void this.fetchHttpPresets();
		} catch (err) {
			this.teardownTransport();
			if (this.closedByUser) return;
			this.setStatus("error", err instanceof Error ? err.message : String(err));
			this.scheduleReconnect();
		}
	}

	disconnect(): void {
		this.closedByUser = true;
		this.firstState = null;
		if (this.reconnectTimer !== null) {
			window.clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.colorWriteTimer !== null) {
			window.clearTimeout(this.colorWriteTimer);
			this.colorWriteTimer = null;
		}
		this.teardownTransport();
	}

	private async createTransport(): Promise<SerialTransport> {
		if (this.options.transportFactory) return this.options.transportFactory();
		try {
			const { ProcessSerialTransport } = await import("./serial");
			return new ProcessSerialTransport(this.options.path, this.options.baudRate);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			throw new Error(`Serial support is unavailable: ${reason}`);
		}
	}

	private waitForFirstState(): { promise: Promise<void>; cancel: () => void } {
		let cancel = (): void => undefined;
		const promise = new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				this.firstState = null;
				reject(new Error("No answer from the controller — is it running WLED?"));
			}, FIRST_RESPONSE_TIMEOUT_MS);
			this.firstState = {
				resolve: () => {
					window.clearTimeout(timer);
					this.firstState = null;
					resolve();
				},
			};
			cancel = () => {
				window.clearTimeout(timer);
				this.firstState = null;
				resolve();
			};
		});
		return { promise, cancel };
	}

	private handleData(chunk: string): void {
		for (const message of this.framer.push(chunk)) {
			const state = message.state;
			if (!state || typeof state !== "object") continue;
			const info = message.info && typeof message.info === "object" ? (message.info as WledInfo) : undefined;
			this.emit("state", { state: state as WledState, info });
			this.firstState?.resolve();
		}
	}

	private handleTransportLost(transport: SerialTransport, err?: Error): void {
		if (transport !== this.transport || this.closedByUser) return;
		this.teardownTransport();
		this.setStatus("reconnecting", err?.message ?? "Connection to the controller was lost.");
		this.scheduleReconnect();
	}

	private teardownTransport(): void {
		if (this.pollTimer !== null) {
			window.clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		const transport = this.transport;
		this.transport = null;
		transport?.close();
	}

	// WLED doesn't push state changes made elsewhere (button, other app) over serial.
	private startPolling(): void {
		this.pollTimer = window.setInterval(() => {
			void this.send({}).catch(() => undefined);
		}, POLL_INTERVAL_MS);
	}

	private scheduleReconnect(): void {
		if (this.closedByUser || this.reconnectTimer !== null) return;
		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = null;
			this.reconnectDelay = Math.min(this.reconnectDelay * RECONNECT_BACKOFF_FACTOR, RECONNECT_MAX_DELAY_MS);
			void this.connect();
		}, this.reconnectDelay);
	}

	private async fetchHttpPresets(): Promise<void> {
		const host = this.options.host?.trim();
		if (!host) return;
		try {
			const res = await withTimeout(
				requestUrl({ url: `http://${host}/presets.json`, method: "GET" }),
				HTTP_PRESETS_TIMEOUT_MS
			);
			this.httpPresets = parsePresetsJson(res.json);
			if (!this.closedByUser) this.emit("presets", mergePresets(this.options.presets, this.httpPresets));
		} catch {
			// controller has no WiFi or is unreachable — manual presets still apply
		}
	}

	// Writes are chained so lines reach the port in call order.
	private send(body: Record<string, unknown>): Promise<void> {
		const transport = this.transport;
		if (!transport) return Promise.reject(new Error("Not connected."));
		const line = `${JSON.stringify({ ...body, v: true })}\n`;
		const result = this.writeChain.then(() => transport.write(line));
		this.writeChain = result.catch(() => undefined);
		return result;
	}

	setState(body: Record<string, unknown>): Promise<void> {
		return this.send(body);
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

	// Debounced like the network client: the ESP is slow, and so is a 115200 baud line.
	setSegmentColorDebounced(segId: number, rgb: Rgb): void {
		this.pendingColors.set(segId, rgb);
		if (this.colorWriteTimer !== null) window.clearTimeout(this.colorWriteTimer);
		this.colorWriteTimer = window.setTimeout(() => {
			this.colorWriteTimer = null;
			const body = this.pendingColors.take();
			if (body) void this.setState(body).catch(() => undefined);
		}, this.options.colorWriteDebounceMs);
	}

	setSegmentOn(segId: number, on: boolean): Promise<void> {
		return this.setState({ seg: [{ id: segId, on }] });
	}

	setSegmentEffect(segId: number, fx: number): Promise<void> {
		return this.setState({ seg: [{ id: segId, fx }] });
	}
}

// Opens the port once to read the controller's own name (used as default device name).
export function probeSerialInfo(path: string, baudRate: number, timeoutMs = 8000): Promise<WledInfo | null> {
	return new Promise((resolve) => {
		const client = new SerialWledClient({ path, baudRate, presets: [], colorWriteDebounceMs: 0 });
		const finish = (info: WledInfo | null): void => {
			window.clearTimeout(timer);
			client.disconnect();
			resolve(info);
		};
		const timer = window.setTimeout(() => finish(null), timeoutMs);
		client.on("state", (push) => {
			if (push.info) finish(push.info);
		});
		void client.connect();
	});
}
