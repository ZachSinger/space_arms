import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FIXTURE_TYPES } from "../js/logic/FixtureLayout.js";
import {
  getShelfCategoryTexture,
  getShelfCountPixelRects,
  getShelfIconBounds,
  SHELF_CATEGORY_TEXTURES,
  ShelfIconDisplay,
} from "../js/logic/ShelfIconDisplay.js";

const items = JSON.parse(readFileSync(new URL("../data/Items.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../data/TilesetManifest.json", import.meta.url), "utf8"));

function makeDisplay(placements = [], gridDimensions = { w: 1, h: 1 }) {
  const images = [];
  const counts = [];
  const fills = [];
  const container = {
    angle: 0,
    children: [],
    add(children) { this.children.push(...(Array.isArray(children) ? children : [children])); },
    setDepth(depth) { this.depth = depth; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    destroy() { for (const child of [...this.children]) child.destroy(); this.destroyed = true; },
  };
  const object = () => ({
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    destroy() {
      this.destroyed = true;
      container.children = container.children.filter((child) => child !== this);
    },
  });
  const createGraphics = (draws) => ({
    ...object(),
    fills: draws,
    clear() { draws.length = 0; return this; },
    fillStyle(color, alpha) { this.color = color; this.alpha = alpha; return this; },
    fillRect(x, y, width, height) {
      draws.push({ color: this.color, alpha: this.alpha, x, y, width, height });
      return this;
    },
    lineStyle() { return this; },
    strokeRect() { return this; },
  });
  const graphics = createGraphics(fills);
  let baseGraphicsCreated = false;
  const textures = new Set(Object.values(SHELF_CATEGORY_TEXTURES));
  const scene = {
    textures: { exists: (key) => textures.has(key) },
    add: {
      container: (x, y) => container.setPosition(x, y),
      graphics: () => {
        if (!baseGraphicsCreated) {
          baseGraphicsCreated = true;
          return graphics;
        }
        const count = createGraphics([]);
        counts.push(count);
        return count;
      },
      image: (x, y, texture) => {
        const icon = {
          ...object(), x, y, texture,
          setDisplaySize(width, height) { this.width = width; this.height = height; return this; },
          setTexture(key) { this.texture = key; return this; },
        };
        images.push(icon);
        return icon;
      },
    },
  };
  const fixture = { x: 100, y: 200, gridDimensions, placements };
  const definitions = new Map([
    ["rifle", { tags: ["Firearm"] }],
    ["pistol", { tags: ["Firearm"] }],
    ["tool", { tags: ["Tool"] }],
    ["water", { tags: ["Survival"] }],
  ]);
  const display = new ShelfIconDisplay(scene, fixture, (id) => definitions.get(id));
  return { display, fixture, images, counts, fills, container, graphics, textures, definitions };
}

const placement = (itemId, quantity, gx = 0, gy = 0) =>
  ({ itemId, quantity, gx, gy, w: 1, h: 1 });

test("all item categories have a distinct, preloaded shelf icon", () => {
  const categories = [...new Set(items.map((item) => item.tags[0]))].sort();
  assert.deepEqual(Object.keys(SHELF_CATEGORY_TEXTURES).sort(), categories);
  assert.equal(new Set(Object.values(SHELF_CATEGORY_TEXTURES)).size, 8);
  for (const item of items) {
    const key = getShelfCategoryTexture(item);
    const assets = manifest.filter((asset) => asset.key === key);
    assert.equal(assets.length, 1);
    assert.match(assets[0].path, /ShelfCategoryIcons\/native\/category_[a-z]+\.png$/);
  }
  assert.throws(() => getShelfCategoryTexture({ tags: ["Unknown"] }), /No shelf icon/);
  assert.throws(() => getShelfCategoryTexture(null), /No shelf icon/);
});

test("the budget shelf fits four equal icon-and-count pairs in two rows", () => {
  const grid = { w: 1, h: 1 };
  assert.deepEqual([0, 1, 2, 3].map((i) => getShelfIconBounds(grid, i)), [
    { x: -32, y: -24, width: 32, height: 24 },
    { x: 0, y: -24, width: 32, height: 24 },
    { x: -32, y: 0, width: 32, height: 24 },
    { x: 0, y: 0, width: 32, height: 24 },
  ]);
  assert.throws(() => getShelfIconBounds(grid, 4), /outside the shelf/);
  assert.throws(() => getShelfIconBounds(grid, -1), /outside the shelf/);
});

test("shelf quantities use crisp pixel digits with a solid background", () => {
  const singleDigit = getShelfCountPixelRects(4, 32, 24);
  assert.deepEqual(singleDigit[0], {
    x: 23, y: 11, width: 8, height: 12, color: 0x05080d,
  });
  assert.ok(singleDigit.slice(1).every((rect) =>
    rect.color === 0xffffff && rect.width === 2 && rect.height === 2));
  assert.equal(singleDigit.length, 10);

  const doubleDigit = getShelfCountPixelRects(12, 32, 24);
  assert.deepEqual(doubleDigit[0], {
    x: 15, y: 11, width: 16, height: 12, color: 0x05080d,
  });
  assert.equal(doubleDigit.length, 20);
});

test("every shelf's full icon capacity fits its footprint at all rotations", () => {
  for (const spec of Object.values(FIXTURE_TYPES).filter((entry) => entry.kind === "shelf")) {
    for (const angle of [0, 90, 180, 270]) {
      const sideways = angle % 180 !== 0;
      const width = (sideways ? spec.h : spec.w) * 64;
      const height = (sideways ? spec.w : spec.h) * 64;
      const bounds = Array.from({ length: spec.w * spec.h * 4 },
        (_, i) => getShelfIconBounds(spec, i, angle));
      for (const rect of bounds) {
        assert.ok(rect.x >= -width / 2);
        assert.ok(rect.x + rect.width <= width / 2);
        assert.ok(rect.y + 8 >= -height / 2);
        assert.ok(rect.y + rect.height + 8 <= height / 2);
      }
      assert.equal(new Set(bounds.map(({ x, y }) => `${x},${y}`)).size, bounds.length);
    }
  }
  assert.deepEqual(getShelfIconBounds({ w: 2, h: 1 }, 2, 90),
    { x: -32, y: -24, width: 32, height: 24 });
});

test("badges follow reading order without merging matching categories or items", () => {
  const a = placement("rifle", 3, 0, 0);
  const b = placement("pistol", 4, 1, 0);
  const c = placement("rifle", 2, 0, 1);
  const d = placement("water", 10, 1, 1);
  const { display, images, counts, container, fills } = makeDisplay([d, b, c, a]);
  display.sync();
  assert.equal(counts.length, 4);
  assert.deepEqual(counts.map((count) => count.fills.length), [12, 10, 12, 21]);
  assert.deepEqual(images.map((icon) => icon.texture), [
    "shelf_category_firearm", "shelf_category_firearm", "shelf_category_firearm", "shelf_category_survival",
  ]);
  assert.deepEqual(images.map(({ x, y }) => ({ x, y })), [
    { x: -20, y: -12 }, { x: 12, y: -12 }, { x: -20, y: 12 }, { x: 12, y: 12 },
  ]);
  assert.equal(container.x, 100);
  assert.equal(container.y, 208);
  assert.equal(container.depth, 3);
  assert.equal(fills.length, 4);
  assert.ok(images.every((icon) => icon.width === 24 && icon.height === 24));
  assert.deepEqual(display.fixture.placements, [d, b, c, a]);
});

test("large item footprints do not create oversized icons or badges", () => {
  const p = { ...placement("rifle", 3), w: 2, h: 2 };
  const { display, fills } = makeDisplay([p]);
  display.sync();
  assert.equal(fills[0].width, 32);
  assert.equal(fills[0].height, 24);
});

test("stock changes reuse sprites, retain zero counts, and update category textures", () => {
  const p = placement("rifle", 3);
  const { display, counts, images } = makeDisplay([p]);
  display.sync();
  display.sync();
  assert.equal(counts.length, 1);
  assert.equal(images.length, 1);
  for (const [quantity, expectedRectCount] of [[0, 13], [1, 9], [10, 21]]) {
    p.quantity = quantity;
    display.sync();
    assert.equal(counts[0].fills.length, expectedRectCount);
    assert.equal(counts[0].destroyed, undefined);
  }
  p.itemId = "tool";
  display.sync();
  assert.equal(images[0].texture, "shelf_category_tool");
  assert.equal(images.length, 1);
});

test("turning a rectangular shelf reflows upright pairs and movement keeps the world-space offset", () => {
  const slots = [placement("rifle", 3), placement("tool", 2, 1), placement("water", 4, 2)];
  const { display, images, counts, container } = makeDisplay(slots, { w: 2, h: 1 });
  display.sync();
  for (const angle of [0, 90, 180, 270]) {
    display.setAngle(angle);
    display.setPosition(300, 400);
    const bounds = getShelfIconBounds({ w: 2, h: 1 }, 2, angle);
    assert.equal(container.angle, 0);
    assert.deepEqual({ x: container.x, y: container.y }, { x: 300, y: 408 });
    assert.deepEqual({ x: images[2].x, y: images[2].y },
      { x: bounds.x + 12, y: bounds.y + 12 });
    assert.equal(counts.length, slots.length);
  }
  assert.equal(images.length, 3);
});

test("removing or replacing a placement destroys its old pair, and cleanup destroys all children", () => {
  const p = placement("rifle", 3);
  const state = makeDisplay([p]);
  state.display.sync();
  state.fixture.placements = [{ ...p }];
  state.display.sync();
  assert.equal(state.images[0].destroyed, true);
  assert.equal(state.counts[0].destroyed, true);
  assert.equal(state.display.entries.size, 1);
  state.fixture.placements = [];
  state.display.sync();
  assert.equal(state.images[1].destroyed, true);
  assert.equal(state.counts[1].destroyed, true);
  assert.equal(state.fills.length, 0);
  state.fixture.placements = [p];
  state.display.sync();
  state.display.destroy();
  assert.equal(state.display.entries.size, 0);
  assert.equal(state.container.destroyed, true);
  assert.equal(state.graphics.destroyed, true);
  assert.equal(state.images[2].destroyed, true);
  assert.equal(state.counts[2].destroyed, true);
});

test("missing items and icon textures report explicit errors", () => {
  const state = makeDisplay([placement("missing", 3)]);
  assert.throws(() => state.display.sync(), /Unknown shelf item: missing/);
  state.fixture.placements = [placement("rifle", 3)];
  state.textures.delete("shelf_category_firearm");
  assert.throws(() => state.display.sync(), /Shelf icon texture is not loaded/);
  assert.equal(state.images.length, 0);
});

test("the game instantiates icons while the deprecated box display remains available", () => {
  const scene = readFileSync(new URL("../js/scenes/game.js", import.meta.url), "utf8");
  assert.match(scene, /fixture\.stockDisplay = new ShelfIconDisplay\(/);
  assert.doesNotMatch(scene, /\bShelfStockDisplay\b/);
  const legacy = readFileSync(new URL("../js/logic/ShelfStockDisplay.js", import.meta.url), "utf8");
  assert.match(legacy, /@deprecated/);
  assert.match(legacy, /export class ShelfStockDisplay/);
});
