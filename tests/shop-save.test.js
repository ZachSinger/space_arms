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
      goBacks: [{ itemId: "wpn_rif_01", quantity: 40 }],
      contractsSplit: true,
    },
    market: { day: 1, ...new Market(database.getAllItems(), () => 0.5).serialize() },
    fixtures: [
      { id: "fixture_demo_01", type: "shelf_budget_2x2", gx: 16, gy: 3 },
      ...STARTING_FIXTURES,
    ].map(({ id, type, gx, gy }) => ({
      id, type, gx, gy,
      ...(getFixtureType(type).kind === "shelf" ? { stockingVersion: 1, placements: [{
        itemId: "wpn_rif_01", gx: 0, gy: 0, w: 1, h: 1, rotated: false, quantity: 3,
      }] } : {}),
    })),
    unlockedZones: ["storeroom", "sales_floor", "loading_pad"],
    crates: [{ id: "crate-1", itemId: "wpn_rif_01", quantity: 5, x: 132, y: 6656, velocityX: 120, velocityY: 0 }],
    carriedCrate: { id: "crate-2", itemId: "srv_01", quantity: 2 },
    nextCrateId: 3,
    layoutVersion: SHOP_LAYOUT_VERSION,
  };
}

test("hands-on shelves and empty carried or dropped crates survive save validation", () => {
  const data = snapshot();
  const shelf = {
    id: "hands-on", type: "shelf_budget_3x4", gx: 17, gy: 2, stockingVersion: 1,
    placements: [
      { itemId: "amo_01", gx: 0, gy: 0, w: 1, h: 1, rotated: false, quantity: 20 },
      { itemId: "wpn_hvy_01", gx: 1, gy: 0, w: 1, h: 1, rotated: false, quantity: 1 },
    ],
  };
  data.fixtures.push(shelf);
  data.carriedCrate = { id: "crate-3", kind: "item", itemId: null, quantity: 0 };
  data.carriedCrates = [data.carriedCrate];
  data.crates.push({ ...data.carriedCrate, id: "crate-4", x: 180, y: 6656, velocityX: 0, velocityY: 0 });
  data.nextCrateId = 5;
  assert.deepEqual(validateShopSave(data, database), data);
  shelf.placements[1].quantity = 2;
  assert.throws(() => validateShopSave(data, database), /shelf stack does not fit/);
});

test("old pistol market prices are halved once without changing player selling prices", () => {
  const old = snapshot();
  old.layoutVersion = 13;
  old.market.prices.wpn_pis_02 = 55;
  old.playerState.storePrices.wpn_pis_02 = 70;
  const migrated = validateShopSave(old, database);
  assert.equal(migrated.market.prices.wpn_pis_02, 27.5);
  assert.equal(migrated.playerState.storePrices.wpn_pis_02, 70);
  assert.equal(old.market.prices.wpn_pis_02, 55);
  assert.deepEqual(validateShopSave(migrated, database), migrated);
  const invalid = snapshot();
  invalid.market.prices.wpn_pis_02 = 55;
  assert.throws(() => validateShopSave(invalid, database), /invalid market price for wpn_pis_02/);
});

test("older saves keep access to heavy ammo they could already order", () => {
  const old = snapshot();
  old.layoutVersion = 12;
  old.playerState.activeLicenses = ["lic_start_ammo"];
  const migrated = validateShopSave(old, database);
  assert.ok(migrated.playerState.activeLicenses.includes("lic_edge_antique_ammo"));

  const oldWithoutAmmo = snapshot();
  oldWithoutAmmo.layoutVersion = 12;
  oldWithoutAmmo.playerState.activeLicenses = ["lic_edge_antique"];
  assert.ok(!validateShopSave(oldWithoutAmmo, database).playerState.activeLicenses
    .includes("lic_edge_antique_ammo"));

  const current = snapshot();
  current.playerState.activeLicenses = ["lic_start_ammo"];
  assert.ok(!validateShopSave(current, database).playerState.activeLicenses
    .includes("lic_edge_antique_ammo"));
});

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
  const lower = { id: "crate-3", kind: "item", itemId: "amo_01", quantity: 2 };
  const middle = { id: "crate-4", kind: "item", itemId: "srv_01", quantity: 1 };
  const top = { id: "crate-5", kind: "item", itemId: "wpn_rif_01", quantity: 1 };
  data.carriedCrates = [lower, middle];
  data.carriedCrate = middle;
  data.nextCrateId = 6;
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

  const fourth = { id: "crate-6", kind: "item", itemId: "amo_01", quantity: 1 };
  data.carriedCrates.push(fourth);
  data.carriedCrate = fourth;
  data.nextCrateId = 7;
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

test("old saves lose retired shelves, contracts, and the hovercart for a refund, with their stock in Go-Backs", () => {
  const data = snapshot();
  data.fixtures.push({
    id: "old-large", type: "shelf_universal", gx: 17, gy: 2,
    placements: [
      { itemId: "wpn_rif_01", gx: 0, gy: 0, w: 2, h: 1, rotated: false, quantity: 3 },
      { itemId: "amo_01", gx: 2, gy: 0, w: 1, h: 1, rotated: false, quantity: 6 },
    ],
  });
  data.crates.push({ id: "crate-3", kind: "fixture", typeId: "shelf_showcase", x: 320, y: 640, velocityX: 0, velocityY: 0 });
  data.carriedCrate = { id: "crate-4", kind: "fixture", typeId: "shelf_bulk" };
  data.carriedCrates = [data.carriedCrate];
  data.nextCrateId = 5;
  data.playerState.activeLicenses.push("lic_fixture_expanded");
  data.playerState.hovercart = { capacity: 25, stock: [{ itemId: "amo_01", quantity: 4 }, { itemId: "srv_01", quantity: 2 }] };

  const migrated = validateShopSave(data, database);
  assert.equal(migrated.fixtures.some((fixture) => fixture.id === "old-large"), false);
  assert.equal(migrated.crates.some((crate) => crate.kind === "fixture"), false);
  assert.equal(migrated.carriedCrate, null);
  assert.deepEqual(migrated.carriedCrates, []);
  assert.deepEqual(migrated.playerState.activeLicenses, ["lic_corp_aulin"]);
  assert.equal(Object.hasOwn(migrated.playerState, "hovercart"), false);
  // 2000 large shelf + 800 showcase crate + 2200 bulk crate + 750 contract + 200 + 300 cart upgrades.
  assert.equal(migrated.playerState.credits, 1500 + 2000 + 800 + 2200 + 750 + 200 + 300);
  const goBacks = Object.fromEntries(migrated.playerState.goBacks.map((entry) => [entry.itemId, entry.quantity]));
  assert.deepEqual(goBacks, { wpn_rif_01: 43, amo_01: 10, srv_01: 2 });
  assert.deepEqual(validateShopSave(migrated, database), migrated);
  assert.equal(data.playerState.hovercart.capacity, 25, "the save being loaded is not changed");
});

test("saves accept cent balances and prices and reject fractions smaller than a cent", () => {
  const data = snapshot();
  data.playerState.credits = 1500.23;
  data.playerState.storePrices.wpn_rif_01 = 123.45;
  data.market = { day: 1, ...new Market(database.getAllItems(), () => 0.123).serialize() };
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

test("saved falling crates preserve their height and reject invalid flight states", () => {
  const data = snapshot();
  data.crates[0].flight = { height: 48, fallSpeed: 120 };
  assert.deepEqual(validateShopSave(data, database).crates[0].flight, data.crates[0].flight);
  for (const flight of [null, {}, { height: 0, fallSpeed: 120 },
    { height: 48, fallSpeed: -1 }, { height: Infinity, fallSpeed: 120 }]) {
    const invalid = structuredClone(data);
    invalid.crates[0].flight = flight;
    assert.throws(() => validateShopSave(invalid, database), /invalid crate flight/);
  }
  const onPad = structuredClone(data);
  onPad.crates[0].onPad = true;
  assert.throws(() => validateShopSave(onPad, database), /invalid crate flight/);
});

test("saved floor stacks keep up to two item crates on an item crate, off the Loading Pad", () => {
  const data = snapshot();
  const stack = [
    { id: "crate-3", kind: "item", itemId: "amo_01", quantity: 2 },
    { id: "crate-4", kind: "item", itemId: null, quantity: 0 },
  ];
  data.crates[0] = { ...data.crates[0], kind: "item", onPad: false, stack };
  data.nextCrateId = 5;
  assert.deepEqual(validateShopSave(structuredClone(data), database).crates[0].stack, stack);
  for (const corrupt of [
    (crate) => { crate.stack = []; },
    (crate, save) => {
      crate.stack.push({ id: "crate-5", kind: "item", itemId: "amo_01", quantity: 1 });
      save.nextCrateId = 6;
    },
    (crate) => { crate.onPad = true; },
    (crate) => { Object.assign(crate, { kind: "fixture", typeId: "shelf_budget_2x2" }); },
    (crate) => { crate.launch = { remainingMs: 80, accelerationX: 1500, accelerationY: 0, maxSpeed: 400 }; },
    (crate) => { crate.flight = { height: 48, fallSpeed: 120 }; },
  ]) {
    const invalid = structuredClone(data);
    corrupt(invalid.crates[0], invalid);
    assert.throws(() => validateShopSave(invalid, database), /invalid crate stack/);
  }
  const fixtureOnTop = structuredClone(data);
  fixtureOnTop.crates[0].stack[1] = { id: "crate-4", kind: "fixture", typeId: "shelf_budget_2x2" };
  assert.throws(() => validateShopSave(fixtureOnTop, database), /only item crates can be stacked/);
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
    (data) => { data.playerState.shopLevel = 51; },
    (data) => { data.playerState.pendingReputation = { global: 1, factions: {} }; },
    (data) => { data.playerState.activeLicenses.push("unknown"); },
    (data) => { data.playerState.storePrices.wpn_rif_01 = 0; },
    (data) => { data.market.day = 0; },
    (data) => { data.market.prices.wpn_rif_01 = 100000; },
    (data) => { data.market.supplyRatios.wpn_rif_01 = 0; },
    (data) => { data.fixtures[0].placements[0].quantity = 99; },
    (data) => { data.fixtures[0].placements.push({ ...data.fixtures[0].placements[0] }); },
    (data) => { data.fixtures[0].placements[0].itemId = "unknown"; },
    (data) => { data.fixtures[1].gx = 1.3; },
    (data) => { data.fixtures[1].type = "unknown"; },
    (data) => { data.fixtures[1].id = data.fixtures[0].id; },
    (data) => { data.unlockedZones = []; },
    (data) => { data.crates[0].quantity = -1; },
    (data) => { data.carriedCrate.itemId = "unknown"; },
    (data) => { data.playerState.goBacks[0].itemId = "unknown"; },
    (data) => { data.playerState.goBacks[0].quantity = 0; },
    (data) => { data.playerState.goBacks = {}; },
    (data) => { data.playerState.hiredEmployees = ["unknown_employee"]; },
    (data) => { data.playerState.hiredEmployees = ["tavi_stock_clerk", "tavi_stock_clerk"]; },
    (data) => {
      data.playerState.hiredEmployees = ["tavi_stock_clerk"];
      data.playerState.employeeJobPriorities = { tavi_stock_clerk: ["register", "register", "unknown"] };
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
    tavi_stock_clerk: { register: 2, stock_shelves: 1, clean: 1 },
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
  // Saves that old came before trashcans, so they never have one.
  const withoutTrash = (data) => ({ ...data, fixtures: data.fixtures.filter((entry) => entry.type !== "trash_can") });
  const legacy = withoutTrash(snapshot());
  for (const entry of legacy.fixtures) delete entry.type;
  const migrated = validateShopSave(legacy, database);
  // Their original shelf (fixture_demo_01) was the retired 3x2 shelf: refunded, stock to Go-Backs.
  assert.deepEqual(migrated.fixtures, withoutTrash(snapshot()).fixtures.slice(1));
  assert.equal(migrated.playerState.credits, 1500 + 2000);
  assert.deepEqual(migrated.playerState.goBacks, [{ itemId: "wpn_rif_01", quantity: 43 }]);
  assert.equal(legacy.fixtures[0].type, undefined);
});

test("version 9 saves remove storage fixtures, refund purchases, and move stock into Go-Backs", () => {
  const data = snapshot();
  data.layoutVersion = 9;
  data.fixtures.push({
    id: "old-locker", type: "locker_single", gx: 3, gy: 101,
    stock: [{ itemId: "srv_01", quantity: 5 }],
  });
  data.crates.push({ kind: "fixture", typeId: "locker_single", x: 100, y: 200, velocityX: 0, velocityY: 0 });
  data.carriedCrate = { kind: "fixture", typeId: "locker_single" };
  data.playerState.activeLicenses.push("lic_fixture_storage_bank");
  data.playerState.hiredEmployees = ["tavi_stock_clerk"];
  data.playerState.employeeJobPriorities = { tavi_stock_clerk: ["load_storage", "register"] };
  data.playerState.employeeSkills = { tavi_stock_clerk: { register: 2, stock_shelves: 1, load_storage: 3 } };
  data.playerState.employeeTraining = { tavi_stock_clerk: "load_storage" };

  const restored = validateShopSave(data, database);
  assert.equal(restored.layoutVersion, SHOP_LAYOUT_VERSION);
  assert.equal(restored.fixtures.some((fixture) => fixture.type === "locker_single"), false);
  assert.equal(restored.crates.some((crate) => crate.typeId === "locker_single"), false);
  assert.equal(restored.carriedCrate, null);
  assert.equal(restored.playerState.credits, 1500 + 180 * 3 + 1000);
  assert.deepEqual(restored.playerState.goBacks, [
    { itemId: "srv_01", quantity: 5 },
    { itemId: "wpn_rif_01", quantity: 40 },
  ]);
  assert.deepEqual(restored.playerState.activeLicenses, ["lic_corp_aulin"]);
  assert.deepEqual(restored.playerState.employeeJobPriorities, { tavi_stock_clerk: ["stock_shelves", "register", "clean"] });
  assert.deepEqual(restored.playerState.employeeSkills, { tavi_stock_clerk: { register: 2, stock_shelves: 3, clean: 1 } });
  assert.deepEqual(restored.playerState.employeeTraining, { tavi_stock_clerk: "stock_shelves" });
  assert.equal(data.fixtures.some((fixture) => fixture.type === "locker_single"), true,
    "migration does not mutate the source save");
});

test("saves from before the cleaning job add it last for each employee, at Level 1", () => {
  const data = snapshot();
  data.layoutVersion = 11;
  data.playerState.hiredEmployees = ["tavi_stock_clerk", "dax_stock_clerk"];
  data.playerState.employeeJobPriorities = {
    tavi_stock_clerk: ["stock_shelves", "register"],
    dax_stock_clerk: ["register", "stock_shelves"],
  };
  data.playerState.employeeSkills = { tavi_stock_clerk: { register: 2, stock_shelves: 4 } };
  data.playerState.employeeTraining = { tavi_stock_clerk: "register" };
  const copy = structuredClone(data);

  const restored = validateShopSave(data, database);
  assert.equal(restored.layoutVersion, SHOP_LAYOUT_VERSION);
  assert.deepEqual(restored.playerState.employeeJobPriorities, {
    tavi_stock_clerk: ["stock_shelves", "register", "clean"],
    dax_stock_clerk: ["register", "stock_shelves", "clean"],
  });
  assert.deepEqual(restored.playerState.employeeSkills, {
    tavi_stock_clerk: { register: 2, stock_shelves: 4, clean: 1 },
  });
  assert.deepEqual(restored.playerState.employeeTraining, { tavi_stock_clerk: "register" });
  assert.deepEqual(data, copy, "the save being loaded is not changed");

  // A current save must already list the cleaning job.
  const current = structuredClone(copy);
  current.layoutVersion = SHOP_LAYOUT_VERSION;
  assert.throws(() => validateShopSave(current, database), /invalid employee/);
});

test("saves using the old detached backroom are rejected as unsupported", () => {
  const legacy = snapshot();
  delete legacy.layoutVersion;
  for (const entry of legacy.fixtures) {
    if (entry.gy >= 100) entry.gy -= 100;
    else Object.assign(entry, { gx: entry.gx - 7, gy: entry.gy - 1 });
  }
  legacy.crates[0].y = 640;
  assert.throws(() => validateShopSave(legacy, database), /unsupported shop layout/);
  assert.equal(legacy.crates[0].y, 640, "the save being loaded is not changed");
});

test("older room layout versions are rejected as unsupported", () => {
  const old = snapshot();
  old.layoutVersion = 2;
  for (const entry of old.fixtures) {
    if (entry.gy < 100) Object.assign(entry, { gx: entry.gx - 7, gy: entry.gy - 1 });
  }
  old.crates[0].x = 400;
  old.crates[0].y = 300;
  for (const version of [2, 3, 4, 5, 6, 7, 8]) {
    old.layoutVersion = version;
    assert.throws(() => validateShopSave(old, database), /unsupported shop layout/);
  }
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

test("fixtures between floor squares save at valid positions", () => {
  const data = snapshot();
  data.fixtures[0].gx += 0.5;
  data.fixtures[0].gy += 0.125;
  assert.deepEqual(validateShopSave(data, database), data);
  for (const gx of [0.1, -0.5]) {
    data.fixtures[0].gx = gx;
    assert.throws(() => validateShopSave(data, database), /invalid fixture position/);
  }
});

test("fixture crates can be saved on the floor or carried", () => {
  const data = snapshot();
  data.crates.push({
    id: "crate-3",
    kind: "fixture", typeId: "shelf_budget_3x4", x: 320, y: 640, velocityX: 0, velocityY: 0,
  });
  data.carriedCrate = { id: "crate-4", kind: "fixture", typeId: "shelf_budget_2x4" };
  data.nextCrateId = 5;
  assert.deepEqual(validateShopSave(data, database), data);

  data.carriedCrate.typeId = "unknown";
  assert.throws(() => validateShopSave(data, database), /unknown fixture crate/);
});

test("older saves gain stable unique crate IDs and a future ID counter", () => {
  const data = snapshot();
  data.layoutVersion = 10;
  data.crates[0].stack = [{ itemId: "amo_01", quantity: 3 }];
  data.carriedCrates = [
    { kind: "item", itemId: "srv_01", quantity: 1 },
    { kind: "item", itemId: "amo_01", quantity: 2 },
  ];
  data.carriedCrate = { ...data.carriedCrates.at(-1) };
  for (const crate of [...data.crates[0].stack, ...data.carriedCrates, data.carriedCrate]) {
    delete crate.id;
  }
  delete data.nextCrateId;

  const migrated = validateShopSave(data, database);
  const ids = [
    migrated.crates[0].id,
    migrated.crates[0].stack[0].id,
    ...migrated.carriedCrates.map((crate) => crate.id),
  ];
  assert.deepEqual(ids, ["crate-1", "crate-2", "crate-3", "crate-4"]);
  assert.equal(migrated.carriedCrate.id, "crate-4");
  assert.equal(migrated.nextCrateId, 5);
  assert.equal(data.crates[0].id, "crate-1", "the base save already has its original ID");
  assert.equal(data.crates[0].stack[0].id, undefined, "migration leaves stacked source data untouched");

  const duplicate = snapshot();
  duplicate.carriedCrates = [{ ...duplicate.carriedCrate, id: "crate-1" }];
  assert.throws(() => validateShopSave(duplicate, database), /duplicate crate id/);
  const reused = snapshot();
  reused.nextCrateId = 1;
  assert.throws(() => validateShopSave(reused, database), /invalid next crate id/);
});

test("crate ID migration does not repair malformed crate save fields", () => {
  const missingCrates = snapshot();
  missingCrates.layoutVersion = 10;
  delete missingCrates.crates;
  assert.throws(() => validateShopSave(missingCrates, database), /missing crates/);

  const invalidStack = snapshot();
  invalidStack.layoutVersion = 10;
  invalidStack.carriedCrates = null;
  assert.throws(() => validateShopSave(invalidStack, database), /invalid carried crate stack/);

  const invalidCounter = snapshot();
  invalidCounter.layoutVersion = 10;
  invalidCounter.nextCrateId = null;
  assert.throws(() => validateShopSave(invalidCounter, database), /invalid next crate id/);
});

test("shelf saves reject more items than one shelf space holds", () => {
  const data = snapshot();
  data.fixtures[0].placements[0].quantity = 5; // rifle: box size 4, so 5 fill a space
  assert.doesNotThrow(() => validateShopSave(data, database));
  data.fixtures[0].placements[0].quantity = 6;
  assert.throws(() => validateShopSave(data, database), /shelf stack does not fit/);
});

test("shelf saves validate against the shelf's section grid", () => {
  const data = snapshot();
  data.fixtures[0].type = "shelf_budget_3x4";
  data.fixtures[0].placements[0].gx = 3;
  data.fixtures[0].placements[0].gy = 2;
  assert.doesNotThrow(() => validateShopSave(data, database));

  data.fixtures[0].placements[0].gx = 4;
  assert.throws(() => validateShopSave(data, database), /shelf stack does not fit/);
});

test("the smallest Budget Shelf validates against its two-by-two grid", () => {
  const data = snapshot();
  data.fixtures[0].placements[0].gx = 1;
  data.fixtures[0].placements[0].gy = 1;
  assert.doesNotThrow(() => validateShopSave(data, database));

  data.fixtures[0].placements[0].gx = 2;
  assert.throws(() => validateShopSave(data, database), /shelf stack does not fit/);
});

test("trash on the floor is saved, and unknown or off-map trash is rejected", () => {
  const save = { ...snapshot(), trash: [{ kind: "can", x: 600, y: 400 }, { kind: "paper", x: 700, y: 420 }] };
  assert.deepEqual(validateShopSave(structuredClone(save), database).trash, save.trash);
  assert.throws(() => validateShopSave({ ...snapshot(), trash: [{ kind: "banana", x: 600, y: 400 }] }, database),
    /invalid trash/);
  assert.throws(() => validateShopSave({ ...snapshot(), trash: [{ kind: "can", x: -5, y: 400 }] }, database),
    /invalid trash/);
});
