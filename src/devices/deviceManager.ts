import type { DeviceClient, DeviceStatePush } from "./deviceClient";
import { SerialWledClient } from "./serialClient";
import { WledClient } from "./wledClient";
import { DEFAULT_SERIAL_BAUD_RATE } from "../types";
import type { WledDeviceConfig, WledDeviceRuntimeState, WledPreset } from "../types";

// Everything that requires a fresh connection when it changes.
function connectionKey(config: WledDeviceConfig): string {
	return JSON.stringify([
		config.connectionType,
		config.host,
		config.serialPath,
		config.serialBaudRate,
		config.serialPresets,
	]);
}

export interface DeviceEntry {
	config: WledDeviceConfig;
	client: DeviceClient;
	runtime: WledDeviceRuntimeState;
}

type ChangeListener = (deviceId: string) => void;

// Single source of truth for all connected WLED devices — one WledClient + last known
// state per device, shared by sidebar, ribbon, statusbar, and commands.
export class DeviceManager {
	private entries = new Map<string, DeviceEntry>();
	private listeners = new Set<ChangeListener>();

	constructor(
		private colorWriteDebounceMs: () => number,
		private serialEnabled: () => boolean
	) {}

	onChange(cb: ChangeListener): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	private notify(deviceId: string): void {
		for (const cb of this.listeners) cb(deviceId);
	}

	getEntries(): DeviceEntry[] {
		return [...this.entries.values()];
	}

	getEntry(id: string): DeviceEntry | undefined {
		return this.entries.get(id);
	}

	// USB devices are only connected while the experimental serial option is on.
	isActive(config: WledDeviceConfig): boolean {
		return config.connectionType !== "usb" || this.serialEnabled();
	}

	syncDevices(allConfigs: WledDeviceConfig[]): void {
		const configs = allConfigs.filter((c) => this.isActive(c));
		const configIds = new Set(configs.map((c) => c.id));

		for (const id of [...this.entries.keys()]) {
			if (!configIds.has(id)) this.removeDevice(id);
		}

		for (const config of configs) {
			const existing = this.entries.get(config.id);
			if (!existing) {
				this.addDevice(config);
			} else if (connectionKey(existing.config) !== connectionKey(config)) {
				// Connection target changed: reconnect fully instead of mutating the client.
				this.removeDevice(config.id);
				this.addDevice(config);
			} else {
				existing.config = config;
			}
		}
	}

	private createClient(config: WledDeviceConfig): DeviceClient {
		if (config.connectionType === "usb") {
			return new SerialWledClient({
				path: config.serialPath ?? "",
				baudRate: config.serialBaudRate ?? DEFAULT_SERIAL_BAUD_RATE,
				presets: config.serialPresets ?? [],
				host: config.host,
				colorWriteDebounceMs: this.colorWriteDebounceMs(),
			});
		}
		return new WledClient(config.host, this.colorWriteDebounceMs());
	}

	addDevice(config: WledDeviceConfig): void {
		if (this.entries.has(config.id)) return;
		const client = this.createClient(config);
		const runtime: WledDeviceRuntimeState = { status: "connecting", presets: [] };
		const entry: DeviceEntry = { config, client, runtime };
		this.entries.set(config.id, entry);

		client.on("status", ({ status, error }) => {
			runtime.status = status;
			runtime.lastError = error;
			this.notify(config.id);
		});
		client.on("state", (data: DeviceStatePush) => {
			runtime.state = data.state;
			if (data.info) runtime.info = data.info;
			this.notify(config.id);
		});
		client.on("presets", (presets: WledPreset[]) => {
			runtime.presets = presets;
			this.notify(config.id);
		});

		void client.connect();
	}

	removeDevice(id: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		entry.client.disconnect();
		this.entries.delete(id);
		this.notify(id);
	}

	async toggleDevice(id: string): Promise<void> {
		const entry = this.entries.get(id);
		if (!entry?.runtime.state) return;
		await entry.client.setPower(!entry.runtime.state.on);
	}

	destroy(): void {
		for (const entry of this.entries.values()) entry.client.disconnect();
		this.entries.clear();
		this.listeners.clear();
	}
}
