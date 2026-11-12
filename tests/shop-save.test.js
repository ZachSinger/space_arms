import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SaveManager, createSaveStorage, SAVE_STORAGE_KEY } from "../SaveManager.js";
import { DatabaseManager } from "../js/logic/DatabaseManager.js";
import { STARTING_FIXTURES, getFixtureType } from "../js/logic/FixtureLayout.js";
import { Market } from "../js/logic/Market.js";
import { SHOP_LAYOUT_VERSION, validateShopSave } from "../js/logic/ShopSave.js";

const database = new DatabaseManager();
database.loadItemsJSON(JSON.parse(await readFile(new URL("../data/Items.json", import.meta.url), "utf8")));
database.loadLicensesJSON(JSON.parse(await readFile(new URL("../data/Licenses.json", import.meta.url), "utf8")));

function snapshot() {
  return {
    playerState: {
      credits: 1500, globalReputation: 2, customersTurnedAway: 0,
      factionReputation: { scavengers: 0, mercenaries: -1, explorers: 3 },
      hiredEmployees: [],
      activeLicenses: ["lic_corp_aulin"], storePrices: { wpn_rif_01: 123 },
      hovercart: { capacity: 10, stock: [{ itemId: "amo_01", quantity: 2 }] },
      goBacks: [{ itemId: "wpn_rif_01", quantity: 40 }],
    },
    market: new Market(database.getAllItems(), () => 0.5).serialize(),
    fixtures: [
      { id: "fixture_demo_01", type: "shelf_starter_2x1", gx: 16, gy: 6 },
      ...STARTING_FIXTURES,
    ].map(({ id, type, gx, gy }) => ({
      id, type, gx, gy,
      ...(getFixtureType(type).kind === "shelf" ? { placements: [{
        itemId: "wpn_rif_01", gx: 0, gy: 0, w: 2, h: 1, rotated: false, quantity: 3,
      }] } : {}),
      ...(getFixtureType(type).kind === "storage" ? { stock: [{ itemId: "srv_01", quantity: 5 }] } : {}),
    })),
    unlockedZones: ["storeroom", "sales_floor", "loading_pad"],
    crates: [{ itemId: "wpn_rif_01", quantity: 5, x: 132, y: 6656, velocityX: 120, velocityY: 0 }],
    carriedCrate: { itemId: "srv_01", quantity: 2 },
    layoutVersion: SHOP_LAYOUT_VERSION,
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

test("shop saves preserve three carried crates in order and reject stacks over the limit", async () => {
  const data = snapshot();
  const lower = { kind: "item", itemId: "amo_01", quantity: 2 };
  const middle = { kind: "item", itemId: "srv_01", quantity: 1 };
  const top = { kind: "item", itemId: "wpn_rif_01", quantity: 1 };
  data.carriedCrates = [lower, middle];
  data.carriedCrate = middle;
  assert.deepEqual(validateShopSave(data, database), data);

  data.carriedCrates.push(top);
  data.carriedCrate = top;
  assert.deepEqual(validateShopSave(data, database), data);
  const entries = new Map();
  const storage = createSaveStorage({ localStorage: {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  } });
  const manager = new SaveManager({ shop: { serialize: () => data } }, storage);
  await manager.save();
  let applied;
  const loader = new SaveManager({ shop: { applySave: (value) => { applied = value; } } }, storage);
  assert.equal(await loader.load(), true);
  assert.deepEqual(validateShopSave(applied, database).carriedCrates, [lower, middle, top]);
  assert.deepEqual(applied.carriedCrate, top);

  const fourth = { kind: "item", itemId: "amo_01", quantity: 1 };
  data.carriedCrates.push(fourth);
  data.carriedCrate = fourth;
  assert.throws(() => validateShopSave(data, database), /invalid carried crate stack/);
});

test("saved receipts must belong to the saved day", () => {
  const data = snapshot();
  const day = data.market.day;
  const ledger = (overrides) => ({ day, openingCredits: 1500, openingReputation: 2, lines: [], shift: null,
    closingCredits: null, closingReputation: null, ...overrides });
  data.playerState.dayLedger = ledger();
  data.playerState.lastDayReceipt = null;
  data.playerState.awaitingEndDay = true;
  assert.deepEqual(validateShopSave(structuredClone(data), database).playerState.dayLedger, ledger());
  for (const [field, value, message] of [
    ["dayLedger", ledger({ day: day + 1 }), /invalid daily receipt/],
    ["dayLedger", ledger({ lines: [{ category: "bribes", label: "x", amount: 1, quantity: 1 }] }), /invalid daily receipt/],
    ["lastDayReceipt", ledger({ closingCredits: 10, closingReputation: 0 }), /previous day's receipt/],
    ["awaitingEndDay", "yes", /end-of-day state/],
  ]) {
    const invalid = structuredClone(data);
    invalid.playerState[field] = value;
    assert.throws(() => validateShopSave(invalid, database), message);
  }
});

test("saved emergency loans need a positive balance and a day no later than today", () => {
  const data = snapshot();
  const day = data.market.day;
  for (const loan of [undefined, null, { balance: 812.5, takenOnDay: day }]) {
    const valid = structuredClone(data);
    valid.playerState.emergencyLoan = loan;
    assert.doesNotThrow(() => validateShopSave(valid, database));
  }
  for (const loan of [{ balance: 0, takenOnDay: day }, { balance: 10.001, takenOnDay: day },
    { balance: 100, takenOnDay: day + 1 }, { balance: 100 }, "lots"]) {
    const invalid = structuredClone(data);
    invalid.playerState.emergencyLoan = loan;
    assert.throws(() => validateShopSave(invalid, database), /invalid emergency loan/);
  }
});

test("saved hovercarts accept legacy and upgrade capacities but reject invalid sizes", () => {
  for (const capacity of [10, 15, 20, 25, 30, 35, 40]) {
    const data = snapshot();
    data.playerState.hovercart.capacity = capacity;
    assert.doesNotThrow(() => validateShopSave(data, database), `${capacity} spaces`);
  }
  for (const capacity of [5, 14, 16, 21, 41, 45]) {
    const data = snapshot();
    data.playerState.hovercart.capacity = capacity;
    assert.throws(() => validateShopSave(data, database), /invalid hovercart/);
  }
});

test("saves accept cent balances and prices and reject fractions smaller than a cent", () => {
  const data = snapshot();
  data.playerState.credits = 1500.23;
  data.playerState.storePrices.wpn_rif_01 = 123.45;
  data.market = new Market(database.getAllItems(), () => 0.123).serialize();
  assert.doesNotThrow(() => validateShopSave(JSON.parse(JSON.stringify(data)), database));
  for (const corrupt of [
    (saved) => { saved.playerState.credits = 1500.001; },
    (saved) => { saved.playerState.storePrices.wpn_rif_01 = 123.456; },
    (saved) => { saved.market.prices.wpn_rif_01 += 0.001; },
  ]) {
    const invalid = structuredClone(data);
    corrupt(invalid);
    assert.throws(() => validateShopSave(invalid, database), /Invalid saved game/);
  }
});

test("saved launch acceleration is preserved, and malformed launch states are rejected", () => {
  const data = snapshot();
  data.crates[0].launch = { remainingMs: 80, accelerationX: 1500, accelerationY: 0, maxSpeed: 400 };
  assert.deepEqual(validateShopSave(data, database).crates[0].launch, data.crates[0].launch);
  for (const launch of [null, {}, { ...data.crates[0].launch, remainingMs: -1 },
    { ...data.crates[0].launch, remainingMs: 161 },
    { ...data.crates[0].launch, accelerationX: NaN }, { ...data.crates[0].launch, maxSpeed: 0 }]) {
    const invalid = structuredClone(data);
    invalid.crates[0].launch = launch;
    assert.throws(() => validateShopSave(invalid, database), /invalid crate launch/);
  }
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
    (data) => { data.playerState.shopLevel = 0; },
    (data) => { data.playerState.shopLevel = 31; },
    (data) => { data.playerState.pendingReputation = { global: 1, factions: {} }; },
    (data) => { data.playerState.activeLicenses.push("unknown"); },
    (data) => { data.playerState.hovercart.stock[0].quantity = 999; },
    (data) => { data.playerState.storePrices.wpn_rif_01 = 0; },
    (data) => { data.market.day = 0; },
    (data) => { data.market.prices.wpn_rif_01 = 100000; },
    (data) => { data.market.supplyRatios.wpn_rif_01 = 0; },
    (data) => { data.fixtures[0].placements[0].quantity = 99; },
    (data) => { data.fixtures[0].placements.push({ ...data.fixtures[0].placements[0] }); },
    (data) => { data.fixtures[1].stock[0].itemId = "unknown"; },
    (data) => { data.fixtures[1].gx = 1.3; },
    (data) => { data.fixtures[1].type = "unknown"; },
    (data) => { data.fixtures[1].id = data.fixtures[0].id; },
    (data) => { data.unlockedZones = []; },
    (data) => { data.crates[0].quantity = 0; },
    (data) => { data.carriedCrate.itemId = "unknown"; },
    (data) => { data.playerState.goBacks[0].itemId = "unknown"; },
    (data) => { data.playerState.goBacks[0].quantity = 0; },
    (data) => { data.playerState.goBacks = {}; },
    (data) => { data.playerState.hiredEmployees = ["unknown_employee"]; },
    (data) => { data.playerState.hiredEmployees = ["tavi_stock_clerk", "tavi_stock_clerk"]; },
    (data) => {
      data.playerState.hiredEmployees = ["tavi_stock_clerk"];
      data.playerState.employeeJobPriorities = { tavi_stock_clerk: ["register", "register", "load_storage"] };
    },
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

test("saves from before employees existed still load", () => {
  const data = snapshot();
  delete data.playerState.hiredEmployees;
  delete data.playerState.employeeJobPriorities;
  assert.doesNotThrow(() => validateShopSave(data, database));
});

test("employee skills remain valid after firing, while booked training requires hired non-maxed staff", () => {
  const data = snapshot();
  data.playerState.employeeSkills = {
    tavi_stock_clerk: { register: 2, stock_shelves: 1, load_storage: 1 },
  };
  assert.doesNotThrow(() => validateShopSave(data, database));
  data.playerState.employeeTraining = { tavi_stock_clerk: "register" };
  assert.throws(() => validateShopSave(data, database), /invalid employee training/);
  data.playerState.hiredEmployees = ["tavi_stock_clerk"];
  assert.doesNotThrow(() => validateShopSave(data, database));
  for (const invalid of [0, 6, 1.5, "2", null]) {
    data.playerState.employeeSkills.tavi_stock_clerk.register = invalid;
    assert.throws(() => validateShopSave(data, database), /invalid employee skills/);
  }
  data.playerState.employeeSkills.tavi_stock_clerk.register = 5;
  assert.throws(() => validateShopSave(data, database), /invalid employee training/);
  data.playerState.employeeTraining = { tavi_stock_clerk: "unknown" };
  assert.throws(() => validateShopSave(data, database), /invalid employee training/);
});

test("saves accept earned shop levels and pending store and faction reputation", () => {
  const data = snapshot();
  data.playerState.shopLevel = 30;
  data.playerState.pendingReputation = {
    global: 3,
    factions: { scavengers: 4, mercenaries: -1, explorers: 0 },
  };
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

test("older saves keep the third starting locker and its contents", () => {
  const data = snapshot();
  const thirdLocker = {
    id: "storage_demo_03", gx: 3, gy: 101, stock: [{ itemId: "srv_01", quantity: 5 }],
  };
  data.fixtures.push(thirdLocker);
  const restored = validateShopSave(data, database);
  assert.equal(restored.fixtures.filter((fixture) => fixture.type === "locker_single").length, 3);
  assert.deepEqual(restored.fixtures.find((fixture) => fixture.id === thirdLocker.id), {
    ...thirdLocker, type: "locker_single",
  });
});

test("saves using the old detached backroom explain that a new game is required", () => {
  const legacy = snapshot();
  delete legacy.layoutVersion;
  for (const entry of legacy.fixtures) {
    if (entry.gy >= 100) entry.gy -= 100;
    else Object.assign(entry, { gx: entry.gx - 7, gy: entry.gy - 1 });
  }
  legacy.crates[0].y = 640;
  assert.throws(() => validateShopSave(legacy, database), /old backroom size.*Start a new game/);
  assert.equal(legacy.crates[0].y, 640, "the save being loaded is not changed");
});

test("older room layout versions explain that a new game is required", () => {
  const old = snapshot();
  old.layoutVersion = 2;
  for (const entry of old.fixtures) {
    if (entry.gy < 100) Object.assign(entry, { gx: entry.gx - 7, gy: entry.gy - 1 });
  }
  old.crates[0].x = 400;
  old.crates[0].y = 300;
  assert.throws(() => validateShopSave(old, database), /old backroom size.*Start a new game/);
  old.layoutVersion = 3;
  assert.throws(() => validateShopSave(old, database), /old backroom size.*Start a new game/);
  old.layoutVersion = 4;
  assert.throws(() => validateShopSave(old, database), /old backroom size.*Start a new game/);
  assert.equal(old.crates[0].x, 400, "the save being loaded is not changed");
});

test("fixture rotation is saved, and older saves without it still load", () => {
  const data = snapshot();
  data.fixtures[0].rotation = 2;
  data.fixtures.at(-1).rotation = 1;
  assert.deepEqual(validateShopSave(data, database), data);

  for (const rotation of [4, -1, 1.5, "1"]) {
    data.fixtures[0].rotation = rotation;
    assert.throws(() => validateShopSave(data, database), /invalid fixture position/);
  }
});

test("fixtures between floor squares save, including two-pixel locker positions", () => {
  const data = snapshot();
  data.fixtures[0].gx += 0.5;
  data.fixtures[0].gy += 0.125;
  data.fixtures.find((fixture) => fixture.type === "locker_single").gx += 1 / 32;
  assert.deepEqual(validateShopSave(data, database), data);
  for (const gx of [0.1, -0.5]) {
    data.fixtures[0].gx = gx;
    assert.throws(() => validateShopSave(data, database), /invalid fixture position/);
  }
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
