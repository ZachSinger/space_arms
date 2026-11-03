import test from "node:test";
import assert from "node:assert/strict";
import { computeSlideOffset } from "../js/logic/FixtureHighlight.js";

const viewport = { left: 0, top: 36, right: 1600, bottom: 900 };
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });

test("no slide when the window does not cover the fixture", () => {
  assert.deepEqual(computeSlideOffset(rect(60, 60, 600, 500), rect(900, 200, 64, 64), viewport), { x: 0, y: 0 });
});

test("slides along the shortest axis that clears the fixture", () => {
  // Fixture near the window's right edge: a short slide left beats any other direction.
  const offset = computeSlideOffset(rect(60, 60, 600, 500), rect(620, 300, 64, 64), viewport, 0);
  assert.deepEqual(offset, { x: -40, y: 0 });
});

test("prefers a slide that keeps the window on screen", () => {
  // Window hugs the left edge; sliding left would be shorter but leaves the viewport.
  const offset = computeSlideOffset(rect(0, 60, 600, 500), rect(10, 300, 64, 64), viewport, 0);
  assert.equal(offset.y, 0);
  assert.equal(offset.x, 74);
});

test("uses a vertical slide when horizontal space runs out", () => {
  const offset = computeSlideOffset(rect(0, 36, 1600, 400), rect(700, 380, 64, 64), viewport, 0);
  assert.deepEqual(offset, { x: 0, y: 408 });
});
