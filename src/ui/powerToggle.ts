import { setIcon, setTooltip } from "obsidian";

export interface PowerToggleHandle {
	el: HTMLElement;
	update: (on: boolean) => void;
	setBusy: (busy: boolean) => void;
}

export function createPowerToggle(parent: HTMLElement, onClick: () => void): PowerToggleHandle {
	const el = parent.createEl("button", { cls: "wled-power-toggle clickable-icon" });
	setIcon(el, "power");
	el.addEventListener("click", () => {
		if (el.hasAttribute("disabled")) return;
		onClick();
	});

	function update(on: boolean): void {
		el.toggleClass("is-on", on);
		setTooltip(el, on ? "Turn off" : "Turn on");
	}

	function setBusy(busy: boolean): void {
		el.toggleAttribute("disabled", busy);
		el.toggleClass("is-busy", busy);
	}

	return { el, update, setBusy };
}
