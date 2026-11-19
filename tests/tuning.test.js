import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTuning } from "../js/core/Tuning.js";

const entry = (value, extra = {}) => ({ value, min: 0, max: 10, description: "A number.", ...extra });

test("tuning loads plain values and lists, frozen", () => {
  const tuning = loadTuning("shop", { doors: entry(2, { integer: true }), walkMs: entry([1, 4]) });

  assert.deepEqual(tuning, { doors: 2, walkMs: [1, 4] });
  assert.ok(Object.isFrozen(tuning) && Object.isFrozen(tuning.walkMs));
});

test("tuning rejects out-of-range, fractional, missing, and undescribed numbers by name", () => {
  assert.throws(() => loadTuning("shop", { doors: entry(11) }), /shop\.doors is 11, outside its allowed range 0 to 10/);
  assert.throws(() => loadTuning("shop", { walkMs: entry([1, -1]) }), /shop\.walkMs is -1/);
  assert.throws(() => loadTuning("shop", { doors: entry(1.5, { integer: true }) }), /whole number/);
  assert.throws(() => loadTuning("shop", { doors: entry("2") }), /must be a number/);
  assert.throws(() => loadTuning("shop", { doors: entry(2, { description: " " }) }), /needs a description/);
  assert.throws(() => loadTuning("shop", { doors: entry(2, { min: 5, max: 1 }) }), /min and max/);
});
