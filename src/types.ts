// WLED JSON API types (kno.wled.ge/interfaces/json-api) plus this plugin's own data model.

export interface WledSegment {
	id: number;
	start: number;
	stop: number;
	len?: number;
	col: number[][];
	fx: number;
	sx: number;
	ix: number;
	pal: number;
	sel: boolean;
	on: boolean;
	bri?: number;
	rev?: boolean;
	mi?: boolean;
}

export interface WledState {
	on: boolean;
	bri: number;
	transition?: number;
	ps?: number;
	pl?: number;
	seg: WledSegment[];
}

export interface WledLeds {
	count: number;
	pwr: number;
	fps: number;
	maxpwr: number;
	maxseg: number;
	seglc?: number[];
	lc?: number;
}

export interface WledInfo {
	ver: string;
	vid: number;
	leds: WledLeds;
	name: string;
	udpport: number;
	live: boolean;
	fxcount: number;
	palcount: number;
	wifi?: { signal: number; rssi: number };
	arch?: string;
	ip?: string;
	mac?: string;
}

export interface WledStateInfo {
	state: WledState;
	info: WledInfo;
}

export interface WledPreset {
	id: number;
	name?: string;
	ql?: string;
}

export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "offline" | "error";

// "usb" (Phase 3) intentionally not included yet.
export type DeviceConnectionType = "network";

export interface WledDeviceConfig {
	id: string;
	name: string;
	connectionType: DeviceConnectionType;
	host: string; // IP or mDNS hostname, no protocol/port
	showInRibbon: boolean;
	showInStatusBar: boolean;
}

export interface WledDeviceRuntimeState {
	status: ConnectionStatus;
	lastError?: string;
	state?: WledState;
	info?: WledInfo;
	presets: WledPreset[];
}

export interface WledControlSettings {
	devices: WledDeviceConfig[];
	mdnsDiscoveryEnabled: boolean;
	colorWriteDebounceMs: number;
}

export const DEFAULT_SETTINGS: WledControlSettings = {
	devices: [],
	mdnsDiscoveryEnabled: true,
	colorWriteDebounceMs: 150,
};
