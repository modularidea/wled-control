import { ItemView, WorkspaceLeaf } from "obsidian";
import type WledControlPlugin from "../../main";
import { DeviceCard } from "../ui/deviceCard";

export const VIEW_TYPE_SIDEBAR = "wled-control-sidebar";

// Live control only — device management (add/remove/rename, ribbon/statusbar toggles)
// lives exclusively in the settings tab.
export class SidebarView extends ItemView {
	private cards = new Map<string, DeviceCard>();
	private unsubscribe: (() => void) | null = null;
	private listEl!: HTMLElement;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: WledControlPlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_SIDEBAR;
	}

	getDisplayText(): string {
		return "WLED Control";
	}

	getIcon(): string {
		return "lightbulb";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("wled-sidebar-view");

		this.addAction("settings", "Manage devices (settings)", () => this.plugin.openSettings());
		this.listEl = container.createDiv();

		this.rebuildList();
		this.unsubscribe = this.plugin.deviceManager.onChange((id) => this.onDeviceChange(id));
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		for (const card of this.cards.values()) card.destroy();
		this.cards.clear();
	}

	rebuildList(): void {
		for (const card of this.cards.values()) card.destroy();
		this.cards.clear();
		this.listEl.empty();

		if (this.plugin.settings.devices.length === 0) {
			const empty = this.listEl.createDiv({ cls: "wled-empty-state" });
			empty.createEl("p", { text: "No WLED devices configured yet." });
			empty
				.createEl("button", { cls: "mod-cta", text: "Add device" })
				.addEventListener("click", () => this.plugin.openSettings());
			return;
		}

		for (const device of this.plugin.settings.devices) {
			this.addCard(device.id);
		}
	}

	private addCard(id: string): void {
		const card = new DeviceCard(this.listEl, () => this.plugin.deviceManager.getEntry(id), {
			onOpenExternal: (host) => this.plugin.openExternal(host),
			onOpenDashboardTab: (host, name) => void this.plugin.openDashboardTab(host, name),
		});
		this.cards.set(id, card);
	}

	private onDeviceChange(id: string): void {
		const entry = this.plugin.deviceManager.getEntry(id);
		const card = this.cards.get(id);

		if (!entry) {
			card?.destroy();
			this.cards.delete(id);
			if (this.cards.size === 0) this.rebuildList();
			return;
		}

		if (!card) {
			// Device was added elsewhere (settings tab) while this view is open.
			this.rebuildList();
			return;
		}

		card.refresh();
	}
}
