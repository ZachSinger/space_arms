import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { FIXTURE_TYPES } from "../js/logic/FixtureLayout.js";

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
