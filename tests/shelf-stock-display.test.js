import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_TYPES, getShelfDisplayGrid } from "../js/logic/FixtureLayout.js";
import {
  getShelfCategoryColor,
  getShelfStackBounds,
  ShelfStockDisplay,
} from "../js/logic/ShelfStockDisplay.js";

test("shelf display grid follows Budget sections and levels, or two visual slots per floor tile", () => {
  assert.deepEqual(getShelfDisplayGrid(FIXTURE_TYPES.shelf_budget_3x4), { w: 4, h: 3 });
  assert.deepEqual(getShelfDisplayGrid(FIXTURE_TYPES.shelf_budget_2x3), { w: 3, h: 2 });
  assert.deepEqual(getShelfDisplayGrid({ w: 1, h: 1 }), { w: 2, h: 2 });
  assert.deepEqual(getShelfDisplayGrid({ w: 2, h: 1 }), { w: 4, h: 2 });
});

test("world display blocks form a smaller, centered grid following item footprints", () => {
  assert.deepEqual(
    getShelfStackBounds(
      { w: 3, h: 2 },
      { gx: 2, gy: 1, w: 2, h: 1 },
    ),
    { x: -20, y: -20, width: 40, height: 20 },
  );
});

test("adjacent stock boxes touch without gaps", () => {
  const grid = { w: 1, h: 1 };
  const topLeft = getShelfStackBounds(grid, { gx: 0, gy: 0, w: 1, h: 1 });
  const topRight = getShelfStackBounds(grid, { gx: 1, gy: 0, w: 1, h: 1 });
  const bottomLeft = getShelfStackBounds(grid, { gx: 0, gy: 1, w: 1, h: 1 });
  assert.deepEqual(topLeft, { x: -20, y: -20, width: 20, height: 20 });
  assert.equal(topRight.x, topLeft.x + topLeft.width);
  assert.equal(bottomLeft.y, topLeft.y + topLeft.height);
});

test("shelf display uses a stable category color", () => {
  assert.equal(getShelfCategoryColor({ tags: ["Firearm", "Standard"] }),
    getShelfCategoryColor({ tags: ["Firearm", "Rare"] }));
  assert.notEqual(getShelfCategoryColor({ tags: ["Firearm"] }),
    getShelfCategoryColor({ tags: ["Apparel"] }));
  assert.equal(getShelfCategoryColor({ tags: ["Unknown"] }), 0x8090a0);
});

test("shelf display reuses numeric count labels and stays eight pixels lower in every direction", () => {
  const fills = [];
  const strokes = [];
  const texts = [];
  const graphics = {
    clear() {},
    fillStyle(color, alpha) { this.color = color; this.alpha = alpha; return this; },
    fillRect(x, y, width, height) { fills.push({ color: this.color, alpha: this.alpha, x, y, width, height }); return this; },
    lineStyle(lineWidth, color, alpha) { this.lineWidth = lineWidth; this.lineColor = color; this.lineAlpha = alpha; return this; },
    strokeRect(x, y, width, height) {
      strokes.push({ lineWidth: this.lineWidth, color: this.lineColor, alpha: this.lineAlpha, x, y, width, height });
      return this;
    },
  };
  const container = {
    angle: 0,
    add() {},
    setDepth() { return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setAngle(angle) { this.angle = angle; return this; },
    destroy() {},
  };
  const scene = {
    add: {
      container: (x, y) => container.setPosition(x, y),
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
          setPosition(x, y) { this.x = x; this.y = y; return this; },
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
  assert.deepEqual({ x: container.x, y: container.y }, { x: 100, y: 208 });

  display.sync();
  assert.deepEqual(fills[0], {
    color: 0x111827, alpha: 0.5, x: -20, y: -20, width: 40, height: 20,
  });
  assert.deepEqual(strokes[0], {
    lineWidth: 1, color: getShelfCategoryColor({ tags: ["Firearm"] }), alpha: 0.9,
    x: -19.5, y: -19.5, width: 39, height: 19,
  });
  assert.equal(texts.length, 1);
  assert.equal(texts[0].text, "3");
  assert.equal(texts[0].style.fontSize, "10px");
  assert.equal(texts[0].style.backgroundColor, undefined);
  assert.equal(texts[0].style.padding, undefined);
  assert.deepEqual({ x: texts[0].x, y: texts[0].y }, { x: 0, y: -10 });

  display.sync();
  assert.equal(fills.length, 1);
  assert.equal(strokes.length, 1);
  assert.equal(texts.length, 1);

  placement.quantity = 4;
  display.sync();
  assert.equal(fills.length, 2);
  assert.equal(strokes.length, 2);
  assert.equal(texts.length, 1);
  assert.equal(texts[0].text, "4");

  placement.quantity = 0;
  display.sync();
  assert.equal(fills.length, 3);
  assert.equal(strokes.length, 3);
  assert.equal(texts.length, 1);
  assert.equal(texts[0].visible, true);
  assert.equal(texts[0].text, "0");
  assert.equal(texts[0].color, "#ffffff");

  placement.quantity = 10;
  display.sync();
  assert.equal(texts.length, 1);
  assert.equal(texts[0].text, "10");

  // A turned shelf turns its stock boxes but keeps the quantity labels upright.
  for (const angle of [0, 90, 180, 270]) {
    display.setAngle(angle);
    display.setPosition(300, 400);
    assert.equal(container.angle, angle);
    assert.equal(texts[0].angle, -angle);
    assert.deepEqual({ x: container.x, y: container.y }, { x: 300, y: 408 });
  }
  display.destroy();
});
