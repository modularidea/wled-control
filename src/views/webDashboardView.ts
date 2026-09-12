import { ItemView, WorkspaceLeaf, type ViewStateResult } from "obsidian";

export const VIEW_TYPE_DASHBOARD = "wled-control-dashboard";

interface DashboardViewState {
	host?: string;
	name?: string;
}

// Embeds the WLED web UI in a tab via <iframe> (not Electron's deprecated <webview> tag).
export class WebDashboardView extends ItemView {
	private host = "";
	private name = "WLED Dashboard";

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_DASHBOARD;
	}

	getDisplayText(): string {
		return this.name;
	}

	getIcon(): string {
		return "layout-panel-left";
	}

	async setState(state: DashboardViewState, result: ViewStateResult): Promise<void> {
		if (state?.host) this.host = state.host;
		if (state?.name) this.name = state.name;
		this.render();
		await super.setState(state, result);
	}

	getState(): Record<string, unknown> {
		return { host: this.host, name: this.name };
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	private render(): void {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("wled-dashboard-view");
		if (!this.host) {
			container.createEl("p", { text: "No device selected." });
			return;
		}
		const iframe = container.createEl("iframe", { cls: "wled-dashboard-iframe" });
		iframe.src = `http://${this.host}`;
	}
}
