import type { ConnectionStatus, WledInfo, WledPreset, WledState } from "../types";

export type DeviceClientEvent = "status" | "state" | "presets";

export type Listener<T> = (payload: T) => void;

// Pushes on external state changes may carry only "state", not "info".
export interface DeviceStatePush {
	state: WledState;
	info?: WledInfo;
}

export interface DeviceClientEventPayloads {
	status: { status: ConnectionStatus; error?: string };
	state: DeviceStatePush;
	presets: WledPreset[];
}

// Transport-agnostic surface shared by the network (HTTP/WebSocket) and USB (serial) clients.
export interface DeviceClient {
	on<K extends DeviceClientEvent>(event: K, cb: Listener<DeviceClientEventPayloads[K]>): void;
	off<K extends DeviceClientEvent>(event: K, cb: Listener<DeviceClientEventPayloads[K]>): void;
	getStatus(): ConnectionStatus;
	connect(): Promise<void>;
	disconnect(): void;
	setState(body: Record<string, unknown>): Promise<void>;
	setPower(on: boolean): Promise<void>;
	setBrightness(bri: number): Promise<void>;
	setPreset(presetId: number): Promise<void>;
	setSegmentColorDebounced(segId: number, rgb: [number, number, number]): void;
	setSegmentOn(segId: number, on: boolean): Promise<void>;
	setSegmentEffect(segId: number, fx: number): Promise<void>;
}
