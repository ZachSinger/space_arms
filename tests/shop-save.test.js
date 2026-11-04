import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SaveManager, createSaveStorage, SAVE_STORAGE_KEY } from "../SaveManager.js";
import { DatabaseManager } from "../js/logic/DatabaseManager.js";
import { STARTING_FIXTURES, getFixtureType } from "../js/logic/FixtureLayout.js";
import { Market } from "../js/logic/Market.js";
import { validateShopSave } from "../js/logic/ShopSave.js";

const database = new DatabaseManager();
database.loadItemsJSON(JSON.parse(await readFile(new URL("../data/Items.json", import.meta.url), "utf8")));
database.loadLicensesJSON(JSON.parse(await readFile(new URL("../data/Licenses.json", import.meta.url), "utf8")));

function snapshot() {
  return {
    playerState: {
      credits: 1500, globalReputation: 2, customersTurnedAway: 0,
      factionReputation: { scavengers: 0, mercenaries: -1, explorers: 3 },
      activeLicenses: ["lic_corp_aulin"], storePrices: { wpn_rif_01: 123 },
      hovercart: { capacity: 10, stock: [{ itemId: "amo_01", quantity: 2 }] },
      goBacks: [{ itemId: "wpn_rif_01", quantity: 40 }],
    },
    market: new Market(database.getAllItems(), () => 0.5).serialize(),
    fixtures: STARTING_FIXTURES.map(({ id, type, gx, gy }) => ({
      id, type, gx, gy,
      ...(getFixtureType(type).kind === "shelf" ? { placements: [{
        itemId: "wpn_rif_01", gx: 0, gy: 0, w: 2, h: 1, rotated: false, quantity: 3,
      }] } : {}),
      ...(getFixtureType(type).kind === "storage" ? { stock: [{ itemId: "srv_01", quantity: 5 }] } : {}),
    })),
    unlockedZones: ["storeroom", "sales_floor", "loading_pad"],
    crates: [{ itemId: "wpn_rif_01", quantity: 5, x: 192, y: 640, velocityX: 120, velocityY: 0 }],
    carriedCrate: { itemId: "srv_01", quantity: 2 },
  };
}

test("shop saves preserve layout, all inventory locations, prices, factions, and market state", async () => {
  const entries = new Map();
  const storage = createSaveStorage({ localStorage: {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  } });
  const data = snapshot();
  const manager = new SaveManager({ shop: { serialize: () => data } }, storage);
  assert.equal(await manager.read(), null);
  await manager.save();
  assert.ok(entries.has(SAVE_STORAGE_KEY));
  const restored = await manager.read();
  assert.deepEqual(validateShopSave(restored.data.shop, database), data);
  let applied;
  const loader = new SaveManager({ shop: { applySave: (value) => { applied = value; } } }, storage);
  assert.equal(await loader.load(), true);
  assert.deepEqual(applied, data);
});

test("desktop saving uses IPC, and failures never silently fall back to browser storage", async () => {
  let stored = null;
  const storage = createSaveStorage({
    desktopApi: {
      loadGame: async () => stored,
      saveGame: async (value) => { stored = structuredClone(value); return true; },
    },
    get localStorage() { throw new Error("Browser storage must not be used"); },
  });
  const manager = new SaveManager({ shop: { serialize: snapshot } }, storage);
  await manager.save();
  assert.deepEqual((await manager.read()).data.shop, snapshot());
  const failing = new SaveManager({}, createSaveStorage({ desktopApi: {
    loadGame: async () => { throw new Error("disk read failed"); },
    saveGame: async () => { throw new Error("disk full"); },
  } }));
  await assert.rejects(() => failing.read(), /disk read failed/);
  await assert.rejects(() => failing.save(), /disk full/);
});

test("unreadable, unsupported, or incomplete saves are rejected", async () => {
  for (const payload of [false, {}, { version: 99 }, { version: 1, data: {} }]) {
    const manager = new SaveManager({}, { read: async () => payload });
    await assert.rejects(() => manager.read());
  }
  const malformed = new SaveManager({}, createSaveStorage({
    localStorage: { getItem: () => "{broken" },
  }));
  await assert.rejects(() => malformed.read(), SyntaxError);
  await assert.rejects(() => new SaveManager({}, { write: async () => false }).save(), /could not be written/);
});

test("invalid saved inventory and economy are rejected before restoration", () => {
  const corruptions = [
    (data) => { data.playerState.credits = NaN; },
    (data) => { data.playerState.activeLicenses.push("unknown"); },
    (data) => { data.playerState.hovercart.stock[0].quantity = 999; },
    (data) => { data.playerState.storePrices.wpn_rif_01 = 0; },
    (data) => { data.market.day = 0; },
    (data) => { data.market.prices.wpn_rif_01 = 100000; },
    (data) => { data.market.supplyRatios.wpn_rif_01 = 0; },
    (data) => { data.fixtures[0].placements[0].quantity = 99; },
    (data) => { data.fixtures[0].placements.push({ ...data.fixtures[0].placements[0] }); },
    (data) => { data.fixtures[1].stock[0].itemId = "unknown"; },
    (data) => { data.fixtures[1].gx = 1.5; },
    (data) => { data.fixtures[1].type = "unknown"; },
    (data) => { data.fixtures[1].id = data.fixtures[0].id; },
    (data) => { data.unlockedZones = []; },
    (data) => { data.crates[0].quantity = 0; },
    (data) => { data.carriedCrate.itemId = "unknown"; },
    (data) => { data.playerState.goBacks[0].itemId = "unknown"; },
    (data) => { data.playerState.goBacks[0].quantity = 0; },
    (data) => { data.playerState.goBacks = {}; },
  ];
  for (const corrupt of corruptions) {
    const data = snapshot();
    corrupt(data);
    assert.throws(() => validateShopSave(data, database), /Invalid saved game/);
  }
});

test("saves from before the Go-Backs bin existed still load", () => {
  const data = snapshot();
  delete data.playerState.goBacks;
  assert.doesNotThrow(() => validateShopSave(data, database));
});

test("saves from before fixture types existed load with types filled in", () => {
  const legacy = snapshot();
  legacy.fixtures[0].type = "shelf_universal";
  for (const entry of legacy.fixtures) delete entry.type;
  const migrated = validateShopSave(legacy, database);
  assert.deepEqual(migrated.fixtures, snapshot().fixtures.map((fixture, index) =>
    index === 0 ? { ...fixture, type: "shelf_universal" } : fixture));
  assert.equal(legacy.fixtures[0].type, undefined);
});

test("fixture crates can be saved on the floor or carried", () => {
  const data = snapshot();
  data.crates.push({
    kind: "fixture", typeId: "shelf_universal", x: 320, y: 640, velocityX: 0, velocityY: 0,
  });
  data.carriedCrate = { kind: "fixture", typeId: "locker_single" };
  assert.deepEqual(validateShopSave(data, database), data);

  data.carriedCrate.typeId = "unknown";
  assert.throws(() => validateShopSave(data, database), /unknown fixture crate/);
});

test("older saves with shelf stacks over the new per-slot cap still load", () => {
  const data = snapshot();
  data.fixtures[0].placements[0].quantity = 4; // rifle: legacy 12 / 3 = 4, current cap 3
  assert.doesNotThrow(() => validateShopSave(data, database));
  data.fixtures[0].placements[0].quantity = 5;
  assert.throws(() => validateShopSave(data, database), /shelf stack does not fit/);
});

test("shelf saves validate against the tile-derived visual grid", () => {
  const data = snapshot();
  data.fixtures[0].type = "shelf_universal";
  data.fixtures[0].placements[0].gx = 4;
  data.fixtures[0].placements[0].gy = 3;
  assert.doesNotThrow(() => validateShopSave(data, database));

  data.fixtures[0].placements[0].gx = 5;
  assert.throws(() => validateShopSave(data, database), /shelf stack does not fit/);
});

test("compact starter shelf saves validate against its smaller visual grid", () => {
  const data = snapshot();
  data.fixtures[0].placements[0].gx = 2;
  data.fixtures[0].placements[0].gy = 1;
  assert.doesNotThrow(() => validateShopSave(data, database));

  data.fixtures[0].placements[0].gx = 4;
  assert.throws(() => validateShopSave(data, database), /shelf stack does not fit/);
});
