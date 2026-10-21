import { Notice, Setting } from "obsidian";
import type WledControlPlugin from "../../main";
import {
	formatPresetLines,
	mergePresets,
	parsePresetLines,
	parsePresetsJson,
} from "../devices/presets";
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

			new Setting(container).setName("Add device").setHeading();
			addPanel = createAddDevicePanel(container, {
				existingHosts: () => plugin.settings.devices.map((d) => d.host),
				mdnsEnabled: plugin.settings.mdnsDiscoveryEnabled,
				onAdd: async (name, host) => {
					await plugin.addDevice(name, host);
					render();
				},
				serialEnabled: plugin.settings.serialEnabled,
				existingPorts: () => plugin.settings.devices.flatMap((d) => (d.serialPath ? [d.serialPath] : [])),
				listSerialPorts: () => plugin.listSerialPorts(),
				onAddUsb: async (name, serialPath) => {
					await plugin.addUsbDevice(name, serialPath);
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

		const isUsb = device.connectionType === "usb";
		new Setting(group)
			.setName(device.name)
			.setDesc(isUsb ? `USB · ${device.serialPath ?? ""}` : device.host)
			.addExtraButton((btn) =>
				btn
					.setIcon("pencil")
					.setTooltip(isUsb ? "Edit USB device" : "Edit name/IP")
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

	function renderUsbEditForm(group: HTMLElement, device: WledDeviceConfig): void {
		let name = device.name;
		let serialPath = device.serialPath ?? "";
		let host = device.host;
		let presetText = formatPresetLines(device.serialPresets ?? []);
		let presetsInput: HTMLTextAreaElement | null = null;

		new Setting(group)
			.setName("Name")
			.addText((text) => text.setValue(name).onChange((v) => (name = v)));

		new Setting(group)
			.setName("Serial port path")
			.addText((text) => text.setValue(serialPath).onChange((v) => (serialPath = v)));

		new Setting(group)
			.setName("IP address (optional)")
			.setDesc("Only used to read preset names over HTTP if the controller also has WiFi.")
			.addText((text) => text.setValue(host).onChange((v) => (host = v)));

		new Setting(group)
			.setName("Presets")
			.setDesc(
				"WLED only lists preset names over HTTP. One per line: ID, then name (e.g. “1 Evening”). " +
					"Applying a preset by ID works over USB."
			)
			.addTextArea((area) => {
				presetsInput = area.inputEl;
				area.inputEl.rows = 6;
				area.setValue(presetText).onChange((v) => (presetText = v));
			});

		new Setting(group)
			.setName("Import presets.json")
			.setDesc("Download it from the WLED web UI once (Config → Security & Updates) and import it here.")
			.addButton((btn) =>
				btn.setButtonText("Choose file").onClick(() => {
					const picker = document.createElement("input");
					picker.type = "file";
					picker.accept = ".json,application/json";
					picker.addEventListener("change", () => {
						const file = picker.files?.[0];
						if (!file) return;
						void file.text().then((raw) => {
							try {
								const imported = parsePresetsJson(JSON.parse(raw));
								const merged = mergePresets(parsePresetLines(presetText, device.serialPresets), imported);
								presetText = formatPresetLines(merged);
								if (presetsInput) presetsInput.value = presetText;
								new Notice(`Imported ${imported.length} presets.`);
							} catch {
								new Notice("Could not read that file as presets.json.");
							}
						});
					});
					picker.click();
				})
			);

		new Setting(group)
			.addButton((btn) =>
				btn
					.setButtonText("Save")
					.setCta()
					.onClick(async () => {
						await plugin.updateUsbDevice(device.id, {
							name: name.trim() || device.name,
							host: host.trim(),
							serialPath: serialPath.trim() || device.serialPath,
							serialPresets: parsePresetLines(presetText, device.serialPresets),
						});
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

	function renderEditForm(group: HTMLElement, device: WledDeviceConfig): void {
		if (device.connectionType === "usb") {
			renderUsbEditForm(group, device);
			return;
		}
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
