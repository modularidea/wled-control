import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
	formatPresetLines,
	mergePresets,
	parsePresetLines,
	parsePresetsJson,
} from "../src/devices/presets";

test("parsePresetsJson skips preset 0 and non-object entries, sorts by id", () => {
	const raw = { "0": {}, "3": { n: "Warm", ql: "W" }, "1": { n: "Day" }, "2": null, x: { n: "bad" } };
	assert.deepEqual(parsePresetsJson(raw), [
		{ id: 1, name: "Day", ql: undefined },
		{ id: 3, name: "Warm", ql: "W" },
	]);
});

test("parsePresetsJson tolerates non-object input", () => {
	assert.deepEqual(parsePresetsJson(null), []);
	assert.deepEqual(parsePresetsJson("nope"), []);
});

test("mergePresets: primary wins, gaps are filled from fallback", () => {
	const merged = mergePresets(
		[{ id: 1, name: "Mine" }, { id: 2 }],
		[{ id: 1, name: "Theirs", ql: "T" }, { id: 2, name: "Two" }, { id: 4, name: "Four" }]
	);
	assert.deepEqual(merged, [
		{ id: 1, name: "Mine", ql: "T" },
		{ id: 2, name: "Two", ql: undefined },
		{ id: 4, name: "Four" },
	]);
});

test("parsePresetLines accepts '<id> <name>' variants and keeps quick labels", () => {
	const previous = [{ id: 2, name: "Old", ql: "O" }];
	assert.deepEqual(parsePresetLines("1 Day\n2: Evening glow\n 3 - Night \nnot a line\n0 zero\n\n4", previous), [
		{ id: 1, name: "Day", ql: undefined },
		{ id: 2, name: "Evening glow", ql: "O" },
		{ id: 3, name: "Night", ql: undefined },
		{ id: 4, name: undefined, ql: undefined },
	]);
});

test("formatPresetLines round-trips through parsePresetLines", () => {
	const list = [{ id: 1, name: "Day" }, { id: 5 }];
	assert.equal(formatPresetLines(list), "1 Day\n5");
	assert.deepEqual(
		parsePresetLines(formatPresetLines(list)).map((p) => [p.id, p.name]),
		[[1, "Day"], [5, undefined]]
	);
});
