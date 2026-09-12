import { App, PluginSettingTab, Setting } from "obsidian";
import type WledControlPlugin from "../main";
import { renderDeviceManagementPanel, type DeviceManagementPanelHandle } from "./ui/deviceManagementPanel";
import { withScrollPreserved } from "./ui/scrollPreserve";

export class WledSettingTab extends PluginSettingTab {
	private managementPanel: DeviceManagementPanelHandle | null = null;

	constructor(
		app: App,
		private plugin: WledControlPlugin
	) {
		super(app, plugin);
	}

	display(): void {
		withScrollPreserved(this.containerEl, () => this.buildUi());
	}

	private buildUi(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Auto-discovery")
			.setDesc(
				"Scans your local subnet over HTTP (reliable) plus an mDNS attempt (_wled._tcp — " +
					"currently ineffective on macOS since Obsidian.app declares no local network " +
					"entitlement; may work on Windows/Linux). Manual IP entry is always available."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.mdnsDiscoveryEnabled).onChange(async (value) => {
					this.plugin.settings.mdnsDiscoveryEnabled = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		new Setting(containerEl)
			.setName("Color write delay")
			.setDesc(
				"Delay in ms before a color change (e.g. dragging the color wheel) is sent to the " +
					"controller. Higher = less network load, laggier live preview."
			)
			.addSlider((slider) =>
				slider
					.setLimits(50, 500, 25)
					.setValue(this.plugin.settings.colorWriteDebounceMs)
					.onChange(async (value) => {
						this.plugin.settings.colorWriteDebounceMs = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Devices").setHeading();
		this.managementPanel = renderDeviceManagementPanel(containerEl.createDiv(), this.plugin);
	}

	hide(): void {
		this.managementPanel?.destroy();
		this.managementPanel = null;
	}
}
