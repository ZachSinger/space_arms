import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import licenses from "../data/Licenses.json" with { type: "json" };
import {
  BASIC_FIXTURES, FIXTURE_TYPES, fixtureArtInset, fixtureBounds, fixtureFootprint,
  fixtureSolidBounds, validateFixtureLayout,
} from "../js/logic/FixtureLayout.js";
import { FixtureRegistry } from "../js/logic/FixtureRegistry.js";
import { FixturePlacement } from "../js/logic/FixturePlacement.js";
import { LayoutRenderer } from "../js/logic/LayoutRenderer.js";
import { TILE_SIZE } from "../js/logic/RoomLayout.js";
import {
  DECORATION_FRAMES, createDecorationTextures, decorationFrameKey,
} from "../js/world/DecorationArt.js";

// Replace only the browser scene's database; no browser, server, or renderer is started.
const bootURL = new URL("../js/scenes/boot.js", import.meta.url).href;
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url !== bootURL) return nextLoad(url, context);
    return {
      format: "module", shortCircuit: true,
      source: `export const database = { getLicense: (id) => ({ id, name: "Basic Fixture Supply" }) };`,
    };
  },
});
const { FixtureSystem } = await import("../js/systems/FixtureSystem.js");
const { createFixtureModel, Shop } = await import("../js/state/slices/Shop.js");
hooks.deregister();

const decorations = Object.values(FIXTURE_TYPES).filter((spec) => spec.kind === "decoration");

function textureScene() {
  const textures = new Map();
  let destroyed = 0;
  return {
    textures: {
      exists: (key) => textures.has(key),
      getBase64: (key) => `data:image/png;base64,${key}`,
    },
    made: textures,
    get destroyed() { return destroyed; },
    make: { graphics: () => {
      let alpha;
      const pixels = new Map();
      return {
        fillStyle(_color, opacity) { alpha = opacity; return this; },
        fillRect(x, y, w, h) {
          for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
            const key = `${px},${py}`;
            pixels.set(key, [...(pixels.get(key) ?? []), alpha]);
          }
          return this;
        },
        generateTexture(key, w, h) { textures.set(key, { w, h, pixels }); },
        destroy() { destroyed += 1; },
      };
    } },
  };
}

test("the catalog exposes 20 distinct motifs and pixel designs through Basic Fixture Supply", () => {
  assert.equal(decorations.length, 20);
  assert.deepEqual(["hologram", "banner", "light"].map((family) =>
    decorations.filter((spec) => spec.artFamily === family).length), [10, 6, 4]);
  assert.equal(new Set(decorations.map((spec) => spec.motif)).size, 20);
  const contract = licenses.find((license) => license.id === "lic_fixture_basics");
  const scene = textureScene();
  createDecorationTextures(scene);
  createDecorationTextures(scene);
  assert.equal(scene.made.size, 20 * DECORATION_FRAMES);
  assert.equal(scene.destroyed, 20 * DECORATION_FRAMES, "art is initialized once, not regenerated for previews");
  const signatures = new Set();
  for (const spec of decorations) {
    assert.ok(contract.unlocksFixtures.includes(spec.id));
    const art = scene.made.get(spec.texture);
    const inset = fixtureArtInset({ type: spec.id });
    const frames = new Set();
    for (let frame = 0; frame < DECORATION_FRAMES; frame++) {
      const key = decorationFrameKey(spec, frame);
      const image = scene.made.get(key);
      assert.deepEqual([image.w, image.h], [spec.w * TILE_SIZE, spec.h * TILE_SIZE]);
      for (const coordinate of image.pixels.keys()) {
        const [x, y] = coordinate.split(",").map(Number);
        assert.ok(x >= inset.left * TILE_SIZE && x < image.w - inset.right * TILE_SIZE &&
          y >= inset.top * TILE_SIZE && y < image.h - inset.bottom * TILE_SIZE,
        `${key} artwork fits its declared margins at ${coordinate}`);
      }
      frames.add(JSON.stringify([...image.pixels].sort(([a], [b]) => a.localeCompare(b))));
    }
    assert.equal(frames.size, DECORATION_FRAMES, `${spec.id} animates through distinct frames`);
    // Ignore all colors: recolors produce the same geometry and cannot pass this check.
    signatures.add(JSON.stringify([...art.pixels].sort(([a], [b]) => a.localeCompare(b))));
  }
  assert.equal(signatures.size, 20, "each design must change the drawing, not only its color");
});

test("every decoration fits ordinary layout validation, creates a plain model, and round-trips through shop saves", () => {
  for (const spec of decorations) {
    const placement = { id: spec.id, type: spec.id, gx: 5, gy: 5, rotation: 0 };
    const result = validateFixtureLayout([...BASIC_FIXTURES, placement], {
      isWalkable: (gx, gy) => gx >= 0 && gx < 24 && gy >= 0 && gy < 16,
      entrance: { gx: 10, gy: 14 },
      gridSize: { gridW: 24, gridH: 16 },
    });
    assert.equal(result.valid, true, `${spec.id}: ${result.reason}`);
    const model = createFixtureModel(placement);
    assert.equal(model.type, spec.id);
    assert.equal(model.placements, undefined, "decorations are not stock shelves");
    const bounds = fixtureBounds(placement);
    const solid = fixtureSolidBounds(placement);
    assert.equal(solid.bottom, bounds.bottom);
    assert.equal(solid.bottom - solid.top, 0.25, "walkers collide with the base, not projected art");
    const shop = new Shop();
    shop.fixtures.add(model);
    const restored = Shop.fromSave(shop.toSave());
    assert.deepEqual(restored.fixtures.layout(), [placement]);
    assert.deepEqual(fixtureFootprint(placement), { w: spec.w, h: spec.h });
  }
});

function fixtureScene() {
  const delivered = [];
  const body = {};
  for (const method of ["setSize", "setAllowGravity", "setAllowRotation", "setBounce",
    "setBoundsRectangle", "setCollideWorldBounds", "setOffset", "updateFromGameObject", "stop"]) {
    body[method] = () => body;
  }
  const scene = {
    fixtures: new FixtureRegistry(),
    gameState: {
      catalog: { owns: (id) => id === "lic_fixture_basics" },
      economy: {
        credits: 100000, spend(amount) { this.credits -= amount; },
        add(amount) { this.credits += amount; },
      },
      staff: { registerAssignments: {} },
      shop: { changed() {} },
    },
    areas: { playerArea: "backroom" },
    supply: {
      firstFreePadSpot: () => ({ x: 128, y: 128 }),
      takePadSpots: () => [{ x: 128, y: 128 }],
      deliver: (crate) => delivered.push(crate),
      freePlayerFromPad() {},
    },
    add: { image: (x, y) => ({
      x, y, scaleX: 1, scaleY: 1, body,
      setDisplaySize(w, h) { this.displayHeight = h; return this; },
      setDepth() { return this; },
      setOrigin() { return this; },
      destroy() { this.destroyed = true; },
    }) },
    crateGroup: { add() {} },
    fixtureViews: { show: (fixture) => fixture, hide() {} },
    crateSystem: {
      motionPaused: false,
      removeCarriedCrate: () => { scene.carriedCrate = null; },
      getCarriedCrates: () => scene.carriedCrate ? [scene.carriedCrate] : [],
    },
    restockCrates: [],
    messages: { show: (reason) => assert.fail(reason) },
  };
  const system = new FixtureSystem(scene);
  for (const entry of BASIC_FIXTURES) scene.fixtures.add(createFixtureModel(entry));
  system.canRearrange = () => true;
  system.layoutOptions = () => ({
    isWalkable: (gx, gy) => gx >= 0 && gx < 24 && gy >= 0 && gy < 16,
    entrance: { gx: 10, gy: 14 }, gridSize: { gridW: 24, gridH: 16 },
    requireSalesFloor: false,
  });
  system.checkPlacement = (type, gx, gy, rotation) => validateFixtureLayout(
    [...scene.fixtures.layout(), { id: "next", type, gx, gy, rotation }], system.layoutOptions(),
  );
  system.applyLayout = () => {};
  scene.fixtureSystem = system;
  return { scene, system, delivered };
}

test("all 20 designs can be bought, delivered, started from a crate in the backroom, and placed as normal fixtures", () => {
  for (const spec of decorations) {
    const { scene, system, delivered } = fixtureScene();
    assert.ok(system.purchaseOptions().some((option) => option.spec.id === spec.id && option.licensed));
    const credits = scene.gameState.economy.credits;
    assert.equal(system.buy(spec.id), true);
    assert.equal(scene.gameState.economy.credits, credits - spec.price);
    const crate = delivered[0];
    assert.equal(crate.kind, "fixture");
    assert.equal(crate.typeId, spec.id);
    scene.carriedCrate = crate;
    const placement = Object.assign(Object.create(FixturePlacement.prototype), { scene });
    let started = false;
    placement.start = () => { started = true; return true; };
    assert.equal(placement.beginFromCrate(crate), true);
    assert.equal(started, true);
    assert.equal(system.placeFromCrate(crate, 5, 5), true);
    assert.equal(scene.fixtures.ofKind("decoration").length, 1);
    assert.equal(scene.carriedCrate, null);
    assert.equal(crate.sprite.destroyed, true);
    assert.equal(system.crateBlockReason(scene.fixtures.ofKind("decoration")[0]), null);
    assert.equal(system.saleBlockReason(scene.fixtures.ofKind("decoration")[0]), null);
  }
});

test("decorations support empty-hand hold-to-move, crating, and half-price resale through the shared fixture system", () => {
  const { scene, system, delivered } = fixtureScene();
  const type = "decor_banner_compass";
  assert.equal(system.buy(type), true);
  scene.carriedCrate = delivered[0];
  assert.equal(system.placeFromCrate(scene.carriedCrate, 5, 5), true);
  const fixture = scene.fixtures.ofKind("decoration")[0];
  scene.areas = { playerArea: "shop", nearbyPortal: () => null };
  scene.controlMode = { allows: () => true };
  scene.checkoutSystem = {};
  scene.interactables = { findTarget: () => null };
  scene.player = { currentFacing: "down", sprite: { x: 0, y: 0 } };
  scene.interactionSystem = {
    getInteractionOrigin: () => ({ x: 0, y: 0 }),
    isPlayerFacingFixture: (candidate) => candidate === fixture,
    feetReachTo: () => 12,
  };
  assert.equal(system.getHoldToMoveFixture(), fixture);
  scene.interactionSystem.feetReachTo = () => 100;
  assert.equal(system.getHoldToMoveFixture(), null, "distant decorations cannot be grabbed");
  assert.equal(system.crate(fixture.id), true);
  assert.equal(scene.fixtures.ofKind("decoration").length, 0);
  const crate = scene.restockCrates[0];
  assert.equal(crate.typeId, type);
  scene.restockCrates = [];
  scene.carriedCrate = crate;
  assert.equal(system.placeFromCrate(crate, 5, 5), true);
  const credits = scene.gameState.economy.credits;
  assert.equal(system.sell(scene.fixtures.ofKind("decoration")[0].id), true);
  assert.equal(scene.fixtures.ofKind("decoration").length, 0);
  assert.equal(scene.gameState.economy.credits, credits + FIXTURE_TYPES[type].price / 2);
});

test("decoration purchase cards show generated texture previews and explain points and duplicate variety", () => {
  const textures = textureScene();
  createDecorationTextures(textures);
  const { scene, system } = fixtureScene();
  scene.textures = textures.textures;
  const markup = LayoutRenderer.generateHTML(scene, true);
  assert.equal([...markup.matchAll(/class="fixture-art-preview"/g)].length, 20);
  assert.match(markup, /src="data:image\/png;base64,decor_holo_planet"/);
  assert.match(markup, /Adds 3 to PRESENTATION when placed on the sales floor/);
  assert.match(markup, /plus 1 more the first time this design is out there/);
  assert.match(markup, /Adds nothing in the backroom or once PRESENTATION is at its maximum/);
  scene.gameState.catalog.owns = () => false;
  assert.equal(system.buy(decorations[0].id), false);
  assert.match(LayoutRenderer.generateHTML(scene, true), /Needs contract: Basic Fixture Supply/);
});
