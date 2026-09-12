import type { WledSegment } from "../types";

export interface SegmentRowHandle {
	el: HTMLElement;
	update: (seg: WledSegment) => void;
}

// First checkbox controls seg.sel (which segments color changes apply to).
export function createSegmentRow(
	parent: HTMLElement,
	seg: WledSegment,
	onToggleSelect: (selected: boolean) => void,
	onTogglePower: (on: boolean) => void
): SegmentRowHandle {
	const row = parent.createDiv({ cls: "wled-segment-row" });

	const checkbox = row.createEl("input", { type: "checkbox" });
	checkbox.checked = seg.sel;
	checkbox.addEventListener("change", () => onToggleSelect(checkbox.checked));

	const label = row.createSpan({ cls: "wled-segment-label" });
	label.setText(`Segment ${seg.id} (${seg.start}–${seg.stop})`);

	const power = row.createEl("input", { type: "checkbox", cls: "wled-segment-power" });
	power.checked = seg.on;
	power.addEventListener("change", () => onTogglePower(power.checked));

	function update(next: WledSegment): void {
		checkbox.checked = next.sel;
		power.checked = next.on;
		label.setText(`Segment ${next.id} (${next.start}–${next.stop})`);
	}

	return { el: row, update };
}
