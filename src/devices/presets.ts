import type { WledPreset } from "../types";

// Parses WLED's /presets.json (also the file downloadable from the WLED UI).
export function parsePresetsJson(raw: unknown): WledPreset[] {
	if (!raw || typeof raw !== "object") return [];
	const presets: WledPreset[] = [];
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const id = Number(key);
		if (!Number.isInteger(id) || id <= 0 || !value || typeof value !== "object") continue;
		const { n, ql } = value as { n?: unknown; ql?: unknown };
		presets.push({
			id,
			name: typeof n === "string" ? n : undefined,
			ql: typeof ql === "string" ? ql : undefined,
		});
	}
	return presets.sort((a, b) => a.id - b.id);
}

// Entries in `primary` win over `fallback` for the same id; names missing in `primary` are filled.
export function mergePresets(primary: WledPreset[], fallback: WledPreset[]): WledPreset[] {
	const byId = new Map<number, WledPreset>();
	for (const preset of fallback) byId.set(preset.id, preset);
	for (const preset of primary) {
		const other = byId.get(preset.id);
		byId.set(preset.id, {
			id: preset.id,
			name: preset.name || other?.name,
			ql: preset.ql || other?.ql,
		});
	}
	return [...byId.values()].sort((a, b) => a.id - b.id);
}

// One preset per line: "<id> <name>".
export function formatPresetLines(presets: WledPreset[]): string {
	return presets.map((p) => `${p.id} ${p.name ?? ""}`.trimEnd()).join("\n");
}

// Quick labels are not editable as text, so they carry over from `previous` by id.
export function parsePresetLines(text: string, previous: WledPreset[] = []): WledPreset[] {
	const quickLabels = new Map(previous.map((p) => [p.id, p.ql]));
	const byId = new Map<number, WledPreset>();
	for (const line of text.split("\n")) {
		const match = /^\s*(\d+)\s*[:|-]?\s*(.*?)\s*$/.exec(line);
		if (!match) continue;
		const id = Number(match[1]);
		if (id <= 0) continue;
		byId.set(id, { id, name: match[2] || undefined, ql: quickLabels.get(id) });
	}
	return [...byId.values()].sort((a, b) => a.id - b.id);
}
