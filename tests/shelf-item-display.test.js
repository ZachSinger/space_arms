import assert from "node:assert/strict";
import test from "node:test";
import {
  getShelfItemBounds,
  getShelfItemTextureKey,
  ShelfItemDisplay,
} from "../js/logic/ShelfItemDisplay.js";

const budgetArea = { left: 28 / 384, right: 364 / 384, top: 48 / 192, bottom: 172 / 192 };

function makeDisplay(placements) {
  const draws = [];
  const children = [];
  const source = { width: 32, height: 32 };
  const textureKey = getShelfItemTextureKey("rifle");
  const container = {
    visible: true,
    children,
    add(child) { children.push(child); return this; },
    bringToTop(child) {
      children.splice(children.indexOf(child), 1);
      children.push(child);
      return this;
    },
    setDepth(depth) { this.depth = depth; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setVisible(visible) { this.visible = visible; return this; },
    destroy() { this.destroyed = true; },
  };
  const graphics = {
    clear() { draws.length = 0; return this; },
    fillStyle(color, alpha) { this.color = color; this.alpha = alpha; return this; },
    fillRect(x, y, width, height) { draws.push({ color: this.color, alpha: this.alpha, x, y, width, height }); return this; },
    lineStyle() { return this; },
    strokeRect() { return this; },
  };
  const images = [];
  const labels = [];
  const scene = {
    textures: {
      exists: (key) => key === textureKey,
      get: () => ({ getSourceImage: () => source }),
    },
    add: {
      container: (x, y) => container.setPosition(x, y),
      graphics: () => graphics,
      image: (x, y, texture) => {
        const image = {
          x, y, texture,
          setPosition(px, py) { this.x = px; this.y = py; return this; },
          setScale(scale) { this.scale = scale; return this; },
          setAlpha(alpha) { this.alpha = alpha; return this; },
          setVisible(visible) { this.visible = visible; return this; },
          setTexture(key) { this.texture = key; return this; },
          destroy() { this.destroyed = true; },
        };
        images.push(image);
        return image;
      },
      text: (x, y, text) => {
        const label = {
          x, y, text,
          setOrigin() { return this; },
          setText(value) { this.text = value; return this; },
          setPosition(px, py) { this.x = px; this.y = py; return this; },
          setVisible(visible) { this.visible = visible; return this; },
          destroy() { this.destroyed = true; },
        };
        labels.push(label);
        return label;
      },
    },
  };
  const fixture = {
    type: "shelf_budget_2x4",
    x: 100,
    y: 200,
    rotation: 0,
    gridDimensions: { w: 2, h: 1 },
    displayGrid: { w: 4, h: 3 },
    placements,
    getPlacementCapacity: () => 10,
  };
  const display = new ShelfItemDisplay(scene, fixture, () => ({
    id: "rifle", name: "Rifle", image: "img/rifle.png",
  }));
  return { display, fixture, container, draws, images, labels };
}

test("shelf stock bounds follow the same grid cells as the shelf window", () => {
  const bounds = getShelfItemBounds(
    { w: 2, h: 1 },
    { w: 4, h: 3 },
    { gx: 1, gy: 1, w: 2, h: 2 },
    budgetArea,
  );
  assert.deepEqual(bounds, {
    x: -64 + (28 / 384) * 128 + 28,
    y: -32 + (48 / 192) * 64 + ((172 - 48) / 192) * 64 / 3,
    width: 56,
    height: (2 / 3) * ((172 - 48) / 192) * 64,
  });
});

test("down-facing shelves show the matching item and quantity, while turned shelves hide it", () => {
  const placement = { itemId: "rifle", gx: 1, gy: 1, w: 2, h: 1, quantity: 4 };
  const { display, fixture, container, draws, images, labels } = makeDisplay([placement]);
  assert.equal(container.visible, true);
  assert.equal(container.depth, 2.5);
  assert.equal(draws.length, 1);
  assert.equal(images.length, 1);
  assert.equal(images[0].texture, getShelfItemTextureKey("rifle"));
  assert.equal(images[0].alpha, 1);
  assert.equal(labels[0].text, "4/10");

  placement.quantity = 0;
  display.sync();
  assert.equal(images[0].alpha, 0.35);
  assert.equal(labels[0].text, "0/10");

  display.setAngle(90);
  assert.equal(container.visible, false);
  placement.quantity = 3;
  display.sync();
  assert.equal(labels[0].text, "0/10");

  display.setAngle(0);
  assert.equal(container.visible, true);
  assert.equal(labels[0].text, "3/10");

  fixture.placements = [];
  display.sync();
  assert.equal(images[0].destroyed, true);
  assert.equal(labels[0].destroyed, true);
  display.destroy();
  assert.equal(container.destroyed, true);
});
