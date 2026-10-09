import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type WledControlPlugin from "../main";
import { renderDeviceManagementPanel, type DeviceManagementPanelHandle } from "./ui/deviceManagementPanel";
import { withScrollPreserved } from "./ui/scrollPreserve";

const AUTO_DISCOVERY_DESC =
	"Scans your local subnet over HTTP (reliable) plus an mDNS attempt (_wled._tcp — " +
	"currently ineffective on macOS since Obsidian.app declares no local network " +
	"entitlement; may work on Windows/Linux). Manual IP entry is always available.";

const COLOR_DELAY_DESC =
	"Delay in ms before a color change (e.g. dragging the color wheel) is sent to the " +
	"controller. Higher = less network load, laggier live preview.";

export class WledSettingTab extends PluginSettingTab {
	private managementPanel: DeviceManagementPanelHandle | null = null;

	constructor(
		app: App,
		private plugin: WledControlPlugin
	) {
		super(app, plugin);
	}

	// Declarative settings (Obsidian >= 1.13). Obsidian skips display() when this returns items.
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Auto-discovery",
				desc: AUTO_DISCOVERY_DESC,
				control: { type: "toggle", key: "mdnsDiscoveryEnabled" },
			},
			{
				name: "Color write delay",
				desc: COLOR_DELAY_DESC,
				control: { type: "slider", key: "colorWriteDebounceMs", min: 50, max: 500, step: 25 },
			},
			{
				type: "group",
				heading: "Devices",
				items: [
					{
						name: "Devices",
						render: (setting) => {
							setting.settingEl.empty();
							const panel = renderDeviceManagementPanel(setting.settingEl.createDiv(), this.plugin);
							return () => panel.destroy();
						},
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
	}

	// Fallback for Obsidian < 1.13, which does not know getSettingDefinitions().
	display(): void {
		withScrollPreserved(this.containerEl, () => this.buildUi());
	}

	private buildUi(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Auto-discovery")
			.setDesc(AUTO_DISCOVERY_DESC)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.mdnsDiscoveryEnabled).onChange(async (value) => {
					this.plugin.settings.mdnsDiscoveryEnabled = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		new Setting(containerEl)
			.setName("Color write delay")
			.setDesc(COLOR_DELAY_DESC)
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
