import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { startingMoney } from "../js/logic/StartingTemplate.js";
import { Events, GAME_EVENTS } from "../js/core/Events.js";
import { DayLedger, isValidLedgerData, summarizeReceipt } from "../js/logic/DayLedger.js";
import { FinancesRenderer } from "../js/logic/FinancesRenderer.js";
import { createCustomerPool, getStoreRepPool } from "../js/logic/CustomerPooling.js";
import { getShopLevelRequirement } from "../js/logic/ShopProgression.js";

let server;
let cacheDirectory;
let GameState;
let HUDController;
let ShiftSystem;

before(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-ledger-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    plugins: [{
      name: "ledger-test-stubs",
      enforce: "pre",
      resolveId(source) {
        if (source === "../scenes/boot.js") return "\0ledger-test-database";
      },
      load(id) {
        if (id === "\0ledger-test-database") {
          return "export const database = { getItem: (id) => ({ id, name: id }) };";
        }
      },
    }],
  });
  ({ GameState } = await server.ssrLoadModule("/js/state/GameState.js"));
  ({ HUDController } = await server.ssrLoadModule("/js/logic/HUDController.js"));
  ({ ShiftSystem } = await server.ssrLoadModule("/js/systems/ShiftSystem.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

const ITEMS = [{ id: "ration", baseCost: 10 }];
const newGame = () => new GameState({ items: ITEMS, random: () => 0.5 });
// Save and load through JSON, as the save file does.
const reload = (state) => GameState.fromSave(JSON.parse(JSON.stringify(state.toSave())), { items: ITEMS });
// Load just the player's section of a save, as if it were saved on `day`.
const loadPlayer = (player, day = 1) =>
  GameState.fromSave({ playerState: player, market: { day, ...newGame().market.serialize() } }, { items: ITEMS });

const balanceOf = (state) => state.economy.dayLedger.openingCredits +
  state.economy.dayLedger.lines.reduce((sum, line) => sum + line.amount, 0);

function unlockStaff(state) {
  state.reputation.gain(90);
  state.finishShift({ customersServed: 90, customersTurnedAway: 0 });
  state.endDay();
}

test("new shops start at zero reputation and cannot hire anyone at Shop Level 1", () => {
  const state = newGame();
  assert.equal(state.reputation.global, 0);
  assert.equal(state.reputation.shopLevel, 1);
  assert.equal(state.hireEmployee("tavi_stock_clerk"), false);
  assert.equal(state.economy.credits, startingMoney());
  assert.deepEqual(state.staff.hired, []);
});

test("store and faction reputation changes are applied together at the end of the shift", () => {
  const state = newGame();
  state.reputation.gain(4, "scavengers");
  state.reputation.lose(2, "mercenaries");
  state.reputation.lose(1);

  assert.equal(state.reputation.global, 0);
  assert.deepEqual(state.reputation.factions, { scavengers: 0, mercenaries: 0, explorers: 0 });
  state.finishShift({ customersServed: 4, customersTurnedAway: 0 });
  assert.equal(state.reputation.global, 1);
  assert.deepEqual(state.reputation.factions, { scavengers: 4, mercenaries: -2, explorers: 0 });
  assert.equal(summarizeReceipt(state.economy.dayLedger.serialize(), state.economy.credits, state.reputation.global)
    .reputationChange, 1);

  state.endDay();
  state.finishShift({ customersServed: 0, customersTurnedAway: 0 });
  assert.equal(state.reputation.global, 1);
  assert.deepEqual(state.reputation.factions, { scavengers: 4, mercenaries: -2, explorers: 0 });
});

test("shop levels rise after a shift and the first staff spot opens at Level 4 with 90 reputation", () => {
  const state = newGame();
  state.reputation.gain(20);
  state.reputation.lose(1);
  assert.equal(state.reputation.global, 0);
  assert.equal(state.reputation.shopLevel, 1);
  state.finishShift({ customersServed: 20, customersTurnedAway: 0 });
  assert.equal(state.reputation.global, 19);
  assert.equal(state.reputation.shopLevel, 1);
  assert.equal(state.hireEmployee("tavi_stock_clerk"), false);

  state.endDay();
  state.reputation.gain(1);
  assert.equal(state.reputation.global, 19);
  assert.equal(state.reputation.shopLevel, 1);
  state.finishShift({ customersServed: 1, customersTurnedAway: 0 });
  assert.equal(state.reputation.global, 20);
  assert.equal(state.reputation.shopLevel, 2);
  assert.equal(state.hireEmployee("tavi_stock_clerk"), false);

  state.endDay();
  state.reputation.gain(30);
  state.finishShift({ customersServed: 30, customersTurnedAway: 0 });
  assert.equal(state.reputation.global, 50);
  assert.equal(state.reputation.shopLevel, 3);
  assert.equal(state.hireEmployee("tavi_stock_clerk"), false);

  state.endDay();
  state.reputation.gain(39);
  state.finishShift({ customersServed: 39, customersTurnedAway: 0 });
  assert.equal(state.reputation.global, 89);
  assert.equal(state.reputation.shopLevel, 3);
  assert.equal(state.hireEmployee("tavi_stock_clerk"), false);

  state.endDay();
  state.reputation.gain(1);
  assert.equal(state.reputation.shopLevel, 3);
  state.finishShift({ customersServed: 1, customersTurnedAway: 0 });
  assert.equal(state.reputation.global, 90);
  assert.equal(state.reputation.shopLevel, 4);

  state.endDay();
  state.reputation.lose(85);
  state.finishShift({ customersServed: 0, customersTurnedAway: 0 });
  assert.equal(state.reputation.global, 5);
  assert.equal(state.reputation.shopLevel, 4);
  const restored = reload(state);
  assert.equal(restored.reputation.global, 5);
  assert.equal(restored.reputation.shopLevel, 4);
  assert.equal(restored.hireEmployee("tavi_stock_clerk"), true);
});

test("older saves keep reputation and hired staff and derive their initial shop level", () => {
  const saved = newGame().toSave().playerState;
  delete saved.shopLevel;
  delete saved.pendingReputation;
  saved.globalReputation = 20;
  assert.equal(loadPlayer(saved).reputation.shopLevel, 2);

  saved.globalReputation = 2;
  saved.hiredEmployees = ["tavi_stock_clerk"];
  delete saved.employeeJobPriorities;
  const restored = loadPlayer(saved);
  assert.equal(restored.reputation.global, 2);
  assert.equal(restored.reputation.shopLevel, 1);
  assert.deepEqual(restored.staff.hired, ["tavi_stock_clerk"]);
  assert.equal(restored.staff.prioritizeJob("tavi_stock_clerk", "stock_shelves"), true);
});

test("older level-capped saves catch up to earned reputation without reducing saved levels", () => {
  const saved = newGame().toSave().playerState;
  saved.shopLevel = 2;
  saved.globalReputation = 90;
  assert.equal(loadPlayer(saved).reputation.shopLevel, 4);
  saved.shopLevel = 4;
  saved.globalReputation = 72;
  assert.equal(loadPlayer(saved).reputation.shopLevel, 4, "an old earned level survives the slower curve");
  saved.globalReputation = -5;
  assert.equal(loadPlayer(saved).reputation.shopLevel, 4);
});

test("previously signed contracts and hired staff remain owned below their new unlock levels", () => {
  const saved = newGame().toSave().playerState;
  saved.globalReputation = 2;
  saved.shopLevel = 2;
  saved.activeLicenses.push("lic_start_apparel", "lic_start_surplus");
  saved.hiredEmployees = ["tavi_stock_clerk"];
  delete saved.employeeJobPriorities;
  const restored = loadPlayer(saved);
  assert.equal(restored.reputation.shopLevel, 2);
  assert.equal(restored.catalog.owns("lic_start_apparel"), true);
  assert.equal(restored.catalog.owns("lic_start_surplus"), true);
  assert.deepEqual(restored.staff.hired, ["tavi_stock_clerk"]);
  assert.equal(restored.staff.prioritizeJob("tavi_stock_clerk", "stock_shelves"), true);
});

test("one shift can earn multiple levels without applying reputation early", () => {
  const state = newGame();
  const highestRequirement = getShopLevelRequirement(50);
  state.reputation.gain(highestRequirement);
  assert.equal(state.reputation.global, 0);
  assert.equal(state.reputation.shopLevel, 1);
  state.finishShift({ customersServed: 1, customersTurnedAway: 0 });
  assert.equal(state.reputation.global, highestRequirement);
  assert.equal(state.reputation.shopLevel, 50);
  assert.equal(reload(state).reputation.shopLevel, 50);
});

function finishCleanShift(state, stockCoverage) {
  const baseCustomers = getStoreRepPool(state.reputation.global);
  const pool = createCustomerPool({
    storeReputation: state.reputation.global,
    factionReputation: state.reputation.factions,
    activeFactions: new Set(),
    shelfPlacements: [{ itemId: "ration", quantity: Math.floor(baseCustomers * 2 * stockCoverage) }],
    getItem: () => ITEMS[0],
  });
  state.reputation.gain(pool.totalCustomers);
  state.finishShift({ customersServed: pool.totalCustomers, customersTurnedAway: 0 });
}

test("serving every customer without penalties earns one level in each of the first four shifts", () => {
  for (const stockCoverage of [1, 1.1, 1.25]) {
    const state = newGame();
    for (let shift = 1; shift <= 4; shift += 1) {
      finishCleanShift(state, stockCoverage);
      assert.equal(state.reputation.shopLevel, shift + 1, `shift ${shift}, stock coverage ${stockCoverage}`);
      state.endDay();
    }
  }
});

test("later levels take multiple clean shifts even when every arriving customer is served", () => {
  for (const stockCoverage of [1, 1.1, 1.25]) {
    const state = newGame();
    let previousLevel = 1;
    let lastLevelShift = 0;
    for (let shift = 1; shift <= 300 && state.reputation.shopLevel < 50; shift += 1) {
      finishCleanShift(state, stockCoverage);
      const level = state.reputation.shopLevel;
      if (level > previousLevel) {
        assert.equal(level, previousLevel + 1, "clean shifts do not skip levels");
        if (level >= 6) {
          assert.ok(shift - lastLevelShift >= 2, `Level ${level}, stock coverage ${stockCoverage}`);
        }
        previousLevel = level;
        lastLevelShift = shift;
      }
      state.endDay();
    }
    assert.equal(state.reputation.shopLevel, 50);
  }
});

test("pending reputation survives a player-state round trip without being applied early", () => {
  const state = newGame();
  state.reputation.gain(3, "explorers");
  const restored = reload(state);
  assert.equal(restored.reputation.global, 0);
  assert.equal(restored.reputation.factions.explorers, 0);
  restored.finishShift({ customersServed: 3, customersTurnedAway: 0 });
  assert.equal(restored.reputation.global, 3);
  assert.equal(restored.reputation.factions.explorers, 3);
});

test("receipt lines merge by item and keep earned and spent apart", () => {
  const ledger = new DayLedger({ day: 3, openingCredits: 1000, openingReputation: 5 });
  ledger.record({ category: "sales", label: "Pulse Rifle", amount: 150, quantity: 1 });
  ledger.record({ category: "stock_orders", label: "Pulse Rifle", amount: -90, quantity: 2 });
  ledger.record({ category: "sales", label: "Pulse Rifle", amount: 300, quantity: 2 });
  ledger.record({ category: "delivery_fees", label: "Delivery fee", amount: -25 });

  assert.deepEqual(ledger.lines.find((line) => line.category === "sales"),
    { category: "sales", label: "Pulse Rifle", amount: 450, quantity: 3 });
  const receipt = summarizeReceipt(ledger.serialize(), 1335, 8);
  assert.equal(receipt.totalEarned, 450);
  assert.equal(receipt.totalSpent, 115);
  assert.equal(receipt.reputationChange, 3);
  assert.deepEqual(receipt.spent.map((line) => line.category), ["stock_orders", "delivery_fees"]);
});

test("receipt entries without a known category or cent-precision amount are rejected", () => {
  const ledger = new DayLedger({ day: 1, openingCredits: 0, openingReputation: 0 });
  for (const entry of [
    { category: "bribes", label: "x", amount: -1 },
    { category: "sales", label: "", amount: 1 },
    { category: "sales", label: "x", amount: 1.501 },
    { category: "sales", label: "x", amount: 1, quantity: 0 },
  ]) {
    assert.throws(() => ledger.record(entry), /Invalid receipt entry/);
  }
});

test("every credit change is itemized, so the receipt always matches the balance", () => {
  const state = newGame();
  unlockStaff(state);
  state.economy.add(200, { category: "sales", label: "Pulse Rifle", quantity: 2 });
  state.economy.spend(75, { category: "licenses", label: "Aulin Arms" });
  assert.equal(state.hireEmployee("tavi_stock_clerk"), true);
  state.economy.spend(50, { category: "wages", label: "Tavi" });
  assert.equal(state.economy.credits, 1075);
  assert.equal(balanceOf(state), state.economy.credits);
  assert.deepEqual(state.economy.dayLedger.lines.find((line) => line.category === "hiring"),
    { category: "hiring", label: "Tavi", amount: -500, quantity: 1 });
  assert.throws(() => state.economy.spend(10), /Invalid receipt entry/);
  assert.throws(() => state.economy.add(-5, { category: "sales", label: "x" }), /Money earned must be non-negative/);
  assert.equal(state.economy.credits, 1075);
});

test("training takes a paid shift, survives saves, and permanently raises wages", () => {
  const state = newGame();
  unlockStaff(state);
  assert.equal(state.hireEmployee("tavi_stock_clerk"), true);
  assert.equal(state.trainEmployee("tavi_stock_clerk", "register"), true);
  assert.equal(state.economy.credits, 500);
  assert.equal(balanceOf(state), 500);
  assert.deepEqual(state.staff.training, { tavi_stock_clerk: "register" });
  assert.equal(state.staff.profile("tavi_stock_clerk").skillLevels.register, 1);
  assert.equal(state.staff.profile("tavi_stock_clerk").wagePerShift, 100);
  assert.equal(state.trainEmployee("tavi_stock_clerk", "stock_shelves"), false);
  assert.equal(state.staff.setOnShift("tavi_stock_clerk", false), false);
  assert.deepEqual(state.economy.dayLedger.lines.find(({ category }) => category === "training"), {
    category: "training", label: "Tavi: Run register Level 2", quantity: 1, amount: -500,
  });

  const restored = reload(state);
  assert.deepEqual(restored.staff.training, state.staff.training);
  restored.finishShift({ customersServed: 0, customersTurnedAway: 0 });
  const trained = restored.staff.profile("tavi_stock_clerk");
  assert.equal(trained.skillLevels.register, 2);
  assert.equal(trained.skillLevels.stock_shelves, 1);
  assert.equal(trained.wagePerShift, 110);
  assert.deepEqual(restored.staff.training, {});
  assert.equal(restored.staff.setOnShift("tavi_stock_clerk", false), true);
  restored.economy.add(1000, { category: "sales", label: "Training test" });
  assert.equal(restored.trainEmployee("tavi_stock_clerk", "register"), true);
  assert.equal(state.staff.profile("tavi_stock_clerk").skillLevels.register, 1);
});

test("each course costs more than that employee's last, whichever skill it trains", () => {
  const state = newGame();
  unlockStaff(state);
  state.economy.add(20000, { category: "sales", label: "Training test" });
  state.hireEmployee("tavi_stock_clerk");
  const costs = [];
  for (const jobId of ["register", "stock_shelves"]) {
    for (let level = 2; level <= 5; level += 1) {
      const before = state.economy.credits;
      assert.equal(state.trainEmployee("tavi_stock_clerk", jobId), true);
      costs.push(before - state.economy.credits);
      state.finishShift({ customersServed: 0, customersTurnedAway: 0 });
      assert.equal(state.staff.profile("tavi_stock_clerk").skillLevels[jobId], level);
      state.endDay();
    }
    const before = state.economy.credits;
    assert.equal(state.trainEmployee("tavi_stock_clerk", jobId), false);
    assert.equal(state.economy.credits, before);
  }
  assert.deepEqual(costs, Array.from({ length: 8 }, (_, index) => 500 + 250 * index));
  assert.equal(state.staff.profile("tavi_stock_clerk").wagePerShift, 180);
  assert.equal(state.staff.profile("tavi_stock_clerk").hireCost, 500);
});

test("every employee starts identical, and Store Level caps how many are hired at once", () => {
  const state = newGame();
  state.economy.add(5000, { category: "sales", label: "Hiring test" });
  const fresh = ["tavi_stock_clerk", "kel_supply_runner"].map((id) => state.staff.profile(id));
  for (const employee of fresh) {
    assert.deepEqual(
      [employee.hireCost, employee.wagePerShift],
      [500, 100],
    );
  }
  assert.equal(state.hireEmployee("kel_supply_runner"), false);
  unlockStaff(state);
  assert.equal(state.hireEmployee("kel_supply_runner"), true);
  assert.equal(state.hireEmployee("tavi_stock_clerk"), false);
  assert.equal(state.staff.setOnShift("kel_supply_runner", false), true);
  assert.equal(state.hireEmployee("tavi_stock_clerk"), false);
  assert.deepEqual(state.staff.onShift(), []);
  assert.deepEqual(state.staff.paid(), []);
  assert.equal(state.staff.setOnShift("kel_supply_runner", true), true);
  assert.deepEqual(state.staff.working(), ["kel_supply_runner"]);
  state.staff.setOnShift("kel_supply_runner", false);

  const restored = reload(state);
  assert.deepEqual(restored.staff.offShift, ["kel_supply_runner"]);
  assert.deepEqual(restored.staff.hired, ["kel_supply_runner"]);
});

test("a trainee is unavailable but paid whatever their setting, and keeps it afterwards", () => {
  const state = newGame();
  unlockStaff(state);
  state.hireEmployee("tavi_stock_clerk");
  assert.equal(state.staff.setOnShift("tavi_stock_clerk", false), true);
  assert.equal(state.trainEmployee("tavi_stock_clerk", "register"), true);
  assert.equal(state.staff.setOnShift("tavi_stock_clerk", true), false);
  assert.deepEqual(state.staff.paid(), ["tavi_stock_clerk"]);
  assert.deepEqual(state.staff.working(), []);
  state.finishShift({ customersServed: 0, customersTurnedAway: 0 });
  assert.deepEqual(state.staff.paid(), []);
  assert.deepEqual(state.staff.offShift, ["tavi_stock_clerk"]);
});

test("training rejects unaffordable and unhired staff and older saves start with Level 1 skills", () => {
  const state = newGame();
  unlockStaff(state);
  assert.equal(state.trainEmployee("tavi_stock_clerk", "register"), false);
  state.hireEmployee("tavi_stock_clerk");
  state.economy.spend(1250, { category: "stock_orders", label: "Supplies" });
  assert.equal(state.trainEmployee("tavi_stock_clerk", "register"), false);
  assert.deepEqual(state.staff.training, {});
  const oldSave = JSON.parse(JSON.stringify(state.toSave()));
  delete oldSave.playerState.employeeSkills;
  delete oldSave.playerState.employeeTraining;
  const restored = GameState.fromSave(oldSave, { items: ITEMS });
  assert.deepEqual(restored.staff.profile("tavi_stock_clerk").skillLevels, {
    register: 1, stock_shelves: 1, clean: 1,
  });
  assert.deepEqual(restored.staff.training, {});
});

test("receipts describe fixture resale and fixture purchases separately", () => {
  const state = newGame();
  state.economy.add(75, { category: "fixture_sales", label: "BUDGET SHELF 2x2" });
  state.economy.spend(150, { category: "fixtures", label: "BUDGET SHELF 2x2" });
  const receipt = summarizeReceipt(state.economy.dayLedger.serialize(), state.economy.credits, state.reputation.global);
  const html = FinancesRenderer.generateHTML({ ...financesView(), today: receipt });
  assert.match(html, /Sold fixture: BUDGET SHELF 2x2/);
  assert.match(html, /Fixture: BUDGET SHELF 2x2/);
  assert.equal(receipt.totalEarned, 75);
  assert.equal(receipt.totalSpent, 150);
});

test("cent-priced sales, spending and receipts survive ending the day and saving", () => {
  const state = newGame();
  unlockStaff(state);
  state.economy.add(1.23, { category: "sales", label: "Ration" });
  state.economy.add(2.34, { category: "sales", label: "Ration" });
  state.economy.spend(25, { category: "delivery_fees", label: "Delivery fee" });
  assert.equal(state.hireEmployee("tavi_stock_clerk"), true);
  assert.equal(state.economy.credits, 978.57);
  assert.equal(state.economy.dayLedger.lines[0].amount, 3.57);
  state.finishShift({ customersServed: 2, customersTurnedAway: 0 });
  state.endDay();
  const restored = reload(state);
  assert.equal(restored.economy.credits, 978.57);
  const closedReceipt = restored.economy.dayReceipts.at(-1);
  assert.equal(closedReceipt.closingCredits, 978.57);
  assert.equal(isValidLedgerData(closedReceipt, { closed: true }), true);
  assert.equal(summarizeReceipt(closedReceipt, restored.economy.credits, 2).totalEarned, 3.57);
  assert.match(FinancesRenderer.generateHTML({
    ...financesView(), today: summarizeReceipt(closedReceipt, restored.economy.credits, 2),
  }), /978\.57/);
});

test("ending a day closes the receipt and starts the next day from the closing balance", () => {
  const state = newGame();
  state.economy.add(500, { category: "sales", label: "Pulse Rifle" });
  state.reputation.gain(3);
  state.finishShift({ customersServed: 4, customersTurnedAway: 1 });
  assert.equal(state.calendar.awaitingEndDay, true);

  const receipt = state.endDay();
  assert.equal(receipt.day, 1);
  assert.equal(receipt.closingCredits, 2000);
  assert.deepEqual(receipt.shift, {
    customersServed: 4,
    customersTurnedAway: 1,
    priceReactions: { bargain: 0, skipped: 0, disgusted: 0 },
  });
  assert.equal(state.calendar.awaitingEndDay, false);
  assert.deepEqual(state.economy.dayReceipts, [receipt]);
  assert.equal(state.economy.dayLedger.day, 2);
  assert.equal(state.economy.dayLedger.openingCredits, 2000);
  assert.equal(state.economy.dayLedger.openingReputation, 3);
  assert.deepEqual(state.economy.dayLedger.lines, []);
});

test("the receipt counts each customer's price reactions and bargain sales add store-only reputation", () => {
  const state = newGame();
  const shift = new ShiftSystem({ gameState: state });
  shift.recordSale = () => {};
  const events = new Events({ strict: true });
  shift.listen(events);
  const first = { id: "customer-1", factionId: "explorers", boughtBargainItem: true };
  const second = { id: "customer-2", factionId: "mercenaries", boughtBargainItem: false };
  events.emit(GAME_EVENTS.CUSTOMER_PRICE_REACTION, { customer: first, reaction: "bargain" });
  events.emit(GAME_EVENTS.CUSTOMER_PRICE_REACTION, { customer: first, reaction: "bargain" });
  events.emit(GAME_EVENTS.CUSTOMER_PRICE_REACTION, { customer: first, reaction: "skipped" });
  events.emit(GAME_EVENTS.CUSTOMER_PRICE_REACTION, { customer: second, reaction: "skipped" });
  events.emit(GAME_EVENTS.CUSTOMER_PRICE_REACTION, { customer: second, reaction: "disgusted" });
  events.emit(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, { customer: first, total: 10 });

  assert.deepEqual(shift.priceReactionCounts, { bargain: 1, skipped: 2, disgusted: 1 });
  assert.equal(state.reputation.pending.global, 2);
  assert.deepEqual(state.reputation.pending.factions, {
    scavengers: 0, mercenaries: 0, explorers: 1,
  });
  state.finishShift({
    customersServed: shift.customersServed,
    customersTurnedAway: 0,
    priceReactions: shift.priceReactionCounts,
  });
  const receipt = state.endDay();
  assert.deepEqual(receipt.shift.priceReactions, { bargain: 1, skipped: 2, disgusted: 1 });

  const html = FinancesRenderer.generateHTML({
    day: 1,
    shiftRunning: false,
    pendingReputationChange: null,
    awaitingEndDay: false,
    canEndDay: false,
    today: summarizeReceipt(receipt, receipt.closingCredits, receipt.closingReputation),
    receipts: [],
    lifetime: { daysCompleted: 1, totalSales: 0, customersServed: 1 },
  });
  assert.match(html, /Customers pleased by a bargain/);
  assert.match(html, /Customers who skipped items because of price/);
  assert.match(html, /Customers who left because prices were outrageous/);
  assert.match(html, /Customers pleased by a bargain<\/span><span class="finances-value">1<\/span>/);
  assert.match(html, /Customers who skipped items because of price<\/span><span class="finances-value">2<\/span>/);
  assert.match(html, /Customers who left because prices were outrageous<\/span><span class="finances-value">1<\/span>/);
});

test("pinned item prices follow the market, save with the shop, and stop following after manual repricing", () => {
  const rolls = [0.5, 1, 0];
  const state = new GameState({ items: ITEMS, random: () => rolls.shift() ?? 0.5 });
  const initialMarketPrice = state.market.getPrice("ration");
  state.catalog.setMarketPricePinned("ration", true, initialMarketPrice);
  state.finishShift({ customersServed: 0, customersTurnedAway: 0 });
  state.endDay();
  assert.notEqual(state.market.getPrice("ration"), initialMarketPrice);
  assert.equal(state.catalog.storePrices.ration, state.market.getPrice("ration"));

  const restored = reload(state);
  assert.ok(restored.catalog.marketPricePinnedItems.has("ration"));
  restored.catalog.setPrice("ration", 5);
  assert.equal(restored.catalog.marketPricePinnedItems.has("ration"), false);
  restored.finishShift({ customersServed: 0, customersTurnedAway: 0 });
  restored.endDay();
  assert.equal(restored.catalog.storePrices.ration, 5);
});

test("receipts and the waiting-to-end-day state survive saving and loading", () => {
  const state = newGame();
  state.economy.add(120, { category: "sales", label: "Ration Pack", quantity: 4 });
  state.finishShift({ customersServed: 2, customersTurnedAway: 0 });
  state.endDay();
  state.economy.spend(30, { category: "fixtures", label: "Compact Shelf" });
  state.finishShift({ customersServed: 0, customersTurnedAway: 0 });

  const saved = JSON.parse(JSON.stringify(state.toSave()));
  assert.equal(isValidLedgerData(saved.playerState.dayLedger), true);
  assert.equal(saved.playerState.dayReceipts.length, 1);
  assert.equal(isValidLedgerData(saved.playerState.dayReceipts[0], { closed: true }), true);
  const restored = GameState.fromSave(saved, { items: ITEMS });
  assert.deepEqual(restored.toSave(), state.toSave());
  assert.equal(restored.calendar.awaitingEndDay, true);
});

test("saves from before receipts start today's receipt from the loaded balance", () => {
  const saved = newGame().toSave().playerState;
  delete saved.dayLedger;
  delete saved.dayReceipts;
  delete saved.awaitingEndDay;
  saved.credits = 777;
  const state = loadPlayer(saved, 6);
  assert.equal(state.economy.dayLedger.day, 6);
  assert.equal(state.economy.dayLedger.openingCredits, 777);
  assert.deepEqual(state.economy.dayReceipts, []);
  assert.equal(state.calendar.awaitingEndDay, false);
});

test("saves that kept only yesterday's receipt load it as the receipt history", () => {
  const state = newGame();
  state.economy.add(120, { category: "sales", label: "Ration Pack", quantity: 4 });
  state.finishShift({ customersServed: 2, customersTurnedAway: 0 });
  const receipt = state.endDay();
  const saved = JSON.parse(JSON.stringify(state.toSave()));
  delete saved.playerState.dayReceipts;
  saved.playerState.lastDayReceipt = JSON.parse(JSON.stringify(receipt));
  const restored = GameState.fromSave(saved, { items: ITEMS });
  assert.deepEqual(restored.economy.dayReceipts, [receipt]);
});

function financesView(overrides = {}) {
  const ledger = new DayLedger({ day: 2, openingCredits: 1000, openingReputation: 2 });
  ledger.record({ category: "sales", label: "Pulse Rifle", amount: 300, quantity: 2 });
  ledger.record({ category: "stock_orders", label: "Pulse Rifle", amount: -120, quantity: 1 });
  ledger.record({ category: "delivery_fees", label: "Delivery fee", amount: -25 });
  ledger.record({ category: "wages", label: "Tavi (Stock Clerk)", amount: -50 });
  ledger.recordShift({ customersServed: 2, customersTurnedAway: 1 });
  return {
    day: 2,
    shiftRunning: false,
    pendingReputationChange: null,
    awaitingEndDay: true,
    canEndDay: true,
    today: summarizeReceipt(ledger.serialize(), 1105, 4),
    receipts: [],
    lifetime: { daysCompleted: 1, totalSales: 300, customersServed: 2 },
    ...overrides,
  };
}

// A finished day's receipt summary, as getFinancesView lists them for the day buttons.
function finishedDaySummary(day = 2) {
  const ledger = new DayLedger({ day, openingCredits: 1000, openingReputation: 2 });
  ledger.record({ category: "sales", label: "Pulse Rifle", amount: 300, quantity: 2 });
  ledger.record({ category: "wages", label: "Tavi (Stock Clerk)", amount: -50 });
  ledger.recordShift({ customersServed: 2, customersTurnedAway: 1 });
  const closed = ledger.close(1250, 4);
  return summarizeReceipt(closed, closed.closingCredits, closed.closingReputation);
}

test("the Finances tab spells out what every bit of money was for", () => {
  const html = FinancesRenderer.generateHTML(financesView());
  for (const text of [
    "Sold Pulse Rifle (2 items)", "+300",
    "Supply: Pulse Rifle (1 crate)", "-120",
    "Delivery fees (1 order)", "Wages paid to Tavi (Stock Clerk)",
    "Money at the start of the day", "1,000",
    "Total earned", "Total spent", "-195",
    "Money", "1,105",
    "Customers served", "Customers turned away (store was full)",
    "END DAY 2", "moves to Day 3",
  ]) {
    assert.ok(html.includes(text), `missing "${text}"`);
  }
  assert.doesNotMatch(html, /credits/i);
  assert.doesNotMatch(html, /data-finances-start-shift/);
});

test("the Finances tab escapes untrusted receipt labels", () => {
  const view = financesView();
  view.today.earned = [{
    category: "sales",
    label: '<img src=x onerror="run()">',
    amount: 25,
    quantity: 1,
  }];
  const markup = FinancesRenderer.generateHTML(view);

  assert.match(markup, /Sold &lt;img src=x onerror=&quot;run\(\)&quot;&gt; \(1 item\)/);
  assert.doesNotMatch(markup, /<img src=x/);
});

test("the receipt uses short supply and fixture labels and larger earned/spent headings", async () => {
  const ledger = new DayLedger({ day: 1, openingCredits: 100, openingReputation: 0 });
  ledger.record({ category: "fixtures", label: "Starter Shelf", amount: -50 });
  ledger.record({ category: "stock_orders", label: "Rations", amount: -25 });
  const html = FinancesRenderer.generateHTML({
    ...financesView(),
    today: summarizeReceipt(ledger.serialize(), 25, 0),
  });
  assert.match(html, /Fixture: Starter Shelf/);
  assert.match(html, /Supply: Rations/);
  assert.doesNotMatch(html, /Bought fixture:|Ordered Rations/);
  const css = await readFile(new URL("../styles/windows/finances.css", import.meta.url), "utf8");
  assert.match(css, /\.finances-section-title\s*\{[^}]*font-size:\s*var\(--font-size-18\)/s);
  assert.match(css, /\.finances-balance\s*\{[^}]*margin:\s*10px 0/s);
});

test("all receipt totals, reputation, and customer counts use larger text", async () => {
  const pastDay = finishedDaySummary(2);
  const views = [
    FinancesRenderer.generateHTML(financesView()),
    FinancesRenderer.generateHTML(financesView({ receipts: [pastDay] }), 2),
  ];
  for (const html of views) {
    const sections = html.split('<div class="finances-totals">').slice(1);
    assert.equal(sections.length, 1);
    for (const label of [
      "Total earned", "Total spent", "Money", "Store reputation change",
      "Customers served", "Customers turned away (store was full)",
    ]) {
      assert.ok(sections[0].includes(label), `missing "${label}" from a totals section`);
    }
  }
  const css = await readFile(new URL("../styles/windows/finances.css", import.meta.url), "utf8");
  assert.match(css, /\.finances-totals\s+\.finances-row\s*\{[^}]*font-size:\s*var\(--font-size-18\)/s);
});

test("the Finances tab lists a button per day; picking one shows that day's final receipt", () => {
  const pastDays = [finishedDaySummary(1), finishedDaySummary(2)];
  const todayView = FinancesRenderer.generateHTML(financesView({ day: 3, receipts: pastDays }));
  assert.match(todayView, /data-finances-day="today"[^>]*aria-pressed="true"/s);
  assert.match(todayView, /data-finances-day="1"/);
  assert.match(todayView, /data-finances-day="2"/);
  // Newest finished day listed first, right under Today.
  assert.ok(todayView.indexOf('data-finances-day="2"') < todayView.indexOf('data-finances-day="1"'));
  assert.match(todayView, /All-Time/);
  assert.match(todayView, /Days finished/);
  assert.doesNotMatch(todayView, /Money at the end of the day/);

  const pastView = FinancesRenderer.generateHTML(financesView({ day: 3, receipts: pastDays }), 2);
  assert.match(pastView, /data-finances-day="2"[^>]*aria-pressed="true"/s);
  assert.match(pastView, /Money at the end of the day/);
  // The day's actions and loan belong to today, not to an old receipt.
  assert.doesNotMatch(pastView, /data-end-day|data-finances-start-shift/);
  // Each finished day's button shows what the day earned after spending (300 - 50).
  assert.match(pastView, /\+250/);
});

test("the Finances tab offers End Day only after the shift, and Start Shift once the day is ended", () => {
  const running = FinancesRenderer.generateHTML(financesView({
    shiftRunning: true, awaitingEndDay: false, pendingReputationChange: 3,
  }));
  assert.doesNotMatch(running, /data-end-day|data-finances-start-shift/);
  assert.match(running, /The shift is running/);
  assert.match(running, /Reputation change at shift end/);
  assert.match(running, /\+3/);
  const loss = FinancesRenderer.generateHTML(financesView({
    shiftRunning: true, awaitingEndDay: false, pendingReputationChange: -2,
  }));
  assert.match(loss, /Reputation change at shift end/);
  assert.match(loss, /-2/);

  const blocked = FinancesRenderer.generateHTML(financesView({ canEndDay: false }));
  assert.match(blocked, /data-end-day\s+disabled/);

  const ready = FinancesRenderer.generateHTML(financesView({
    day: 3,
    awaitingEndDay: false,
    today: summarizeReceipt(new DayLedger({ day: 3, openingCredits: 1105, openingReputation: 4 })
      .serialize(), 1105, 4),
    receipts: [finishedDaySummary(2)],
  }));
  assert.match(ready, /data-finances-start-shift/);
  assert.doesNotMatch(ready, /data-end-day/);
  assert.match(ready, /Nothing sold yet/);
  assert.match(ready, /Today — Day 3/);
  assert.match(ready, /data-finances-day="2"/);
});

test("the top bar shows PAUSE during a shift, END DAY after it, and START SHIFT before the next", (context) => {
  const elements = new Map();
  const ids = ["hud-credits", "hud-rep", "hud-shop-level", "hud-shift-time", "hud-pause-btn",
    "hud-store-toggle-btn",
    "hud-start-shift-btn", "hud-end-day-btn", "hud-save-btn", "hud-main-menu-btn", "persistent-hud"];
  for (const id of ids) {
    const classes = new Set();
    elements.set(id, {
      listeners: new Map(),
      attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, value); },
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        contains: (name) => classes.has(name),
      },
      addEventListener(event, handler) { this.listeners.set(event, handler); },
      removeEventListener(event) { this.listeners.delete(event); },
    });
  }
  elements.get("persistent-hud").querySelectorAll = () => [];
  const originalDocument = globalThis.document;
  globalThis.document = { getElementById: (id) => elements.get(id) };
  context.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });

  const state = newGame();
  const clockListeners = [];
  const clock = {
    started: false, isPaused: true, softClosed: false,
    getFormattedTime: () => "08:00",
    subscribe(callback) { clockListeners.push(callback); callback(this); },
    notify() { clockListeners.forEach((callback) => callback(this)); },
  };
  let opened = 0;
  let storeToggles = 0;
  const hud = new HUDController(
    state, clock, () => {}, () => {}, () => { opened += 1; }, () => { storeToggles += 1; },
  );
  assert.equal(elements.get("hud-rep").innerText, 0);
  assert.equal(elements.get("hud-shop-level").innerText, 1);
  const visible = () => [
    "hud-pause-btn", "hud-store-toggle-btn", "hud-start-shift-btn", "hud-end-day-btn",
  ]
    .filter((id) => !elements.get(id).classList.contains("hidden"));

  assert.deepEqual(visible(), ["hud-start-shift-btn"]);
  clock.started = true;
  clock.notify();
  assert.deepEqual(visible(), ["hud-pause-btn", "hud-store-toggle-btn"]);
  const storeButton = elements.get("hud-store-toggle-btn");
  assert.equal(storeButton.textContent, "CLOSE STORE");
  storeButton.listeners.get("click")();
  assert.equal(storeToggles, 1);
  hud.renderStoreStatus(true);
  assert.equal(storeButton.textContent, "REOPEN STORE");
  assert.equal(storeButton.attributes.get("aria-pressed"), "true");
  clock.softClosed = true;
  clock.notify();
  assert.deepEqual(visible(), ["hud-pause-btn"]);
  clock.started = false;
  clock.notify();
  state.finishShift({ customersServed: 1, customersTurnedAway: 0 });
  assert.deepEqual(visible(), ["hud-end-day-btn"]);
  elements.get("hud-end-day-btn").listeners.get("click")();
  assert.equal(opened, 1);
  state.endDay();
  assert.deepEqual(visible(), ["hud-start-shift-btn"]);
});

test("a loan is received, saved, repaid from later days' sales, and paid off", () => {
  const state = newGame();
  state.economy.spend(1700, { category: "wages", label: "Tavi" });
  assert.equal(state.economy.takeLoan(1200, 1500), true);
  assert.equal(state.economy.takeLoan(1200, 1500), false, "one loan at a time");
  assert.equal(state.economy.credits, 1000);
  assert.deepEqual(state.economy.emergencyLoan, { balance: 1500, takenOnDay: 1 });

  // No repayment on the day the loan was taken, even with sales.
  state.economy.add(400, { category: "sales", label: "Rations", quantity: 4 });
  state.endDay();
  assert.equal(state.economy.emergencyLoan.balance, 1500);
  assert.equal(state.economy.credits, 1400);

  state.economy.add(800, { category: "sales", label: "Rations", quantity: 8 });
  state.endDay();
  assert.equal(state.economy.emergencyLoan.balance, 1300);
  assert.equal(state.economy.credits, 2000);
  const repayment = state.economy.dayReceipts.at(-1).lines.find((line) => line.category === "loan_repayments");
  assert.equal(repayment.amount, -200);

  const restored = reload(state);
  assert.deepEqual(restored.economy.emergencyLoan, { balance: 1300, takenOnDay: 1 });

  assert.equal(restored.economy.payOffLoan(), true);
  assert.equal(restored.economy.emergencyLoan, null);
  assert.equal(restored.economy.credits, 700);
  assert.equal(restored.economy.payOffLoan(), false);
});
