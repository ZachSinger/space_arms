import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FIXTURE_FACINGS, FIXTURE_TYPES, getShelfDisplayGrid } from "../js/logic/FixtureLayout.js";
import { getFixtureTexture } from "../js/logic/FixtureTexture.js";
import { budgetShelfSideTexture, ensureBudgetShelfSideTextures } from "../js/logic/BudgetShelfArt.js";

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
    const key = spec.facingTextures[FIXTURE_FACINGS[rotation]];
    assert.equal(getFixtureTexture(spec, rotation), rotation % 2 ? budgetShelfSideTexture(key) : key);
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
      const rotation = FIXTURE_FACINGS.indexOf(facing);
      assert.equal(getFixtureTexture(spec, rotation), rotation % 2 ? budgetShelfSideTexture(key) : key);
    }
  }
});

test("narrow shelf textures keep their original edges and remove the middle without stretching", () => {
  const textures = new Map();
  for (const spec of Object.values(FIXTURE_TYPES).filter((entry) => entry.artLayout === "budget")) {
    for (const facing of ["left", "right"]) {
      const pixels = Uint8Array.from({ length: 192 * 2 }, (_, index) => {
        const x = index % 192;
        return x >= 32 && x < 160 ? (x + Math.floor(index / 192)) : 0;
      });
      textures.set(spec.facingTextures[facing], { getSourceImage: () => ({ width: 192, height: 2, pixels }) });
    }
  }
  let created = 0;
  const scene = { textures: {
    exists: (key) => textures.has(key),
    get: (key) => textures.get(key),
    createCanvas(key, width, height) {
      created += 1;
      const pixels = new Uint8Array(width * height);
      const texture = {
        context: {
          drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh) {
            assert.equal(sw, dw);
            assert.equal(sh, dh);
            for (let y = 0; y < sh; y++) {
              pixels.set(source.pixels.subarray((sy + y) * width + sx, (sy + y) * width + sx + sw),
                (dy + y) * width + dx);
            }
          },
        },
        getSourceImage: () => ({ width, height, pixels }),
        refresh() { return this; },
        setFilter() { return this; },
      };
      textures.set(key, texture);
      return texture;
    },
  } };

  ensureBudgetShelfSideTextures(scene, FIXTURE_TYPES);
  ensureBudgetShelfSideTextures(scene, FIXTURE_TYPES);
  assert.equal(created, 12, "one reusable texture for each shelf and side");
  for (const spec of Object.values(FIXTURE_TYPES).filter((entry) => entry.artLayout === "budget")) {
    for (const facing of ["left", "right"]) {
      const key = spec.facingTextures[facing];
      const original = textures.get(key).getSourceImage().pixels;
      const narrowed = textures.get(budgetShelfSideTexture(key)).getSourceImage().pixels;
      for (let row = 0; row < 2; row++) {
        const source = original.subarray(row * 192, (row + 1) * 192);
        const expected = [...new Uint8Array(32), ...source.subarray(0, 64),
          ...source.subarray(128), ...new Uint8Array(32)];
        assert.deepEqual([...narrowed.subarray(row * 192, (row + 1) * 192)], expected, `${key}, row ${row}`);
      }
    }
  }
});

test("non-shelf fixtures keep their original graphics", () => {
  for (const spec of Object.values(FIXTURE_TYPES).filter((entry) => entry.kind !== "shelf")) {
    assert.equal(getFixtureTexture(spec), spec.texture);
  }
});

