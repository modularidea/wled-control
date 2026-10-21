import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";

// Loaded lazily (dynamic import) so a failure here never affects network devices.

export interface SerialTransport {
	open(): Promise<void>;
	write(data: string): Promise<void>;
	close(): void;
	onData(cb: (chunk: string) => void): void;
	onClose(cb: (error?: Error) => void): void;
}

// The reader exits when the port closes or the device is unplugged; the watcher stops it once
// our stdin closes, so a crashed Obsidian can't leave a process holding the port. sh gives
// background jobs /dev/null as stdin, hence the explicit fd 3 for the watcher.
// stty runs while cat holds the port open: macOS resets termios (raw mode, -hupcl) when the last
// process closes the port, so configuring it beforehand would have no effect.
const READER_SCRIPT =
	'exec 3<&0; cat "$1" </dev/null & p=$!; sleep 0.3; ' +
	'stty "$2" "$1" "$3" raw -echo -hupcl || { kill $p 2>/dev/null; exit 1; }; echo READY >&2; ' +
	"(cat <&3 >/dev/null; kill $p 2>/dev/null) & wait $p";
const WRITER_SCRIPT = 'exec cat > "$1"';
const READY_MARKER = "READY";
const READY_TIMEOUT_MS = 4000;
const KILL_AFTER_MS = 2000;

function spawned(child: ChildProcess): Promise<void> {
	return new Promise((resolve, reject) => {
		child.once("spawn", () => resolve());
		child.once("error", reject);
	});
}

// Serial access through stty plus two small cat helper processes — no native module, so Obsidian
// updates can't break it. All blocking tty I/O (and a close() that may wait for an unresponsive
// device to drain) happens in the helpers, never in Obsidian's own threads: fs streams would pin
// libuv threadpool threads in uncancellable reads, and libuv's tty handles leak descriptors on macOS.
export class ProcessSerialTransport implements SerialTransport {
	private reader: ChildProcess | null = null;
	private writer: ChildProcess | null = null;
	private dataCb: (chunk: string) => void = () => undefined;
	private closeCb: (error?: Error) => void = () => undefined;
	private ended = false;
	private stderr = "";

	constructor(
		private path: string,
		private baudRate: number
	) {}

	onData(cb: (chunk: string) => void): void {
		this.dataCb = cb;
	}

	onClose(cb: (error?: Error) => void): void {
		this.closeCb = cb;
	}

	async open(): Promise<void> {
		if (process.platform !== "darwin" && process.platform !== "linux") {
			throw new Error("USB serial is supported on macOS and Linux only.");
		}
		// -hupcl (set by the reader script): don't drop DTR when the port closes, which would
		// reset some boards.
		const deviceFlag = process.platform === "darwin" ? "-f" : "-F";
		const readerArgs = ["-c", READER_SCRIPT, "sh", this.path, deviceFlag, String(this.baudRate)];
		const reader = spawn("sh", readerArgs, { stdio: ["pipe", "pipe", "pipe"] });
		const writer = spawn("sh", ["-c", WRITER_SCRIPT, "sh", this.path], { stdio: ["pipe", "ignore", "pipe"] });
		this.reader = reader;
		this.writer = writer;

		let markReady: () => void = () => undefined;
		const ready = new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(() => reject(new Error("Timed out configuring the port.")), READY_TIMEOUT_MS);
			markReady = () => {
				window.clearTimeout(timer);
				resolve();
			};
			reader.once("exit", () => {
				window.clearTimeout(timer);
				reject(new Error(this.describeFailure()));
			});
		});

		for (const child of [reader, writer]) {
			child.stderr?.setEncoding("utf8");
			child.stderr?.on("data", (text: string) => {
				this.stderr += text;
				if (child === reader && this.stderr.includes(READY_MARKER)) {
					this.stderr = this.stderr.replace(READY_MARKER, "");
					markReady();
				}
			});
			child.stdin?.on("error", () => undefined);
			child.on("exit", () => this.finish());
		}
		reader.stdout?.setEncoding("utf8");
		reader.stdout?.on("data", (chunk: string) => this.dataCb(chunk));

		try {
			await Promise.all([spawned(reader), spawned(writer), ready]);
		} catch (err) {
			this.release();
			throw err instanceof Error ? err : new Error(String(err));
		}
	}

	write(data: string): Promise<void> {
		const stdin = this.writer?.stdin;
		if (!stdin || this.ended) return Promise.reject(new Error("Port is closed."));
		return new Promise((resolve, reject) => {
			stdin.write(data, (err) => (err ? reject(new Error("Port is closed.")) : resolve()));
		});
	}

	close(): void {
		this.ended = true;
		this.release();
	}

	private finish(): void {
		if (this.ended) return;
		this.ended = true;
		this.release();
		this.closeCb(new Error(this.describeFailure()));
	}

	private describeFailure(): string {
		const text = this.stderr.trim();
		if (/No such file/i.test(text)) return "Port not found — is the controller plugged in?";
		if (/Permission denied/i.test(text)) return "No permission to open the port.";
		if (/busy/i.test(text)) return "Port is busy — another program may be using it.";
		return text || "Connection to the controller was lost.";
	}

	// Closing stdin lets both helpers wind down on their own; SIGKILL is only the fallback for a
	// helper stuck closing a port whose device stopped draining.
	private release(): void {
		for (const child of [this.reader, this.writer]) {
			if (!child) continue;
			child.stdin?.end();
			const timer = window.setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS);
			child.once("exit", () => window.clearTimeout(timer));
		}
		this.reader = null;
		this.writer = null;
	}
}

// macOS exposes both /dev/tty.* and /dev/cu.*; cu.* is the right one for initiating connections.
const PORT_PATTERN = /^cu\.(usbmodem|usbserial|wchusbserial|SLAB_USBtoUART)/;

export function listSerialPorts(): Promise<string[]> {
	return new Promise((resolve) => {
		fs.readdir("/dev", (err, names) => {
			if (err) return resolve([]);
			resolve(
				names
					.filter((name) => PORT_PATTERN.test(name))
					.sort()
					.map((name) => `/dev/${name}`)
			);
		});
	});
}
