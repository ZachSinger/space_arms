import assert from "node:assert/strict";
import { test } from "node:test";
import { ShelfAttentionHighlight, shelfMatchesStockable, pulseAmount } from "../js/logic/ShelfAttentionHighlight.js";
import { TILE_SIZE } from "../js/logic/RoomLayout.js";
import { fixtureBounds } from "../js/logic/FixtureLayout.js";

function shelf(placements) {
  return { type: "shelf_budget_2x4", rotation: 0, x: 320, y: 320, placements };
}

test("a shelf glows only when it has a space for an item in a stockable crate, sold out included", () => {
  const fixture = shelf([{ itemId: "rifle", quantity: 0 }, { itemId: "paste", quantity: 3 }]);
  assert.equal(shelfMatchesStockable(fixture, [{ itemId: "rifle", quantity: 5 }]), true);
  assert.equal(shelfMatchesStockable(fixture, [{ itemId: "boots", quantity: 5 }, { itemId: "paste", quantity: 1 }]), true);
  assert.equal(shelfMatchesStockable(fixture, [{ itemId: "boots", quantity: 5 }]), false);
  assert.equal(shelfMatchesStockable(fixture, [{ itemId: null, quantity: 0 }]), false);
  assert.equal(shelfMatchesStockable(fixture, []), false);
});

test("the pulse rests at the start of each beat and peaks halfway through", () => {
  assert.equal(pulseAmount(0, 500), 0);
  assert.equal(pulseAmount(250, 500), 1);
  assert.equal(pulseAmount(500, 500), 0);
});

test("the outline follows the shelf's turned body box and disappears once the crate is put down", () => {
  const strokes = [];
  const graphics = {
    setDepth(depth) { this.depth = depth; return this; },
    setVisible(visible) { this.visible = visible; return this; },
    clear() { strokes.length = 0; return this; },
    lineStyle(width, color) { this.color = color; return this; },
    strokeRect(x, y, width, height) { strokes.push({ color: this.color, x, y, width, height }); return this; },
  };
  let stockable = [{ itemId: "rifle", quantity: 4 }];
  const fixture = shelf([{ itemId: "rifle", quantity: 10 }]);
  fixture.rotation = 1; // turned sideways: 1 tile wide, 2 tall
  const scene = { add: { graphics: () => graphics }, crateSystem: { getStockableCrates: () => stockable } };
  const highlight = new ShelfAttentionHighlight(scene, fixture);
  assert.ok(graphics.depth > 20000, "the outline draws above people, carried crates, and world markers");
  highlight.update(0);
  assert.equal(graphics.visible, true);
  const inner = strokes.at(-1);
  const { left, top, right, bottom } = fixtureBounds({ ...fixture, gx: 0, gy: 0 });
  assert.ok(Math.abs(inner.width - ((right - left) * TILE_SIZE + 4)) < 1e-8);
  assert.ok(Math.abs(inner.height - ((bottom - top) * TILE_SIZE + 4)) < 1e-8);
  stockable = [];
  highlight.update(100);
  assert.equal(graphics.visible, false);
});

test("an inactive shelf does not clear its graphics every frame", () => {
  let clears = 0;
  const graphics = {
    setDepth() { return this; },
    setVisible() { return this; },
    clear() { clears += 1; return this; },
  };
  const fixture = shelf([{ itemId: "rifle", quantity: 0 }]);
  const scene = { add: { graphics: () => graphics }, crateSystem: { getStockableCrates: () => [] } };
  const highlight = new ShelfAttentionHighlight(scene, fixture);
  highlight.update(0);
  highlight.update(16);
  assert.equal(clears, 0);
});
