import { test } from "node:test";
import { strict as assert } from "node:assert";
import { LineFramer } from "../src/devices/lineFramer";

test("returns one object per complete line", () => {
	const framer = new LineFramer();
	assert.deepEqual(framer.push('{"a":1}\n{"b":2}\n'), [{ a: 1 }, { b: 2 }]);
});

test("buffers a line split across chunks", () => {
	const framer = new LineFramer();
	assert.deepEqual(framer.push('{"state":{"on"'), []);
	assert.deepEqual(framer.push(':true}}\r\n'), [{ state: { on: true } }]);
});

test("drops a leading fragment left over from before the port was opened", () => {
	const framer = new LineFramer();
	assert.deepEqual(framer.push('"state":{"on":true,"bri":1\n{"ok":true}\n'), [{ ok: true }]);
});

test("ignores log noise, arrays and invalid JSON", () => {
	const framer = new LineFramer();
	assert.deepEqual(framer.push('boot: ready\n[1,2]\n{broken\n{"ok":1}\n'), [{ ok: 1 }]);
});

test("discards an unterminated buffer that grows without bound", () => {
	const framer = new LineFramer();
	framer.push("x".repeat(70 * 1024));
	assert.deepEqual(framer.push('{"ok":1}\n'), [{ ok: 1 }]);
});
