import type { WledPreset } from "../types";

export function createPresetTile(
	parent: HTMLElement,
	preset: WledPreset,
	active: boolean,
	onSelect: () => void
): HTMLElement {
	const tile = parent.createEl("button", { cls: "wled-preset-tile" });
	tile.toggleClass("is-active", active);
	if (preset.ql) tile.createSpan({ cls: "wled-preset-ql", text: preset.ql });
	// preset.name can be an empty string (not just undefined) on devices without a custom
	// name — always show a readable fallback label, never rely on just the ql field.
	tile.createSpan({ cls: "wled-preset-name", text: preset.name || `Preset ${preset.id}` });
	tile.addEventListener("click", onSelect);
	return tile;
}
