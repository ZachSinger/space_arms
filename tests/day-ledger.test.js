import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { DayLedger, isValidLedgerData, summarizeReceipt } from "../js/logic/DayLedger.js";
import { FinancesRenderer } from "../js/logic/FinancesRenderer.js";

let server;
let cacheDirectory;
let PlayerState;
let HUDController;

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
          return "export const database = { getItem: (id) => ({ id, name: id, slots: 1 }) };";
        }
      },
    }],
  });
  ({ PlayerState } = await server.ssrLoadModule("/js/logic/PlayerState.js"));
  ({ HUDController } = await server.ssrLoadModule("/js/logic/HUDController.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

const balanceOf = (state) => state.dayLedger.openingCredits +
  state.dayLedger.lines.reduce((sum, line) => sum + line.amount, 0);

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
  const state = new PlayerState();
  state.addCredits(200, { category: "sales", label: "Pulse Rifle", quantity: 2 });
  state.spendCredits(75, { category: "licenses", label: "Aulin Arms" });
  assert.equal(state.hireEmployee("tavi_stock_clerk", 250), true);
  state.spendCredits(50, { category: "wages", label: "Tavi (Stock Clerk)" });
  assert.equal(state.credits, 1325);
  assert.equal(balanceOf(state), state.credits);
  assert.deepEqual(state.dayLedger.lines.find((line) => line.category === "hiring"),
    { category: "hiring", label: "Tavi (Stock Clerk)", amount: -250, quantity: 1 });
  assert.throws(() => state.spendCredits(10), /Invalid receipt entry/);
  assert.throws(() => state.addCredits(-5, { category: "sales", label: "x" }), /non-negative money/);
  assert.equal(state.credits, 1325);
});

test("hovercart upgrades cost more for each five-space increase and stop at 40", () => {
  const state = new PlayerState();
  assert.equal(state.hovercart.capacity, 15);
  assert.equal(state.hovercart.add("test_item", 3), 3);
  state.addCredits(1000, { category: "sales", label: "Test sale" });
  for (const [capacity, price] of [[20, 200], [25, 300], [30, 400], [35, 500], [40, 600]]) {
    const before = state.credits;
    assert.equal(state.upgradeHovercart(), true);
    assert.equal(state.hovercart.capacity, capacity);
    assert.equal(state.credits, before - price);
    assert.equal(state.hovercart.getAvailableUnitsFor("test_item"), 3);
  }
  const balance = state.credits;
  assert.equal(state.upgradeHovercart(), false);
  assert.equal(state.credits, balance);
  assert.equal(state.dayLedger.lines.filter((line) => line.category === "equipment").length, 5);
  assert.equal(balanceOf(state), state.credits);
});

test("an unaffordable hovercart upgrade changes neither capacity nor credits", () => {
  const state = new PlayerState();
  state.spendCredits(1301, { category: "fixtures", label: "Test fixture" });
  assert.equal(state.upgradeHovercart(), false);
  assert.equal(state.hovercart.capacity, 15);
  assert.equal(state.credits, 199);
  assert.equal(state.dayLedger.lines.some((line) => line.category === "equipment"), false);
});

test("saved hovercart upgrades and older carts keep their capacity and contents", () => {
  for (const [savedCapacity, restoredCapacity] of [[10, 15], [20, 20], [25, 25], [40, 40]]) {
    const saved = new PlayerState().serialize();
    saved.hovercart = { capacity: savedCapacity, stock: [{ itemId: "test_item", quantity: savedCapacity }] };
    const restored = PlayerState.deserialize(saved);
    assert.equal(restored.hovercart.capacity, restoredCapacity);
    assert.equal(restored.hovercart.getAvailableUnitsFor("test_item"), savedCapacity);
    assert.equal(restored.serialize().hovercart.capacity, restoredCapacity);
  }
});

test("receipts describe fixture resale and hovercart upgrades separately", () => {
  const state = new PlayerState();
  state.addCredits(90, { category: "fixture_sales", label: "LOCKER" });
  assert.equal(state.upgradeHovercart(), true);
  const receipt = summarizeReceipt(state.dayLedger.serialize(), state.credits, state.globalReputation);
  const html = FinancesRenderer.generateHTML({ ...financesView(), today: receipt });
  assert.match(html, /Sold fixture: LOCKER/);
  assert.match(html, /Equipment upgrade: Hovercart capacity: 20 spaces/);
  assert.equal(receipt.totalEarned, 90);
  assert.equal(receipt.totalSpent, 200);
});

test("cent-priced sales, spending and receipts survive ending the day and saving", () => {
  const state = new PlayerState();
  state.addCredits(1.23, { category: "sales", label: "Ration" });
  state.addCredits(2.34, { category: "sales", label: "Ration" });
  state.spendCredits(25, { category: "delivery_fees", label: "Delivery fee" });
  assert.equal(state.hireEmployee("tavi_stock_clerk", 250), true);
  assert.equal(state.credits, 1228.57);
  assert.equal(state.dayLedger.lines[0].amount, 3.57);
  state.finishShift({ customersServed: 2, customersTurnedAway: 0 });
  state.endDay(2);
  const restored = PlayerState.deserialize(JSON.parse(JSON.stringify(state.serialize())));
  assert.equal(restored.credits, 1228.57);
  assert.equal(restored.lastDayReceipt.closingCredits, 1228.57);
  assert.equal(isValidLedgerData(restored.lastDayReceipt, { closed: true }), true);
  assert.equal(summarizeReceipt(restored.lastDayReceipt, restored.credits, 2).totalEarned, 3.57);
  assert.match(FinancesRenderer.generateHTML({
    ...financesView(), today: summarizeReceipt(restored.lastDayReceipt, restored.credits, 2),
  }), /1,228\.57 credits/);
});

test("ending a day closes the receipt and starts the next day from the closing balance", () => {
  const state = new PlayerState();
  state.addCredits(500, { category: "sales", label: "Pulse Rifle" });
  state.addReputation(3);
  state.finishShift({ customersServed: 4, customersTurnedAway: 1 });
  assert.equal(state.awaitingEndDay, true);

  const receipt = state.endDay(2);
  assert.equal(receipt.day, 1);
  assert.equal(receipt.closingCredits, 2000);
  assert.deepEqual(receipt.shift, { customersServed: 4, customersTurnedAway: 1 });
  assert.equal(state.awaitingEndDay, false);
  assert.equal(state.lastDayReceipt, receipt);
  assert.equal(state.dayLedger.day, 2);
  assert.equal(state.dayLedger.openingCredits, 2000);
  assert.equal(state.dayLedger.openingReputation, 5);
  assert.deepEqual(state.dayLedger.lines, []);
});

test("receipts and the waiting-to-end-day state survive saving and loading", () => {
  const state = new PlayerState();
  state.addCredits(120, { category: "sales", label: "Ration Pack", quantity: 4 });
  state.finishShift({ customersServed: 2, customersTurnedAway: 0 });
  state.endDay(2);
  state.spendCredits(30, { category: "fixtures", label: "Compact Shelf" });
  state.finishShift({ customersServed: 0, customersTurnedAway: 0 });

  const saved = JSON.parse(JSON.stringify(state.serialize()));
  assert.equal(isValidLedgerData(saved.dayLedger), true);
  assert.equal(isValidLedgerData(saved.lastDayReceipt, { closed: true }), true);
  const restored = PlayerState.deserialize(saved);
  assert.deepEqual(restored.serialize(), state.serialize());
  assert.equal(restored.awaitingEndDay, true);
});

test("saves from before receipts start today's receipt from the loaded balance", () => {
  const saved = new PlayerState().serialize();
  delete saved.dayLedger;
  delete saved.lastDayReceipt;
  delete saved.awaitingEndDay;
  saved.credits = 777;
  const state = new PlayerState();
  state.applySave(saved, { day: 6 });
  assert.equal(state.dayLedger.day, 6);
  assert.equal(state.dayLedger.openingCredits, 777);
  assert.equal(state.lastDayReceipt, null);
  assert.equal(state.awaitingEndDay, false);
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
    awaitingEndDay: true,
    canEndDay: true,
    today: summarizeReceipt(ledger.serialize(), 1105, 4),
    lastDay: null,
    ...overrides,
  };
}

test("the Finances tab spells out what every credit was for", () => {
  const html = FinancesRenderer.generateHTML(financesView());
  for (const text of [
    "Sold Pulse Rifle (2 items)", "+300 credits",
    "Ordered Pulse Rifle (1 crate)", "-120 credits",
    "Delivery fees (1 order)", "Wages paid to Tavi (Stock Clerk)",
    "Credits at the start of the day", "1,000 credits",
    "Total earned", "Total spent", "-195 credits",
    "Credits right now", "1,105 credits",
    "Customers served", "Customers turned away (store was full)",
    "END DAY 2", "moves to Day 3",
  ]) {
    assert.ok(html.includes(text), `missing "${text}"`);
  }
  assert.doesNotMatch(html, /data-finances-start-shift/);
});

test("the Finances tab offers End Day only after the shift, and Start Shift once the day is ended", () => {
  const running = FinancesRenderer.generateHTML(financesView({ shiftRunning: true, awaitingEndDay: false }));
  assert.doesNotMatch(running, /data-end-day|data-finances-start-shift/);
  assert.match(running, /SO FAR/);

  const blocked = FinancesRenderer.generateHTML(financesView({ canEndDay: false }));
  assert.match(blocked, /data-end-day\s+disabled/);

  const ready = FinancesRenderer.generateHTML(financesView({
    day: 3,
    awaitingEndDay: false,
    today: summarizeReceipt(new DayLedger({ day: 3, openingCredits: 1105, openingReputation: 4 })
      .serialize(), 1105, 4),
    lastDay: financesView().today,
  }));
  assert.match(ready, /data-finances-start-shift/);
  assert.doesNotMatch(ready, /data-end-day/);
  assert.match(ready, /Nothing sold yet/);
  assert.match(ready, /DAY 2 RECEIPT \(FINAL\)/);
  assert.match(ready, /Credits at the end of the day/);
});

test("the top bar shows PAUSE during a shift, END DAY after it, and START SHIFT before the next", (context) => {
  const elements = new Map();
  const ids = ["hud-credits", "hud-rep", "hud-hovercart", "hud-shift-time", "hud-pause-btn",
    "hud-start-shift-btn", "hud-end-day-btn", "hud-save-btn", "persistent-hud"];
  for (const id of ids) {
    const classes = new Set();
    elements.set(id, {
      listeners: new Map(),
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

  const state = new PlayerState();
  const clockListeners = [];
  const clock = {
    started: false, isPaused: true, softClosed: false,
    getFormattedTime: () => "08:00",
    subscribe(callback) { clockListeners.push(callback); callback(this); },
    notify() { clockListeners.forEach((callback) => callback(this)); },
  };
  let opened = 0;
  new HUDController(state, clock, () => {}, () => {}, () => { opened += 1; });
  const visible = () => ["hud-pause-btn", "hud-start-shift-btn", "hud-end-day-btn"]
    .filter((id) => !elements.get(id).classList.contains("hidden"));

  assert.deepEqual(visible(), ["hud-start-shift-btn"]);
  clock.started = true;
  clock.notify();
  assert.deepEqual(visible(), ["hud-pause-btn"]);
  clock.started = false;
  clock.notify();
  state.finishShift({ customersServed: 1, customersTurnedAway: 0 });
  assert.deepEqual(visible(), ["hud-end-day-btn"]);
  elements.get("hud-end-day-btn").listeners.get("click")();
  assert.equal(opened, 1);
  state.endDay(2);
  assert.deepEqual(visible(), ["hud-start-shift-btn"]);
});
