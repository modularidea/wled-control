import { WledClient, type WledStatePush } from "./wledClient";
import type { WledDeviceConfig, WledDeviceRuntimeState, WledPreset } from "../types";

export interface DeviceEntry {
	config: WledDeviceConfig;
	client: WledClient;
	runtime: WledDeviceRuntimeState;
}

type ChangeListener = (deviceId: string) => void;

// Single source of truth for all connected WLED devices — one WledClient + last known
// state per device, shared by sidebar, ribbon, statusbar, and commands.
export class DeviceManager {
	private entries = new Map<string, DeviceEntry>();
	private listeners = new Set<ChangeListener>();

	constructor(private colorWriteDebounceMs: () => number) {}

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

	syncDevices(configs: WledDeviceConfig[]): void {
		const configIds = new Set(configs.map((c) => c.id));

		for (const id of [...this.entries.keys()]) {
			if (!configIds.has(id)) this.removeDevice(id);
		}

		for (const config of configs) {
			const existing = this.entries.get(config.id);
			if (!existing) {
				this.addDevice(config);
			} else if (existing.config.host !== config.host) {
				// Host changed: reconnect fully instead of mutating the client's target.
				this.removeDevice(config.id);
				this.addDevice(config);
			} else {
				existing.config = config;
			}
		}
	}

	addDevice(config: WledDeviceConfig): void {
		if (this.entries.has(config.id)) return;
		const client = new WledClient(config.host, this.colorWriteDebounceMs());
		const runtime: WledDeviceRuntimeState = { status: "connecting", presets: [] };
		const entry: DeviceEntry = { config, client, runtime };
		this.entries.set(config.id, entry);

		client.on("status", ({ status, error }) => {
			runtime.status = status;
			runtime.lastError = error;
			this.notify(config.id);
		});
		client.on("state", (data: WledStatePush) => {
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
