import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_TYPES, SHELF_VISUAL_SLOTS_PER_TILE } from "../js/logic/FixtureLayout.js";
import { getFixtureTexture, TEST_SHELF_SURFACE_COLOR } from "../js/logic/FixtureTexture.js";
import { TILE_SIZE } from "../js/logic/RoomLayout.js";
import { getShelfCategoryColor } from "../js/logic/ShelfStockDisplay.js";

function makeScene() {
  const textures = new Map();
  const rects = [];
  let created = 0;
  let destroyed = 0;
  return {
    textures: { exists: (key) => textures.has(key) },
    make: {
      graphics(options) {
        assert.equal(options.add, false);
        created++;
        return {
          fillStyle(color) { this.color = color; return this; },
          fillRect(x, y, width, height) {
            rects.push({ color: this.color, x, y, width, height });
            return this;
          },
          generateTexture(key, width, height) { textures.set(key, { width, height }); },
          destroy() { destroyed++; },
        };
      },
    },
    generated: textures,
    rects,
    counts: () => ({ created, destroyed }),
  };
}

for (const spec of Object.values(FIXTURE_TYPES).filter((entry) => entry.kind === "shelf")) {
  test(`${spec.name} texture fits its tile footprint and leaves a visible front rim`, () => {
    const scene = makeScene();
    const key = getFixtureTexture(scene, spec);
    const width = spec.w * TILE_SIZE;
    const height = spec.h * TILE_SIZE;
    assert.notEqual(key, spec.texture);
    assert.deepEqual(scene.generated.get(key), { width, height });
    assert.deepEqual(scene.rects[1], {
      color: TEST_SHELF_SURFACE_COLOR, x: 2, y: 2, width: width - 4, height: height - 4,
    });
    assert.deepEqual(scene.rects.at(-1), {
      color: 0xb7cad6, x: 2, y: height - 2, width: width - 4, height: 2,
    });
    const slotSize = TILE_SIZE / SHELF_VISUAL_SLOTS_PER_TILE;
    const dividers = scene.rects.slice(2, -1);
    assert.equal(dividers.length, width / slotSize + height / slotSize - 2);
    for (const rect of dividers) {
      assert.ok(rect.width === 2 ? (rect.x + 1) % slotSize === 0 : (rect.y + 1) % slotSize === 0);
    }
    assert.equal(getFixtureTexture(scene, spec), key);
    assert.deepEqual(scene.counts(), { created: 1, destroyed: 1 });
  });
}

test("lockers and registers keep their original graphics without generating textures", () => {
  const scene = makeScene();
  for (const spec of Object.values(FIXTURE_TYPES).filter((entry) => entry.kind !== "shelf")) {
    assert.equal(getFixtureTexture(scene, spec), spec.texture);
  }
  assert.deepEqual(scene.counts(), { created: 0, destroyed: 0 });
});

function luminance(color) {
  const channels = [color >> 16 & 255, color >> 8 & 255, color & 255].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test("every stock category border contrasts against the dark shelf surface", () => {
  const background = luminance(TEST_SHELF_SURFACE_COLOR);
  for (const tag of ["Ammunition", "Apparel", "Armor", "Attachment", "Firearm", "Melee", "Survival", "Tool", "Unknown"]) {
    const color = getShelfCategoryColor({ tags: [tag] });
    // Stock borders are drawn at 90% opacity over the shelf.
    const blended = [16, 8, 0].reduce((result, shift) =>
      result | Math.round(((color >> shift) & 255) * 0.9 +
        ((TEST_SHELF_SURFACE_COLOR >> shift) & 255) * 0.1) << shift, 0);
    assert.ok((luminance(blended) + 0.05) / (background + 0.05) >= 3, tag);
  }
});
