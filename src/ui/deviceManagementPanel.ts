import { Setting } from "obsidian";
import type WledControlPlugin from "../../main";
import { createAddDevicePanel, type AddDevicePanelHandle } from "./addDevicePanel";
import { withScrollPreserved } from "./scrollPreserve";
import type { WledDeviceConfig } from "../types";

export interface DeviceManagementPanelHandle {
	destroy: () => void;
}

// Device list (edit name/IP, ribbon/statusbar visibility, remove) + AddDevicePanel.
// Lives only in the settings tab.
export function renderDeviceManagementPanel(
	container: HTMLElement,
	plugin: WledControlPlugin
): DeviceManagementPanelHandle {
	let addPanel: AddDevicePanelHandle | null = null;
	let editingId: string | null = null;

	function render(): void {
		withScrollPreserved(container, () => {
			container.empty();
			addPanel?.destroy();
			addPanel = null;

			if (plugin.settings.devices.length === 0) {
				container.createEl("p", {
					text: "No devices configured yet.",
					cls: "setting-item-description",
				});
			}

			for (const device of plugin.settings.devices) {
				renderDeviceGroup(device);
			}

			container.createEl("h4", { text: "Add device" });
			addPanel = createAddDevicePanel(container, {
				existingHosts: () => plugin.settings.devices.map((d) => d.host),
				mdnsEnabled: plugin.settings.mdnsDiscoveryEnabled,
				onAdd: async (name, host) => {
					await plugin.addDevice(name, host);
					render();
				},
			});
		});
	}

	function renderDeviceGroup(device: WledDeviceConfig): void {
		const group = container.createDiv({ cls: "wled-settings-device-group" });

		if (editingId === device.id) {
			renderEditForm(group, device);
			return;
		}

		new Setting(group)
			.setName(device.name)
			.setDesc(device.host)
			.addExtraButton((btn) =>
				btn
					.setIcon("pencil")
					.setTooltip("Edit name/IP")
					.onClick(() => {
						editingId = device.id;
						render();
					})
			)
			.addExtraButton((btn) =>
				btn
					.setIcon("trash-2")
					.setTooltip("Remove device")
					.onClick(async () => {
						await plugin.removeDevice(device.id);
						render();
					})
			);

		new Setting(group)
			.setName("Show in ribbon")
			.setDesc("Quick-access icon in the left ribbon — colored while the device is on.")
			.addToggle((toggle) =>
				toggle.setValue(device.showInRibbon).onChange(async (value) => {
					device.showInRibbon = value;
					await plugin.saveSettings();
					plugin.refreshQuickAccess();
				})
			);

		new Setting(group)
			.setName("Show in status bar")
			.setDesc("Clickable entry in the Obsidian status bar to toggle the device.")
			.addToggle((toggle) =>
				toggle.setValue(device.showInStatusBar).onChange(async (value) => {
					device.showInStatusBar = value;
					await plugin.saveSettings();
					plugin.refreshQuickAccess();
				})
			);
	}

	function renderEditForm(group: HTMLElement, device: WledDeviceConfig): void {
		let name = device.name;
		let host = device.host;

		new Setting(group)
			.setName("Name")
			.addText((text) => text.setValue(name).onChange((v) => (name = v)));

		new Setting(group)
			.setName("IP address or hostname")
			.addText((text) => text.setValue(host).onChange((v) => (host = v)));

		new Setting(group)
			.addButton((btn) =>
				btn
					.setButtonText("Save")
					.setCta()
					.onClick(async () => {
						await plugin.renameDevice(device.id, name.trim() || device.name, host.trim() || device.host);
						editingId = null;
						render();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					editingId = null;
					render();
				})
			);
	}

	render();
	return { destroy: () => addPanel?.destroy() };
}
