const MAX_BUFFER_CHARS = 64 * 1024;

// Splits a serial byte stream into JSON objects. WLED answers one JSON object per line, but the
// first read after opening a port can start mid-line, and firmware may print non-JSON log lines.
export class LineFramer {
	private buffer = "";

	push(chunk: string): Record<string, unknown>[] {
		this.buffer += chunk;
		const objects: Record<string, unknown>[] = [];
		let newline: number;
		while ((newline = this.buffer.indexOf("\n")) >= 0) {
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (!line.startsWith("{")) continue;
			try {
				const parsed: unknown = JSON.parse(line);
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					objects.push(parsed as Record<string, unknown>);
				}
			} catch {
				// truncated line or log noise
			}
		}
		if (this.buffer.length > MAX_BUFFER_CHARS) this.buffer = "";
		return objects;
	}

	reset(): void {
		this.buffer = "";
	}
}
