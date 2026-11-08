import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { FIXTURE_TYPES } from "../js/logic/FixtureLayout.js";
import { LayoutRenderer } from "../js/logic/LayoutRenderer.js";

const licenses = JSON.parse(await readFile(
  new URL("../data/Licenses.json", import.meta.url),
  "utf8",
));
const licenseById = new Map(licenses.map((license) => [license.id, license]));

test("each fixture type is unlocked by its configured license", () => {
  for (const spec of Object.values(FIXTURE_TYPES)) {
    assert.ok(licenseById.get(spec.licenseId)?.unlocksFixtures.includes(spec.id));
  }
});

test("the large shelf costs 2000 credits while the compact shelf remains 300", () => {
  assert.equal(FIXTURE_TYPES.shelf_starter_2x1.price, 300);
  assert.equal(FIXTURE_TYPES.shelf_universal.price, 2000);
  assert.equal(FIXTURE_TYPES.shelf_universal.name, "LARGE SHELF");
});

test("the starter contract allows the compact shelf but not the large shelf", () => {
  const starter = licenseById.get("lic_fixture_basics");
  assert.ok(starter.unlocksFixtures.includes("shelf_starter_2x1"));
  assert.ok(!starter.unlocksFixtures.includes("shelf_universal"));
  assert.equal(FIXTURE_TYPES.shelf_starter_2x1.licenseId, "lic_fixture_basics");
  assert.notEqual(FIXTURE_TYPES.shelf_universal.licenseId, "lic_fixture_basics");
  assert.ok(licenseById.get(FIXTURE_TYPES.shelf_universal.licenseId).baseCost > 0);
});

test("a locked fixture names the contract to sign", () => {
  const spec = FIXTURE_TYPES.shelf_universal;
  const html = LayoutRenderer.generateHTML({
    canRearrangeFixtures: () => true,
    fixtures: { all: () => [] },
    getFixturePurchaseOptions: () => [{
      spec, license: licenseById.get(spec.licenseId), licensed: false,
      canAfford: true, uniqueAlreadyPlaced: false, hasDeliverySpace: true,
    }],
  }, true);
  assert.match(html, /NEEDS CONTRACT: Expanded Fixture Supply \(Contracts tab\)/);
  assert.match(html, /disabled>LOCKED/);
});

test("fixture purchases explain shelving, storage, checkout, and floor space", () => {
  const html = LayoutRenderer.generateHTML({
    canRearrangeFixtures: () => true,
    fixtures: { all: () => [] },
    getFixturePurchaseOptions: () => Object.values(FIXTURE_TYPES).map((spec) => ({
      spec, licensed: true, canAfford: true, uniqueAlreadyPlaced: false, hasDeliverySpace: true,
    })),
  }, true);
  assert.match(html, /SHELVING - displays items for customers/);
  assert.match(html, /STORAGE - holds stock for restocking/);
  assert.match(html, /CHECKOUT - serves customers/);
  assert.match(html, /2 x 1 floor tiles/);
  assert.match(html, /3 x 2 floor tiles/);
  assert.match(html, /PRICE 2000 credits/);
});

test("fixtures tab offers resale with a clear value and a confirmation", () => {
  const locker = { id: "locker_1", type: "locker_single", gx: 1, gy: 1 };
  const padCrate = { kind: "fixture", typeId: "shelf_starter_2x1", lockedToPad: true };
  const scene = {
    canRearrangeFixtures: () => true,
    fixtures: { all: () => [locker], displayName: () => "LOCKER" },
    restockCrates: [padCrate],
    carriedCrate: { kind: "fixture", typeId: "locker_single" },
    getFixturePurchaseOptions: () => [],
    getFixtureCrateBlockReason: () => null,
    canCrateFixture: () => true,
    getFixtureSaleBlockReason: () => null,
    getFixtureCrateSaleBlockReason: () => null,
  };
  const html = LayoutRenderer.generateHTML(scene, true, "Purchase complete.", { name: "LOCKER", value: 90 });
  assert.match(html, /Sell LOCKER for 90 credits\?/);
  assert.match(html, /data-confirm-fixture-sale/);
  assert.match(html, /data-cancel-fixture-sale/);
  assert.match(html, /data-sell-fixture-id="locker_1"/);
  assert.match(html, /data-sell-fixture-crate="0"/);
  assert.match(html, /data-sell-fixture-crate="carried"/);
  assert.match(html, /Loading Pad \| Resale value: 150 credits/);
  assert.ok(html.indexOf("Purchase complete.") < html.indexOf("fixture-management-scroll"));
  assert.ok(html.indexOf("layout-sale-confirmation") < html.indexOf("fixture-management-scroll"));

  scene.getFixtureSaleBlockReason = () => "Only empty fixtures can be sold.";
  const blocked = LayoutRenderer.generateHTML(scene, true);
  assert.match(blocked, /<small>Only empty fixtures can be sold\.<\/small>/);
  assert.match(blocked, /data-sell-fixture-id="locker_1"[\s\S]*?disabled>SELL/);
});

test("early supplier license prices reflect the value of their item catalogs", () => {
  const expectedPrices = {
    lic_start_rations: 25,
    lic_start_mods: 75,
    lic_start_apparel: 100,
    lic_start_ammo: 100,
    lic_start_armor_melee: 200,
    lic_start_tools: 250,
  };

  for (const [licenseId, price] of Object.entries(expectedPrices)) {
    assert.equal(licenseById.get(licenseId)?.baseCost, price, licenseId);
  }
});
