// Golden saves: real saves captured from the pre-rebuild game (scripts/browser/make-golden-saves.mjs).
// Every rebuild step must still read each one exactly the way the original game did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseManager } from "../js/logic/DatabaseManager.js";
import { validateShopSave } from "../js/logic/ShopSave.js";
import { SHOP_LAYOUT_VERSION } from "../js/state/migrations/index.js";
import { upgradeContractSplit } from "../js/state/migrations/contractSplit.js";

const dir = new URL("./golden-saves/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
const database = new DatabaseManager();
database.loadItemsJSON(JSON.parse(readFileSync(new URL("../data/Items.json", import.meta.url), "utf8")));
database.loadLicensesJSON(JSON.parse(readFileSync(new URL("../data/Licenses.json", import.meta.url), "utf8")));

const names = readdirSync(dir)
  .filter((file) => file.endsWith(".json") && !file.includes(".expected") && !file.includes(".resaved"))
  .map((file) => file.replace(/\.json$/, ""));

test("golden saves exist", () => {
  assert.deepEqual(names.sort(), ["before-contract-split", "crates-in-motion", "expanded-shop",
    "mid-game", "new-game", "older-layout", "trash"]);
});

for (const name of names) {
  test(`golden save "${name}" loads exactly as before the rebuild`, () => {
    // The contract split used to happen while loading the player; it now happens in the save upgrade.
    assert.deepEqual(validateShopSave(read(`${name}.json`), database),
      upgradeContractSplit(read(`${name}.expected.json`)));
  });

  test(`golden save "${name}" is unchanged by a second check`, () => {
    const once = validateShopSave(read(`${name}.json`), database);
    assert.deepEqual(validateShopSave(JSON.parse(JSON.stringify(once)), database), once);
  });

  test(`golden save "${name}" is never changed by upgrading it`, () => {
    const original = read(`${name}.json`);
    const copy = structuredClone(original);
    validateShopSave(original, database);
    assert.deepEqual(original, copy);
  });
}

test("the contract split only adds follow-up contracts to saves from before it", () => {
  const before = read("before-contract-split.json");
  const upgraded = validateShopSave(before, database);
  const added = upgraded.playerState.activeLicenses.filter((id) => !before.playerState.activeLicenses.includes(id));
  assert.ok(added.length > 0);
  assert.equal(upgraded.playerState.contractsSplit, true);
  // A save from after the split may own a parent contract without its follow-up; leave it alone.
  const after = { ...upgraded, playerState: { ...upgraded.playerState,
    activeLicenses: upgraded.playerState.activeLicenses.filter((id) => !added.includes(id)) } };
  assert.deepEqual(validateShopSave(after, database).playerState.activeLicenses, after.playerState.activeLicenses);
});

test("older layout save refunds retired equipment and drops it", () => {
  const raw = read("older-layout.json");
  const loaded = validateShopSave(read("older-layout.json"), database);
  assert.equal(loaded.layoutVersion, SHOP_LAYOUT_VERSION);
  assert.ok(loaded.playerState.credits > raw.playerState.credits);
  assert.ok(!loaded.fixtures.some((fixture) => fixture.type === "shelf_bulk"));
  assert.ok(!loaded.crates.some((crate) => crate.typeId === "locker_single"));
  assert.ok(!loaded.playerState.activeLicenses.includes("lic_fixture_expanded"));
});

test("crates-in-motion save keeps carried, stacked and thrown crates", () => {
  const loaded = validateShopSave(read("crates-in-motion.json"), database);
  assert.equal(loaded.carriedCrates.length, 3);
  assert.ok(loaded.crates.some((crate) => crate.stack?.length === 2));
  assert.ok(loaded.crates.some((crate) => crate.launch || crate.flight));
});
