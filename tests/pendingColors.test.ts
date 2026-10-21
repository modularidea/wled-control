import { test } from "node:test";
import { strict as assert } from "node:assert";
import { PendingColors } from "../src/devices/pendingColors";

test("keeps a color for every segment queued in one burst", () => {
	const pending = new PendingColors();
	pending.set(0, [255, 0, 0]);
	pending.set(1, [255, 0, 0]);
	assert.deepEqual(pending.take(), {
		seg: [
			{ id: 0, col: [[255, 0, 0]] },
			{ id: 1, col: [[255, 0, 0]] },
		],
	});
});

test("the latest color per segment wins", () => {
	const pending = new PendingColors();
	pending.set(0, [1, 1, 1]);
	pending.set(0, [2, 2, 2]);
	assert.deepEqual(pending.take(), { seg: [{ id: 0, col: [[2, 2, 2]] }] });
});

test("take() empties the queue", () => {
	const pending = new PendingColors();
	pending.set(0, [1, 1, 1]);
	pending.take();
	assert.equal(pending.take(), null);
});
