import assert from "node:assert/strict";
import { test } from "node:test";
import { ShelfAttentionHighlight, getShelfAttention, pulseAmount } from "../js/logic/ShelfAttentionHighlight.js";
import { TILE_SIZE } from "../js/logic/RoomLayout.js";

function shelf(quantities, capacity = 10) {
  return {
    type: "shelf_budget_2x4", rotation: 0, x: 320, y: 320,
    placements: quantities.map((quantity) => ({ quantity })),
    getPlacementCapacity: () => capacity,
  };
}

test("sold out anywhere on a shelf beats running low; half full or empty shelves need nothing", () => {
  assert.equal(getShelfAttention(shelf([10, 4, 0])), "out");
  assert.equal(getShelfAttention(shelf([10, 4])), "low");
  assert.equal(getShelfAttention(shelf([10, 5])), null);
  assert.equal(getShelfAttention(shelf([])), null);
});

test("the pulse rests at the start of each beat and peaks halfway through", () => {
  assert.equal(pulseAmount(0, 500), 0);
  assert.equal(pulseAmount(250, 500), 1);
  assert.equal(pulseAmount(500, 500), 0);
});

test("the outline follows the shelf's turned footprint and disappears once restocked", () => {
  const strokes = [];
  const graphics = {
    setDepth() { return this; },
    setVisible(visible) { this.visible = visible; return this; },
    clear() { strokes.length = 0; return this; },
    lineStyle(width, color) { this.color = color; return this; },
    strokeRect(x, y, width, height) { strokes.push({ color: this.color, x, y, width, height }); return this; },
  };
  const fixture = shelf([0]);
  fixture.rotation = 1; // turned sideways: 1 tile wide, 2 tall
  const highlight = new ShelfAttentionHighlight({ add: { graphics: () => graphics } }, fixture);
  highlight.update(0);
  assert.equal(graphics.visible, true);
  const inner = strokes.at(-1);
  assert.equal(inner.color, 0xef4444);
  assert.deepEqual([inner.width, inner.height], [TILE_SIZE + 4, 2 * TILE_SIZE + 4]);
  fixture.placements[0].quantity = 10;
  highlight.update(100);
  assert.equal(graphics.visible, false);
});
