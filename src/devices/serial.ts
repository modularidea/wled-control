import { execFile } from "child_process";
import * as fs from "fs";

// Loaded lazily (dynamic import) so a failure here never affects network devices.

export interface SerialTransport {
	open(): Promise<void>;
	write(data: string): Promise<void>;
	close(): void;
	onData(cb: (chunk: string) => void): void;
	onClose(cb: (error?: Error) => void): void;
}

function runStty(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile("stty", args, (err, _stdout, stderr) => {
			if (err) reject(new Error(stderr.trim() || err.message));
			else resolve();
		});
	});
}

function describeError(err: NodeJS.ErrnoException): Error {
	switch (err.code) {
		case "ENOENT":
			return new Error("Port not found — is the controller plugged in?");
		case "EACCES":
		case "EPERM":
			return new Error("No permission to open the port.");
		case "EBUSY":
			return new Error("Port is busy — another program may be using it.");
		default:
			return err;
	}
}

// Serial access via plain file I/O plus stty — no native module, so Obsidian updates can't break it.
export class FsSerialTransport implements SerialTransport {
	private readStream: fs.ReadStream | null = null;
	private writeFd: number | null = null;
	private dataCb: (chunk: string) => void = () => undefined;
	private closeCb: (error?: Error) => void = () => undefined;
	private ended = false;

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

		const stream = fs.createReadStream(this.path, { encoding: "utf8" });
		await new Promise<void>((resolve, reject) => {
			stream.once("open", () => resolve());
			stream.once("error", (err) => reject(describeError(err)));
		});
		this.readStream = stream;
		stream.on("data", (chunk) => this.dataCb(chunk as string));
		stream.on("error", (err) => this.finish(describeError(err)));
		stream.on("close", () => this.finish());

		try {
			this.writeFd = await new Promise<number>((resolve, reject) => {
				fs.open(this.path, fs.constants.O_WRONLY | fs.constants.O_NOCTTY, (err, fd) =>
					err ? reject(describeError(err)) : resolve(fd)
				);
			});
		} catch (err) {
			stream.destroy();
			throw err;
		}
	}

	write(data: string): Promise<void> {
		const fd = this.writeFd;
		if (fd === null || this.ended) return Promise.reject(new Error("Port is closed."));
		return new Promise((resolve, reject) => {
			fs.write(fd, data, (err) => (err ? reject(describeError(err)) : resolve()));
		});
	}

	close(): void {
		this.ended = true;
		this.release();
	}

	private finish(error?: Error): void {
		if (this.ended) return;
		this.ended = true;
		this.release();
		this.closeCb(error);
	}

	private release(): void {
		this.readStream?.destroy();
		this.readStream = null;
		if (this.writeFd !== null) {
			const fd = this.writeFd;
			this.writeFd = null;
			fs.close(fd, () => undefined);
		}
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
