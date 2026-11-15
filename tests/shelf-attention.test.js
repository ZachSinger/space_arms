import assert from "node:assert/strict";
import { test } from "node:test";
import { ShelfAttentionHighlight, shelfMatchesCarried, pulseAmount } from "../js/logic/ShelfAttentionHighlight.js";
import { TILE_SIZE } from "../js/logic/RoomLayout.js";
import { fixtureBounds } from "../js/logic/FixtureLayout.js";

function shelf(placements) {
  return { type: "shelf_budget_2x4", rotation: 0, x: 320, y: 320, placements };
}

test("a shelf glows only when it has a space for an item in a carried crate, sold out included", () => {
  const fixture = shelf([{ itemId: "rifle", quantity: 0 }, { itemId: "paste", quantity: 3 }]);
  assert.equal(shelfMatchesCarried(fixture, [{ itemId: "rifle", quantity: 5 }]), true);
  assert.equal(shelfMatchesCarried(fixture, [{ itemId: "boots", quantity: 5 }, { itemId: "paste", quantity: 1 }]), true);
  assert.equal(shelfMatchesCarried(fixture, [{ itemId: "boots", quantity: 5 }]), false);
  assert.equal(shelfMatchesCarried(fixture, [{ itemId: null, quantity: 0 }]), false);
  assert.equal(shelfMatchesCarried(fixture, []), false);
});

test("the pulse rests at the start of each beat and peaks halfway through", () => {
  assert.equal(pulseAmount(0, 500), 0);
  assert.equal(pulseAmount(250, 500), 1);
  assert.equal(pulseAmount(500, 500), 0);
});

test("the outline follows the shelf's turned body box and disappears once the crate is put down", () => {
  const strokes = [];
  const graphics = {
    setDepth() { return this; },
    setVisible(visible) { this.visible = visible; return this; },
    clear() { strokes.length = 0; return this; },
    lineStyle(width, color) { this.color = color; return this; },
    strokeRect(x, y, width, height) { strokes.push({ color: this.color, x, y, width, height }); return this; },
  };
  let carried = [{ itemId: "rifle", quantity: 4 }];
  const fixture = shelf([{ itemId: "rifle", quantity: 10 }]);
  fixture.rotation = 1; // turned sideways: 1 tile wide, 2 tall
  const scene = { add: { graphics: () => graphics }, getCarriedCrates: () => carried };
  const highlight = new ShelfAttentionHighlight(scene, fixture);
  highlight.update(0);
  assert.equal(graphics.visible, true);
  const inner = strokes.at(-1);
  const { left, top, right, bottom } = fixtureBounds({ ...fixture, gx: 0, gy: 0 });
  assert.ok(Math.abs(inner.width - ((right - left) * TILE_SIZE + 4)) < 1e-8);
  assert.ok(Math.abs(inner.height - ((bottom - top) * TILE_SIZE + 4)) < 1e-8);
  carried = [];
  highlight.update(100);
  assert.equal(graphics.visible, false);
});
