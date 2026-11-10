import test from "node:test";
import assert from "node:assert/strict";
import { separateOverlappingCrates } from "../js/logic/CrateSeparation.js";

const crateAt = (key, x, y, locked = false) => ({ key, rect: { left: x - 20, top: y - 20, width: 40, height: 40 }, locked });

test("two crates stacked on top of each other are pulled apart evenly", () => {
  // Same layout as the playtest bug: 24px apart vertically, so 16px overlap.
  const offsets = separateOverlappingCrates([crateAt("a", 155, 6640), crateAt("b", 156, 6664)]);
  assert.deepEqual(offsets.get("a"), { x: 0, y: -8 });
  assert.deepEqual(offsets.get("b"), { x: 0, y: 8 });
});

test("crates that are only touching are left alone", () => {
  const offsets = separateOverlappingCrates([crateAt("a", 100, 100), crateAt("b", 140, 100)]);
  assert.equal(offsets.size, 0);
});

test("a crate on the loading pad stays put and the loose crate moves the whole way", () => {
  const offsets = separateOverlappingCrates([crateAt("pad", 100, 100, true), crateAt("loose", 100, 110)]);
  assert.equal(offsets.has("pad"), false);
  assert.deepEqual(offsets.get("loose"), { x: 0, y: 30 });
});

test("a crate against a wall stays put and the other crate moves the whole way", () => {
  const isBlocked = (key, rect) => key === "a" && rect.top < 80;
  const offsets = separateOverlappingCrates([crateAt("a", 100, 100), crateAt("b", 100, 120)], isBlocked);
  assert.equal(offsets.has("a"), false);
  assert.deepEqual(offsets.get("b"), { x: 0, y: 20 });
});

test("when neither crate can move along the short axis, they separate along the other", () => {
  const isBlocked = (_key, rect) => rect.top !== 80 && rect.top !== 92;
  const offsets = separateOverlappingCrates([crateAt("a", 100, 100), crateAt("b", 110, 112)], isBlocked);
  assert.equal(offsets.get("a").y, 0);
  assert.equal(offsets.get("b").y, 0);
  assert.equal(offsets.get("b").x - offsets.get("a").x, 30);
});
