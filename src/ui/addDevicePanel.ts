import { Notice, Setting, type DropdownComponent } from "obsidian";
import { WledDiscovery, type DiscoveredWledDevice } from "../devices/discovery";

const DISCOVERY_DURATION_MS = 8000;

export interface AddDevicePanelOptions {
	existingHosts: () => string[];
	onAdd: (name: string, host: string) => void | Promise<void>;
	mdnsEnabled: boolean;
	serialEnabled: boolean;
	existingPorts: () => string[];
	listSerialPorts: () => Promise<string[]>;
	onAddUsb: (name: string, serialPath: string) => void | Promise<void>;
}

export interface AddDevicePanelHandle {
	destroy: () => void;
}

export function createAddDevicePanel(
	parent: HTMLElement,
	options: AddDevicePanelOptions
): AddDevicePanelHandle {
	let discovery: WledDiscovery | null = null;
	let name = "";
	let host = "";

	new Setting(parent)
		.setName("Name")
		.setDesc("Leave empty to use the WLED name configured on the controller.")
		.addText((text) => text.setPlaceholder("e.g. Living Room").onChange((v) => (name = v)));

	new Setting(parent)
		.setName("IP address or hostname")
		.addText((text) =>
			text.setPlaceholder("192.168.1.50 or wled-livingroom.local").onChange((v) => (host = v))
		)
		.addButton((btn) =>
			btn
				.setButtonText("Add")
				.setCta()
				.onClick(async () => {
					if (!host.trim()) {
						new Notice("Please enter an IP address or hostname.");
						return;
					}
					await options.onAdd(name.trim(), host.trim());
				})
		);

	if (options.serialEnabled) renderUsbSection();

	function renderUsbSection(): void {
		let selectedPort = "";
		let customPort = "";
		let portDropdown: DropdownComponent | null = null;

		async function refreshPorts(): Promise<void> {
			if (!portDropdown) return;
			const added = new Set(options.existingPorts());
			const ports = (await options.listSerialPorts()).filter((p) => !added.has(p));
			portDropdown.selectEl.empty();
			if (ports.length === 0) {
				portDropdown.addOption("", "No new ports found");
				selectedPort = "";
				return;
			}
			for (const port of ports) portDropdown.addOption(port, port);
			selectedPort = ports[0];
			portDropdown.setValue(selectedPort);
		}

		new Setting(parent)
			.setName("USB serial port")
			.setDesc(
				"For controllers connected by cable, e.g. without WiFi. Uses the name field above. " +
					"Plug the controller in, then rescan."
			)
			.addDropdown((dropdown) => {
				portDropdown = dropdown;
				dropdown.onChange((value) => (selectedPort = value));
			})
			.addExtraButton((btn) =>
				btn
					.setIcon("refresh-cw")
					.setTooltip("Rescan ports")
					.onClick(() => void refreshPorts())
			)
			.addButton((btn) =>
				btn
					.setButtonText("Add USB device")
					.setCta()
					.onClick(async () => {
						const path = customPort.trim() || selectedPort;
						if (!path) {
							new Notice("Select a USB port or enter its path.");
							return;
						}
						if (options.existingPorts().includes(path)) {
							new Notice("This port is already added.");
							return;
						}
						btn.setDisabled(true);
						try {
							await options.onAddUsb(name.trim(), path);
						} finally {
							btn.setDisabled(false);
						}
					})
			);

		new Setting(parent)
			.setName("Custom port path")
			.setDesc("Optional. Overrides the selection, e.g. /dev/cu.usbmodem1101.")
			.addText((text) => text.setPlaceholder("/dev/cu.usbmodem…").onChange((v) => (customPort = v)));

		void refreshPorts();
	}

	if (options.mdnsEnabled) {
		const resultsEl = parent.createDiv();
		new Setting(parent)
			.setName("Search network")
			.setDesc("Scans your local subnet over HTTP plus an mDNS attempt. Same-subnet devices only.")
			.addButton((btn) =>
				btn.setButtonText("Start search").onClick(() => {
					runDiscovery(btn.buttonEl, resultsEl);
				})
			);
	}

	function runDiscovery(buttonEl: HTMLElement, resultsEl: HTMLElement): void {
		const found: DiscoveredWledDevice[] = [];
		resultsEl.empty();
		buttonEl.setAttribute("disabled", "true");
		resultsEl.createEl("p", { text: "Searching…", cls: "setting-item-description" });

		discovery?.stop();
		discovery = new WledDiscovery();
		const existing = new Set(options.existingHosts());

		discovery.start((device) => {
			if (existing.has(device.host) || found.some((f) => f.host === device.host)) return;
			found.push(device);
			renderResults(resultsEl, found);
		});

		window.setTimeout(() => {
			discovery?.stop();
			discovery = null;
			buttonEl.removeAttribute("disabled");
			if (found.length === 0) {
				resultsEl.empty();
				resultsEl.createEl("p", {
					text: "No devices found. Add one via manual IP entry above.",
					cls: "setting-item-description",
				});
			}
		}, DISCOVERY_DURATION_MS);
	}

	function renderResults(resultsEl: HTMLElement, found: DiscoveredWledDevice[]): void {
		resultsEl.empty();
		for (const device of found) {
			new Setting(resultsEl)
				.setName(device.name)
				.setDesc(device.host)
				.addButton((btn) =>
					btn
						.setButtonText("Add")
						.setCta()
						.onClick(() => {
							// Stop the scan immediately instead of letting it run to the timeout,
							// so the new device isn't connecting while the scan floods the network.
							discovery?.stop();
							discovery = null;
							void options.onAdd(device.name, device.host);
						})
				);
		}
	}

	return {
		destroy: () => discovery?.stop(),
	};
}
