import { setTooltip } from "obsidian";
import type { ConnectionStatus } from "../types";

const LABELS: Record<ConnectionStatus, string> = {
	connecting: "Connecting…",
	online: "Online",
	reconnecting: "Reconnecting…",
	offline: "Offline",
	error: "Error",
};

export interface StatusDotHandle {
	el: HTMLElement;
	update: (status: ConnectionStatus, detail?: string) => void;
}

export function createStatusDot(parent: HTMLElement): StatusDotHandle {
	const el = parent.createSpan({ cls: "wled-status-dot" });

	function update(status: ConnectionStatus, detail?: string): void {
		el.setAttribute("data-status", status);
		setTooltip(el, detail ? `${LABELS[status]} — ${detail}` : LABELS[status]);
	}

	update("connecting");
	return { el, update };
}
