export interface BrightnessSliderHandle {
	el: HTMLElement;
	update: (bri: number) => void;
}

export function createBrightnessSlider(
	parent: HTMLElement,
	onChange: (bri: number) => void
): BrightnessSliderHandle {
	const wrap = parent.createDiv({ cls: "wled-brightness-slider" });
	const input = wrap.createEl("input", { type: "range" });
	input.min = "1";
	input.max = "255";
	input.step = "1";
	const label = wrap.createSpan({ cls: "wled-brightness-label" });

	function renderLabel(value: number): void {
		label.setText(`${Math.round((value / 255) * 100)}%`);
	}

	input.addEventListener("input", () => renderLabel(Number(input.value)));
	// Write on release (change), not on every input event while dragging.
	input.addEventListener("change", () => onChange(Number(input.value)));

	function update(bri: number): void {
		if (document.activeElement === input) return; // don't override an active drag
		input.value = String(bri);
		renderLabel(bri);
	}

	renderLabel(Number(input.value));
	return { el: wrap, update };
}
