import { test } from "node:test";
import assert from "node:assert/strict";
import { createRandom } from "../js/core/Random.js";

test("the same seed rolls the same numbers, and reseeding starts the sequence over", () => {
  const first = createRandom(42);
  const second = createRandom(42);
  const rolls = Array.from({ length: 5 }, () => first());

  assert.deepEqual(Array.from({ length: 5 }, () => second()), rolls);
  assert.ok(rolls.every((roll) => roll >= 0 && roll < 1));
  first.reseed(42);
  assert.equal(first(), rolls[0]);
  assert.notEqual(createRandom(43)(), rolls[0]);
});

test("whole-number rolls include both ends of the range", () => {
  const random = createRandom(1);
  const seen = new Set(Array.from({ length: 200 }, () => random.int(1, 3)));

  assert.deepEqual([...seen].sort(), [1, 2, 3]);
  assert.equal(random.pick([]), undefined);
});

test("an override fixes the dice until it is undone", () => {
  const random = createRandom(7);
  const undo = random.override(() => 0.5);

  assert.equal(random(), 0.5);
  assert.equal(random.pick(["a", "b", "c"]), "b");
  undo();
  assert.notEqual(random(), 0.5);
});
