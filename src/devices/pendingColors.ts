export type Rgb = [number, number, number];

// Collects debounced color writes per segment: a drag that touches several selected segments
// must reach all of them, not just whichever was queued last.
export class PendingColors {
	private bySegment = new Map<number, Rgb>();

	set(segId: number, rgb: Rgb): void {
		this.bySegment.set(segId, rgb);
	}

	take(): Record<string, unknown> | null {
		if (this.bySegment.size === 0) return null;
		const seg = [...this.bySegment].map(([id, rgb]) => ({ id, col: [rgb] }));
		this.bySegment.clear();
		return { seg };
	}
}
