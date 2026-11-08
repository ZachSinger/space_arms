import assert from "node:assert/strict";
import test from "node:test";
import { FLOOR_COUNT, WALL_COUNT, floorSourceRect, wallSourceRect } from "../js/logic/ShopTiles.js";

// RPG Maker MZ sheet sizes: A2 is 768x576, A4 is 768x720.
const inside = ({ x, y, size }, width, height) => x >= 0 && y >= 0 && x + size <= width && y + size <= height;

test("every floor cut-out is the interior of a ground autotile on the A2 sheet", () => {
  for (let i = 0; i < FLOOR_COUNT; i += 1) assert.ok(inside(floorSourceRect(i), 768, 576), `floor ${i}`);
  assert.deepEqual(floorSourceRect(0), { x: 24, y: 72, size: 48 });
  assert.deepEqual(floorSourceRect(9), { x: 120, y: 216, size: 48 });
});

test("every wall cut-out is the interior of a wall-face autotile on the A4 sheet", () => {
  for (let i = 0; i < WALL_COUNT; i += 1) assert.ok(inside(wallSourceRect(i), 768, 720), `wall ${i}`);
  assert.deepEqual(wallSourceRect(0), { x: 24, y: 168, size: 48 });
  assert.deepEqual(wallSourceRect(23), { x: 696, y: 648, size: 48 });
});
