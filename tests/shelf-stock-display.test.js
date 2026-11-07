import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_TYPES, getShelfDisplayGrid } from "../js/logic/FixtureLayout.js";
import {
  getShelfCategoryColor,
  getShelfStackBounds,
  ShelfStockDisplay,
} from "../js/logic/ShelfStockDisplay.js";

test("shelf display grid scales at two visual slots per floor tile", () => {
  assert.deepEqual(getShelfDisplayGrid(FIXTURE_TYPES.shelf_universal), { w: 6, h: 4 });
  assert.deepEqual(getShelfDisplayGrid(FIXTURE_TYPES.shelf_starter_2x1), { w: 4, h: 2 });
  assert.deepEqual(getShelfDisplayGrid({ w: 1, h: 1 }), { w: 2, h: 2 });
  assert.deepEqual(getShelfDisplayGrid({ w: 2, h: 1 }), { w: 4, h: 2 });
});

test("world display blocks use the shared half-tile cell size and item footprint", () => {
  assert.deepEqual(
    getShelfStackBounds(
      { w: 3, h: 2 },
      { gx: 2, gy: 1, w: 2, h: 1 },
    ),
    { x: -32, y: -32, width: 64, height: 32 },
  );
});

test("shelf display uses a stable category color", () => {
  assert.equal(getShelfCategoryColor({ tags: ["Firearm", "Standard"] }),
    getShelfCategoryColor({ tags: ["Firearm", "Rare"] }));
  assert.notEqual(getShelfCategoryColor({ tags: ["Firearm"] }),
    getShelfCategoryColor({ tags: ["Apparel"] }));
  assert.equal(getShelfCategoryColor({ tags: ["Unknown"] }), 0x8090a0);
});

test("shelf display batches blocks and reuses one quantity label per placement, including sold-out x0", () => {
  const fills = [];
  const texts = [];
  const graphics = {
    clear() {},
    fillStyle(color, alpha) { this.color = color; this.alpha = alpha; return this; },
    fillRect(x, y, width, height) { fills.push({ color: this.color, alpha: this.alpha, x, y, width, height }); return this; },
    lineStyle() { return this; },
    strokeRect() { return this; },
  };
  const container = {
    angle: 0,
    add() {},
    setDepth() { return this; },
    setPosition() { return this; },
    setAngle(angle) { this.angle = angle; return this; },
    destroy() {},
  };
  const scene = {
    add: {
      container: () => container,
      graphics: () => graphics,
      text: (x, y, text, style) => {
        const label = {
          text,
          style,
          visible: true,
          setOrigin() { return this; },
          setAngle(angle) { this.angle = angle; return this; },
          setText(value) { this.text = value; return this; },
          setColor(value) { this.color = value; return this; },
          setPosition() { return this; },
          setVisible(value) { this.visible = value; return this; },
          destroy() {},
        };
        texts.push(label);
        return label;
      },
    },
  };
  const placement = { itemId: "rifle", gx: 2, gy: 1, w: 2, h: 1, quantity: 3 };
  const fixture = {
    x: 100,
    y: 200,
    gridDimensions: { w: 3, h: 2 },
    placements: [placement],
  };
  const display = new ShelfStockDisplay(scene, fixture, () => ({ tags: ["Firearm"] }));

  display.sync();
  assert.equal(fills.length, 2);
  assert.deepEqual(
    { x: fills[0].x, y: fills[0].y, width: fills[0].width, height: fills[0].height },
    { x: -30, y: -30, width: 60, height: 28 },
  );
  assert.equal(fills[0].color, getShelfCategoryColor({ tags: ["Firearm"] }));
  assert.deepEqual(fills[1], {
    color: 0x111827, alpha: 0.95, x: -28, y: -28, width: 56, height: 24,
  });
  assert.equal(texts.length, 1);
  assert.equal(texts[0].text, "x3");
  assert.equal(texts[0].style.fontSize, "13px");
  assert.equal(texts[0].style.backgroundColor, undefined);
  assert.deepEqual(texts[0].style.padding, { x: 2, y: 2 });

  display.sync();
  assert.equal(fills.length, 2);
  assert.equal(texts.length, 1);

  placement.quantity = 4;
  display.sync();
  assert.equal(fills.length, 4);
  assert.equal(texts.length, 1);
  assert.equal(texts[0].text, "x4");

  placement.quantity = 0;
  display.sync();
  assert.equal(fills.length, 6);
  assert.equal(texts.length, 1);
  assert.equal(texts[0].visible, true);
  assert.equal(texts[0].text, "x0");
  assert.equal(texts[0].color, "#ffffff");

  // A turned shelf turns its stock boxes but keeps the quantity labels upright.
  display.setAngle(90);
  assert.equal(container.angle, 90);
  assert.equal(texts[0].angle, -90);
  display.destroy();
});
