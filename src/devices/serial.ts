import { execFile, spawn, type ChildProcess } from "child_process";
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
const READER_SCRIPT =
	'exec 3<&0; cat "$1" </dev/null & p=$!; (cat <&3 >/dev/null; kill $p 2>/dev/null) & wait $p';
const WRITER_SCRIPT = 'exec cat > "$1"';
const KILL_AFTER_MS = 2000;

function runStty(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile("stty", args, (err, _stdout, stderr) => {
			if (err) reject(new Error(stderr.trim() || err.message));
			else resolve();
		});
	});
}

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
		// -hupcl: don't drop DTR when the port closes (would reset some boards).
		const deviceFlag = process.platform === "darwin" ? "-f" : "-F";
		try {
			await runStty([deviceFlag, this.path, String(this.baudRate), "raw", "-echo", "-hupcl"]);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw /No such file|ENOENT/i.test(message)
				? new Error("Port not found — is the controller plugged in?")
				: new Error(`Could not configure the port: ${message}`);
		}

		const reader = spawn("sh", ["-c", READER_SCRIPT, "sh", this.path], { stdio: ["pipe", "pipe", "pipe"] });
		const writer = spawn("sh", ["-c", WRITER_SCRIPT, "sh", this.path], { stdio: ["pipe", "ignore", "pipe"] });
		this.reader = reader;
		this.writer = writer;

		for (const child of [reader, writer]) {
			child.stderr?.setEncoding("utf8");
			child.stderr?.on("data", (text: string) => (this.stderr += text));
			child.stdin?.on("error", () => undefined);
			child.on("exit", () => this.finish());
		}
		reader.stdout?.setEncoding("utf8");
		reader.stdout?.on("data", (chunk: string) => this.dataCb(chunk));

		try {
			await Promise.all([spawned(reader), spawned(writer)]);
		} catch (err) {
			this.release();
			throw new Error(`Could not start the serial helper: ${err instanceof Error ? err.message : String(err)}`);
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
