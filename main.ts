import { Plugin, setTooltip } from "obsidian";
import { DEFAULT_SETTINGS, type WledControlSettings } from "./src/types";
import { DeviceManager } from "./src/devices/deviceManager";
import { probeWledInfo } from "./src/devices/httpUtil";
import { WledSettingTab } from "./src/settings";
import { SidebarView, VIEW_TYPE_SIDEBAR } from "./src/views/sidebarView";
import { WebDashboardView, VIEW_TYPE_DASHBOARD } from "./src/views/webDashboardView";

interface RibbonEntry {
	el: HTMLElement;
}

interface StatusBarEntry {
	container: HTMLElement;
	dot: HTMLElement;
	label: HTMLElement;
}

export default class WledControlPlugin extends Plugin {
	settings!: WledControlSettings;
	deviceManager!: DeviceManager;

	private deviceManagerUnsub: (() => void) | null = null;
	private ribbonIcons = new Map<string, RibbonEntry>();
	private statusBarItems = new Map<string, StatusBarEntry>();
	private registeredCommandIds = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.deviceManager = new DeviceManager(() => this.settings.colorWriteDebounceMs);
		this.deviceManager.syncDevices(this.settings.devices);
		this.deviceManagerUnsub = this.deviceManager.onChange((id) => this.onDeviceRuntimeChange(id));

		this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => new SidebarView(leaf, this));
		this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new WebDashboardView(leaf));

		this.addRibbonIcon("lightbulb", "Open WLED Control", () => void this.activateSidebarView());

		this.addCommand({
			id: "open-sidebar",
			name: "Open sidebar",
			callback: () => void this.activateSidebarView(),
		});
		this.addCommand({
			id: "open-manage",
			name: "Manage devices (open settings)",
			callback: () => this.openSettings(),
		});

		this.addSettingTab(new WledSettingTab(this.app, this));

		this.refreshQuickAccess();
	}

	onunload(): void {
		this.deviceManagerUnsub?.();
		this.deviceManager.destroy();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	syncDevices(): void {
		this.deviceManager.syncDevices(this.settings.devices);
	}

	// Empty name: resolve from the device's own /json/info.name, fallback to host.
	async addDevice(name: string, host: string): Promise<void> {
		const resolvedName = name.trim() || (await probeWledInfo(host, 2000))?.name || host;
		this.settings.devices.push({
			id: crypto.randomUUID(),
			name: resolvedName,
			connectionType: "network",
			host,
			showInRibbon: false,
			showInStatusBar: false,
		});
		await this.saveSettings();
		this.syncDevices();
		this.refreshQuickAccess();
	}

	async removeDevice(id: string): Promise<void> {
		this.settings.devices = this.settings.devices.filter((d) => d.id !== id);
		await this.saveSettings();
		this.syncDevices();
		this.refreshQuickAccess();
	}

	async renameDevice(id: string, name: string, host: string): Promise<void> {
		const device = this.settings.devices.find((d) => d.id === id);
		if (!device) return;
		device.name = name;
		device.host = host;
		await this.saveSettings();
		this.syncDevices();
		this.refreshQuickAccess();
	}

	// Uses Obsidian's internal (untyped) settings API — standard community-plugin pattern.
	openSettings(): void {
		const appWithSettings = this.app as unknown as {
			setting: { open: () => void; openTabById: (id: string) => void };
		};
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(this.manifest.id);
	}

	openExternal(host: string): void {
		window.open(`http://${host}`, "_blank");
	}

	async openDashboardTab(host: string, name: string): Promise<void> {
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true, state: { host, name } });
		this.app.workspace.revealLeaf(leaf);
	}

	async activateSidebarView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE_SIDEBAR, active: true });
		}
		workspace.revealLeaf(leaf);
	}

	refreshQuickAccess(): void {
		this.rebuildRibbonIcons();
		this.rebuildStatusBarItems();
		this.registerDeviceCommands();
	}

	private rebuildRibbonIcons(): void {
		for (const entry of this.ribbonIcons.values()) entry.el.remove();
		this.ribbonIcons.clear();

		for (const device of this.settings.devices) {
			if (!device.showInRibbon) continue;
			const el = this.addRibbonIcon("power", device.name, () => {
				void this.deviceManager.toggleDevice(device.id);
			});
			el.addClass("wled-ribbon-icon");
			this.ribbonIcons.set(device.id, { el });
			this.updateRibbonIcon(device.id);
		}
	}

	private updateRibbonIcon(id: string): void {
		const entry = this.ribbonIcons.get(id);
		const device = this.deviceManager.getEntry(id);
		if (!entry || !device?.runtime.state) return;
		entry.el.toggleClass("is-on", device.runtime.state.on);
		const col = device.runtime.state.seg[0]?.col?.[0];
		entry.el.style.setProperty(
			"--wled-current-color",
			col && col.length >= 3 ? `rgb(${col[0]}, ${col[1]}, ${col[2]})` : ""
		);
	}

	private rebuildStatusBarItems(): void {
		for (const entry of this.statusBarItems.values()) entry.container.remove();
		this.statusBarItems.clear();

		for (const device of this.settings.devices) {
			if (!device.showInStatusBar) continue;
			const container = this.addStatusBarItem();
			container.addClass("wled-statusbar-item");
			const dot = container.createSpan({ cls: "wled-statusbar-dot" });
			const label = container.createSpan({ cls: "wled-statusbar-label", text: device.name });
			container.addEventListener("click", () => {
				void this.deviceManager.toggleDevice(device.id);
			});
			this.statusBarItems.set(device.id, { container, dot, label });
			this.updateStatusBarItem(device.id);
		}
	}

	private updateStatusBarItem(id: string): void {
		const entry = this.statusBarItems.get(id);
		const device = this.deviceManager.getEntry(id);
		if (!entry || !device) return;
		entry.dot.setAttribute("data-status", device.runtime.status);
		if (device.runtime.state) {
			entry.container.toggleClass("is-on", device.runtime.state.on);
			const col = device.runtime.state.seg[0]?.col?.[0];
			entry.dot.style.backgroundColor =
				device.runtime.state.on && col && col.length >= 3 ? `rgb(${col[0]}, ${col[1]}, ${col[2]})` : "";
		}
		setTooltip(entry.container, `Toggle ${device.config.name}`);
	}

	// No API to unregister a single command — removed devices leave a dead command until reload.
	private registerDeviceCommands(): void {
		for (const device of this.settings.devices) {
			const cmdId = `toggle-${device.id}`;
			if (this.registeredCommandIds.has(cmdId)) continue;
			this.registeredCommandIds.add(cmdId);
			this.addCommand({
				id: cmdId,
				name: `Toggle WLED: ${device.name}`,
				callback: () => {
					void this.deviceManager.toggleDevice(device.id);
				},
			});
		}
	}

	private onDeviceRuntimeChange(id: string): void {
		this.updateRibbonIcon(id);
		this.updateStatusBarItem(id);
	}
}
