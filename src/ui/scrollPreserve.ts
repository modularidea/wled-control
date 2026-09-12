// Finds the nearest scrollable ancestor of `el` and restores its scroll position around a
// full DOM rebuild (e.g. container.empty() + re-populate), which would otherwise reset it.
export function withScrollPreserved(el: HTMLElement, rebuild: () => void): void {
	let node: HTMLElement | null = el;
	while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
	const scrollTop = node?.scrollTop ?? 0;
	rebuild();
	if (node) node.scrollTop = scrollTop;
}
