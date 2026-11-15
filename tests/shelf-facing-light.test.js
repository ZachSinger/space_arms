import assert from "node:assert/strict";
import { test } from "node:test";
import { ShelfFacingLight } from "../js/logic/ShelfFacingLight.js";

function makeLight(rotation = 0, zoom = 1) {
  const graphics = {
    setDepth() { return this; },
    clear() { return this; },
    fillStyle(color, alpha) { this.alpha = alpha; return this; },
    fillRect(x, y, width, height) { this.rect = { x, y, width, height }; return this; },
    destroy() { this.destroyed = true; },
  };
  const fixture = {
    type: "shelf_budget_2x2", rotation,
    sprite: { getBounds: () => ({ x: 100, y: 200, width: 72, height: 64, right: 172, bottom: 264 }) },
  };
  const scene = {
    add: { graphics: () => graphics },
    cameras: { main: { zoom, scrollX: 0, scrollY: 0 } },
  };
  return { light: new ShelfFacingLight(scene, fixture), fixture, graphics };
}

test("the front light fades off to on to off in exactly three seconds and repeats", () => {
  const { light, graphics } = makeLight();
  for (const [time, alpha] of [[0, 0], [750, 0.5], [1500, 1], [2250, 0.5], [3000, 0], [4500, 1]]) {
    light.update(time);
    assert.ok(Math.abs(graphics.alpha - alpha) < 1e-10);
  }
});

test("each facing lights only its shopping edge and stays one screen pixel thick at any zoom", () => {
  for (const zoom of [0.5, 1, 2]) {
    for (const rotation of [0, 1, 2, 3]) {
      const { light, graphics } = makeLight(rotation, zoom);
      light.update(1500);
      const r = graphics.rect;
      assert.equal((rotation % 2 ? r.width : r.height) * zoom, 1);
      if (rotation === 0) assert.ok(r.y > 260);
      if (rotation === 2) assert.ok(r.y >= 214 && r.y <= 217);
      if (rotation === 1) assert.equal(r.x, 112);
      if (rotation === 3) assert.ok(r.x >= 158 && r.x < 160);
    }
  }
});

test("the light follows moving and turning a shelf, and is destroyed with its display", () => {
  const { light, graphics, fixture } = makeLight();
  light.update(1500);
  fixture.rotation = 3;
  fixture.sprite.getBounds = () => ({ x: 300, y: 400, width: 64, height: 72, right: 364, bottom: 472 });
  light.update(1500);
  assert.equal(graphics.rect.y, 404);
  assert.equal(graphics.rect.height, 64);
  assert.ok(graphics.rect.x > 350);
  light.destroy();
  assert.equal(graphics.destroyed, true);
});
