import { setIcon } from "obsidian";
import type { DeviceEntry } from "../devices/deviceManager";
import type { WledSegment } from "../types";
import { createStatusDot, type StatusDotHandle } from "./statusDot";
import { createPowerToggle, type PowerToggleHandle } from "./powerToggle";
import { createBrightnessSlider, type BrightnessSliderHandle } from "./brightnessSlider";
import { createColorWheel, type ColorWheelHandle } from "./colorWheel";
import { createSegmentRow, type SegmentRowHandle } from "./segmentRow";
import { createPresetTile } from "./presetTile";
import { rgbToCss } from "./color";

type Tab = "colors" | "segments" | "presets";

export interface DeviceCardCallbacks {
	onOpenExternal: (host: string) => void;
	onOpenDashboardTab: (host: string, name: string) => void;
}

// Orchestrates all sub-components for one device. Sub-widgets keep persistent handles
// (not rebuilt on every WebSocket push) so an in-progress drag on the color wheel survives
// incoming updates.
export class DeviceCard {
	el: HTMLElement;
	private headerEl: HTMLElement;
	private quickRowEl!: HTMLElement;
	private bodyEl: HTMLElement;
	private tabBarEl: HTMLElement;
	private tabContentEls: Record<Tab, HTMLElement>;
	private activeTab: Tab = "colors";
	private expanded = false;

	private statusDot!: StatusDotHandle;
	private powerToggle!: PowerToggleHandle;
	private colorPreview!: HTMLElement;
	private nameEl!: HTMLElement;
	private colorWheel!: ColorWheelHandle;
	private brightnessSlider!: BrightnessSliderHandle;
	private segmentRows = new Map<number, SegmentRowHandle>();
	private lastPresetIds: string | null = null;

	constructor(
		parent: HTMLElement,
		private getEntry: () => DeviceEntry | undefined,
		private callbacks: DeviceCardCallbacks
	) {
		this.el = parent.createDiv({ cls: "wled-device-card" });

		this.headerEl = this.el.createDiv({ cls: "wled-device-card-header" });
		this.buildHeader();

		this.quickRowEl = this.el.createDiv({ cls: "wled-device-card-quickrow" });
		this.brightnessSlider = createBrightnessSlider(this.quickRowEl, (bri) => {
			const entry = this.getEntry();
			void entry?.client.setBrightness(bri);
		});

		this.bodyEl = this.el.createDiv({ cls: "wled-device-card-body" });
		this.bodyEl.hidden = true;

		this.tabBarEl = this.bodyEl.createDiv({ cls: "wled-tab-bar" });
		const tabsWrap = this.bodyEl.createDiv({ cls: "wled-tab-content-wrap" });
		this.tabContentEls = {
			colors: tabsWrap.createDiv({ cls: "wled-tab-content" }),
			segments: tabsWrap.createDiv({ cls: "wled-tab-content" }),
			presets: tabsWrap.createDiv({ cls: "wled-tab-content" }),
		};
		this.buildTabBar();
		this.buildColorsTab();
		this.setActiveTab("colors");

		this.refresh();
	}

	private buildHeader(): void {
		const clickArea = this.headerEl.createDiv({ cls: "wled-device-card-clickarea" });
		this.statusDot = createStatusDot(clickArea);
		this.colorPreview = clickArea.createSpan({ cls: "wled-color-preview" });
		this.nameEl = clickArea.createSpan({
			cls: "wled-device-name",
			text: this.getEntry()?.config.name ?? "",
		});
		clickArea.addEventListener("click", () => this.toggleExpanded());

		const actions = this.headerEl.createDiv({ cls: "wled-device-card-actions" });
		// Hidden first at narrow container widths (see .wled-secondary-action in styles.css) —
		// toggle/name/color/brightness stay, these two go first.
		const externalBtn = actions.createEl("button", { cls: "clickable-icon wled-secondary-action" });
		setIcon(externalBtn, "external-link");
		externalBtn.setAttribute("aria-label", "Open in browser");
		externalBtn.addEventListener("click", (ev) => {
			ev.stopPropagation();
			const entry = this.getEntry();
			if (entry) this.callbacks.onOpenExternal(entry.config.host);
		});

		const dashboardBtn = actions.createEl("button", { cls: "clickable-icon wled-secondary-action" });
		setIcon(dashboardBtn, "layout-panel-left");
		dashboardBtn.setAttribute("aria-label", "Open dashboard in tab");
		dashboardBtn.addEventListener("click", (ev) => {
			ev.stopPropagation();
			const entry = this.getEntry();
			if (entry) this.callbacks.onOpenDashboardTab(entry.config.host, entry.config.name);
		});

		this.powerToggle = createPowerToggle(actions, () => {
			const entry = this.getEntry();
			if (!entry?.runtime.state) return;
			this.powerToggle.setBusy(true);
			entry.client
				.setPower(!entry.runtime.state.on)
				.catch(() => undefined)
				.finally(() => this.powerToggle.setBusy(false));
		});
	}

	private buildTabBar(): void {
		const tabs: { id: Tab; label: string }[] = [
			{ id: "colors", label: "Color" },
			{ id: "segments", label: "Segments" },
			{ id: "presets", label: "Presets" },
		];
		for (const tab of tabs) {
			const btn = this.tabBarEl.createEl("button", { cls: "wled-tab-button", text: tab.label });
			btn.addEventListener("click", () => this.setActiveTab(tab.id));
			btn.dataset.tab = tab.id;
		}
	}

	private setActiveTab(tab: Tab): void {
		this.activeTab = tab;
		for (const [id, el] of Object.entries(this.tabContentEls)) {
			el.hidden = id !== tab;
		}
		for (const btn of Array.from(this.tabBarEl.children) as HTMLElement[]) {
			btn.toggleClass("is-active", btn.dataset.tab === tab);
		}
	}

	private toggleExpanded(): void {
		this.expanded = !this.expanded;
		this.bodyEl.hidden = !this.expanded;
	}

	private buildColorsTab(): void {
		const container = this.tabContentEls.colors;
		this.colorWheel = createColorWheel(container, (rgb) => this.applyColor(rgb));
	}

	private applyColor(rgb: [number, number, number]): void {
		const entry = this.getEntry();
		if (!entry?.runtime.state) return;
		const segments = entry.runtime.state.seg;
		const selected = segments.filter((s) => s.sel);
		const targets = selected.length > 0 ? selected : segments.slice(0, 1);
		for (const seg of targets) {
			entry.client.setSegmentColorDebounced(seg.id, rgb);
		}
		this.colorPreview.style.backgroundColor = rgbToCss(rgb);
	}

	private renderSegmentsTab(segments: WledSegment[]): void {
		const container = this.tabContentEls.segments;
		const entry = this.getEntry();
		if (!entry) return;
		const currentIds = new Set(segments.map((s) => s.id));
		for (const [id, handle] of this.segmentRows) {
			if (!currentIds.has(id)) {
				handle.el.remove();
				this.segmentRows.delete(id);
			}
		}
		for (const seg of segments) {
			let handle = this.segmentRows.get(seg.id);
			if (!handle) {
				handle = createSegmentRow(
					container,
					seg,
					(selected) => void entry.client.setState({ seg: [{ id: seg.id, sel: selected }] }),
					(on) => void entry.client.setSegmentOn(seg.id, on)
				);
				this.segmentRows.set(seg.id, handle);
			} else {
				handle.update(seg);
			}
		}
	}

	private renderPresetsTab(): void {
		const entry = this.getEntry();
		if (!entry) return;
		const container = this.tabContentEls.presets;
		const ids = entry.runtime.presets.map((p) => p.id).join(",");
		const activePreset = entry.runtime.state?.ps;

		if (ids !== this.lastPresetIds) {
			this.lastPresetIds = ids;
			container.empty();
			if (entry.runtime.presets.length === 0) {
				container.createEl("p", {
					text: "No presets saved on this device.",
					cls: "setting-item-description",
				});
				return;
			}
			for (const preset of entry.runtime.presets) {
				createPresetTile(container, preset, preset.id === activePreset, () => {
					void entry.client.setPreset(preset.id);
				});
			}
		} else {
			const tiles = container.querySelectorAll<HTMLElement>(".wled-preset-tile");
			entry.runtime.presets.forEach((preset, i) => {
				tiles[i]?.toggleClass("is-active", preset.id === activePreset);
			});
		}
	}

	// Called by the owning view on every relevant DeviceManager change.
	refresh(): void {
		const entry = this.getEntry();
		if (!entry) return;

		this.nameEl.setText(entry.config.name);
		this.statusDot.update(entry.runtime.status, entry.runtime.lastError);
		this.el.toggleClass("is-offline", entry.runtime.status === "offline" || entry.runtime.status === "error");

		const state = entry.runtime.state;
		if (state) {
			this.powerToggle.update(state.on);
			this.brightnessSlider.update(state.bri);
			this.renderSegmentsTab(state.seg);
			const mainColor = state.seg[0]?.col?.[0];
			if (mainColor && mainColor.length >= 3) {
				const rgb: [number, number, number] = [mainColor[0], mainColor[1], mainColor[2]];
				this.colorWheel.update(rgb);
				this.colorPreview.style.backgroundColor = rgbToCss(rgb);
			}
		}
		this.renderPresetsTab();
	}

	destroy(): void {
		this.colorWheel.destroy();
		this.el.remove();
	}
}
