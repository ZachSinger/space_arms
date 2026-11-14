import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FIXTURE_FACINGS, FIXTURE_TYPES, getShelfDisplayGrid } from "../js/logic/FixtureLayout.js";
import { getFixtureTexture } from "../js/logic/FixtureTexture.js";
import { getShelfCategoryColor } from "../js/logic/ShelfStockDisplay.js";

const tilesetManifest = JSON.parse(await readFile(
  new URL("../data/TilesetManifest.json", import.meta.url),
  "utf8",
));

const texturePaths = new Map(tilesetManifest.map(({ key, path }) => [key, path]));
for (const spec of Object.values(FIXTURE_TYPES).filter((entry) => entry.kind === "shelf" && !entry.facingTextures)) {
  test(`${spec.name} uses its registered artwork in every facing`, () => {
    assert.ok(texturePaths.has(spec.texture), `${spec.texture} is listed in the tileset manifest`);
    for (let rotation = 0; rotation < FIXTURE_FACINGS.length; rotation++) {
      assert.equal(getFixtureTexture(spec, rotation), spec.texture);
    }
  });
}

test("the budget shelf uses a facing-specific image on a one-tile-deep footprint", () => {
  const spec = FIXTURE_TYPES.shelf_budget_2x2;
  assert.deepEqual({ w: spec.w, h: spec.h }, { w: 1.125, h: 1 });
  assert.deepEqual(FIXTURE_FACINGS.map((facing) => spec.facingTextures[facing]), [
    "shelf_budget_2x2_down",
    "shelf_budget_2x2_left",
    "shelf_budget_2x2_up",
    "shelf_budget_2x2_right",
  ]);
  for (let rotation = 0; rotation < FIXTURE_FACINGS.length; rotation++) {
    assert.equal(getFixtureTexture(spec, rotation), spec.facingTextures[FIXTURE_FACINGS[rotation]]);
  }
});

test("each budget shelf size has four registered facings and the right display grid", () => {
  const paths = new Map(tilesetManifest.map(({ key, path }) => [key, path]));
  const types = ["2x2", "2x3", "2x4", "3x2", "3x3", "3x4"];
  for (const size of types) {
    const spec = FIXTURE_TYPES[`shelf_budget_${size}`];
    const [levels, columns] = size.split("x").map(Number);
    assert.deepEqual(getShelfDisplayGrid(spec), { w: columns, h: levels });
    for (const facing of FIXTURE_FACINGS) {
      const key = spec.facingTextures[facing];
      const path = paths.get(key);
      assert.ok(path, `${key} is listed in the tileset manifest`);
      assert.equal(getFixtureTexture(spec, FIXTURE_FACINGS.indexOf(facing)), key);
    }
  }
});

test("non-shelf fixtures keep their original graphics", () => {
  for (const spec of Object.values(FIXTURE_TYPES).filter((entry) => entry.kind !== "shelf")) {
    assert.equal(getFixtureTexture(spec), spec.texture);
  }
});

function luminance(color) {
  const channels = [color >> 16 & 255, color >> 8 & 255, color & 255].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test("every stock category border contrasts against the stock marker fill", () => {
  const stockMarkerFill = 0x111827;
  const background = luminance(stockMarkerFill);
  for (const tag of ["Ammunition", "Apparel", "Armor", "Attachment", "Firearm", "Melee", "Survival", "Tool", "Unknown"]) {
    const color = getShelfCategoryColor({ tags: [tag] });
    const blended = [16, 8, 0].reduce((result, shift) =>
      result | Math.round(((color >> shift) & 255) * 0.9 +
        ((stockMarkerFill >> shift) & 255) * 0.1) << shift, 0);
    assert.ok((luminance(blended) + 0.05) / (background + 0.05) >= 3, tag);
  }
});
