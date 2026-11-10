import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

function unlockStaff(state) {
  state.addReputation(60);
  state.finishShift({ customersServed: 60, customersTurnedAway: 0 });
  state.endDay(2);
}

test("new shops start at zero reputation and cannot hire Tavi at Shop Level 1", () => {
  const state = new PlayerState();
  assert.equal(state.globalReputation, 0);
  assert.equal(state.shopLevel, 1);
  assert.equal(state.hireEmployee("tavi_stock_clerk", 250), false);
  assert.equal(state.credits, 1500);
  assert.deepEqual(state.hiredEmployees, []);
});

test("store and faction reputation changes are applied together at the end of the shift", () => {
  const state = new PlayerState();
  state.addReputation(4, "scavengers");
  state.subReputation(2, "mercenaries");
  state.subReputation(1);

  assert.equal(state.globalReputation, 0);
  assert.deepEqual(state.factionReputation, { scavengers: 0, mercenaries: 0, explorers: 0 });
  state.finishShift({ customersServed: 4, customersTurnedAway: 0 });
  assert.equal(state.globalReputation, 1);
  assert.deepEqual(state.factionReputation, { scavengers: 4, mercenaries: -2, explorers: 0 });
  assert.equal(summarizeReceipt(state.dayLedger.serialize(), state.credits, state.globalReputation)
    .reputationChange, 1);

  state.endDay(2);
  state.finishShift({ customersServed: 0, customersTurnedAway: 0 });
  assert.equal(state.globalReputation, 1);
  assert.deepEqual(state.factionReputation, { scavengers: 4, mercenaries: -2, explorers: 0 });
});

test("shop levels rise after a shift and Tavi unlocks at Level 4 with 60 reputation", () => {
  const state = new PlayerState();
  state.addReputation(16);
  state.subReputation(2);
  assert.equal(state.globalReputation, 0);
  assert.equal(state.shopLevel, 1);
  state.finishShift({ customersServed: 14, customersTurnedAway: 0 });
  assert.equal(state.globalReputation, 14);
  assert.equal(state.shopLevel, 1);
  assert.equal(state.hireEmployee("tavi_stock_clerk", 250), false);

  state.endDay(2);
  state.addReputation(1);
  assert.equal(state.globalReputation, 14);
  assert.equal(state.shopLevel, 1);
  state.finishShift({ customersServed: 1, customersTurnedAway: 0 });
  assert.equal(state.globalReputation, 15);
  assert.equal(state.shopLevel, 2);
  assert.equal(state.hireEmployee("tavi_stock_clerk", 250), false);

  state.endDay(3);
  state.addReputation(20);
  state.finishShift({ customersServed: 20, customersTurnedAway: 0 });
  assert.equal(state.globalReputation, 35);
  assert.equal(state.shopLevel, 3);
  assert.equal(state.hireEmployee("tavi_stock_clerk", 250), false);

  state.endDay(4);
  state.addReputation(24);
  state.finishShift({ customersServed: 24, customersTurnedAway: 0 });
  assert.equal(state.globalReputation, 59);
  assert.equal(state.shopLevel, 3);
  assert.equal(state.hireEmployee("tavi_stock_clerk", 250), false);

  state.endDay(5);
  state.addReputation(1);
  assert.equal(state.shopLevel, 3);
  state.finishShift({ customersServed: 1, customersTurnedAway: 0 });
  assert.equal(state.globalReputation, 60);
  assert.equal(state.shopLevel, 4);

  state.endDay(6);
  state.subReputation(55);
  state.finishShift({ customersServed: 0, customersTurnedAway: 0 });
  assert.equal(state.globalReputation, 5);
  assert.equal(state.shopLevel, 4);
  const restored = PlayerState.deserialize(JSON.parse(JSON.stringify(state.serialize())));
  assert.equal(restored.globalReputation, 5);
  assert.equal(restored.shopLevel, 4);
  assert.equal(restored.hireEmployee("tavi_stock_clerk", 250), true);
});

test("older saves keep reputation and hired staff and derive their initial shop level", () => {
  const saved = new PlayerState().serialize();
  delete saved.shopLevel;
  delete saved.pendingReputation;
  saved.globalReputation = 15;
  assert.equal(PlayerState.deserialize(saved).shopLevel, 2);

  saved.globalReputation = 2;
  saved.hiredEmployees = ["tavi_stock_clerk"];
  delete saved.employeeJobPriorities;
  const restored = PlayerState.deserialize(saved);
  assert.equal(restored.globalReputation, 2);
  assert.equal(restored.shopLevel, 1);
  assert.deepEqual(restored.hiredEmployees, ["tavi_stock_clerk"]);
  assert.equal(restored.moveEmployeeJobPriority("tavi_stock_clerk", "stock_shelves", -1), true);
});

test("older level-capped saves catch up to earned reputation without reducing saved levels", () => {
  const saved = new PlayerState().serialize();
  saved.shopLevel = 2;
  saved.globalReputation = 60;
  assert.equal(PlayerState.deserialize(saved).shopLevel, 4);
  saved.shopLevel = 4;
  saved.globalReputation = -5;
  assert.equal(PlayerState.deserialize(saved).shopLevel, 4);
});

test("previously signed contracts and hired staff remain owned below their new unlock levels", () => {
  const saved = new PlayerState().serialize();
  saved.globalReputation = 2;
  saved.shopLevel = 2;
  saved.activeLicenses.push("lic_start_apparel", "lic_fixture_expanded");
  saved.hiredEmployees = ["tavi_stock_clerk"];
  delete saved.employeeJobPriorities;
  const restored = PlayerState.deserialize(saved);
  assert.equal(restored.shopLevel, 2);
  assert.equal(restored.activeLicenses.has("lic_start_apparel"), true);
  assert.equal(restored.activeLicenses.has("lic_fixture_expanded"), true);
  assert.deepEqual(restored.hiredEmployees, ["tavi_stock_clerk"]);
  assert.equal(restored.moveEmployeeJobPriority("tavi_stock_clerk", "stock_shelves", -1), true);
});

test("one shift can earn multiple levels without applying reputation early", () => {
  const state = new PlayerState();
  state.addReputation(2465);
  assert.equal(state.globalReputation, 0);
  assert.equal(state.shopLevel, 1);
  state.finishShift({ customersServed: 1, customersTurnedAway: 0 });
  assert.equal(state.globalReputation, 2465);
  assert.equal(state.shopLevel, 30);
});

test("pending reputation survives a player-state round trip without being applied early", () => {
  const state = new PlayerState();
  state.addReputation(3, "explorers");
  const restored = PlayerState.deserialize(JSON.parse(JSON.stringify(state.serialize())));
  assert.equal(restored.globalReputation, 0);
  assert.equal(restored.factionReputation.explorers, 0);
  restored.finishShift({ customersServed: 3, customersTurnedAway: 0 });
  assert.equal(restored.globalReputation, 3);
  assert.equal(restored.factionReputation.explorers, 3);
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
  const state = new PlayerState();
  unlockStaff(state);
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

test("training takes a paid shift, survives saves, and permanently raises wages and rehiring costs", () => {
  const state = new PlayerState();
  unlockStaff(state);
  assert.equal(state.hireEmployee("tavi_stock_clerk"), true);
  assert.equal(state.trainEmployee("tavi_stock_clerk", "register"), true);
  assert.equal(state.credits, 1000);
  assert.equal(balanceOf(state), 1000);
  assert.deepEqual(state.employeeTraining, { tavi_stock_clerk: "register" });
  assert.equal(state.getEmployeeProfile("tavi_stock_clerk").skillLevels.register, 1);
  assert.equal(state.getEmployeeProfile("tavi_stock_clerk").wagePerShift, 50);
  assert.equal(state.trainEmployee("tavi_stock_clerk", "stock_shelves"), false);
  assert.equal(state.fireEmployee("tavi_stock_clerk"), false);
  assert.deepEqual(state.dayLedger.lines.find(({ category }) => category === "training"), {
    category: "training", label: "Tavi: Run register Level 2", quantity: 1, amount: -250,
  });

  const restored = PlayerState.deserialize(state.serialize());
  assert.deepEqual(restored.employeeTraining, state.employeeTraining);
  restored.finishShift({ customersServed: 0, customersTurnedAway: 0 });
  const trained = restored.getEmployeeProfile("tavi_stock_clerk");
  assert.equal(trained.skillLevels.register, 2);
  assert.equal(trained.skillLevels.stock_shelves, 1);
  assert.equal(trained.wagePerShift, 55);
  assert.equal(trained.hireCost, 313);
  assert.deepEqual(restored.employeeTraining, {});
  assert.equal(restored.fireEmployee("tavi_stock_clerk"), true);

  const rehired = PlayerState.deserialize(restored.serialize());
  assert.equal(rehired.getEmployeeProfile("tavi_stock_clerk").wagePerShift, 55);
  assert.equal(rehired.hireEmployee("tavi_stock_clerk"), true);
  assert.equal(rehired.credits, 687);
  assert.equal(rehired.getEmployeeProfile("tavi_stock_clerk").skillLevels.register, 2);
  assert.equal(state.getEmployeeProfile("tavi_stock_clerk").skillLevels.register, 1);
});

test("each employee skill trains separately to Level 5 at increasingly higher prices", () => {
  const state = new PlayerState();
  unlockStaff(state);
  state.addCredits(10000, { category: "sales", label: "Training test" });
  state.hireEmployee("tavi_stock_clerk");
  for (const jobId of ["register", "stock_shelves", "load_storage"]) {
    let previousCost = 0;
    for (let level = 2; level <= 5; level += 1) {
      const before = state.credits;
      assert.equal(state.trainEmployee("tavi_stock_clerk", jobId), true);
      assert.ok(before - state.credits > previousCost);
      previousCost = before - state.credits;
      state.finishShift({ customersServed: 0, customersTurnedAway: 0 });
      assert.equal(state.getEmployeeProfile("tavi_stock_clerk").skillLevels[jobId], level);
      state.endDay(state.dayLedger.day + 1);
    }
    const before = state.credits;
    assert.equal(state.trainEmployee("tavi_stock_clerk", jobId), false);
    assert.equal(state.credits, before);
  }
  assert.equal(state.getEmployeeProfile("tavi_stock_clerk").wagePerShift, 110);
  assert.equal(state.getEmployeeProfile("tavi_stock_clerk").hireCost, 1000);
});

test("training rejects unaffordable and unhired staff and older saves start with Level 1 skills", () => {
  const state = new PlayerState();
  unlockStaff(state);
  assert.equal(state.trainEmployee("tavi_stock_clerk", "register"), false);
  state.hireEmployee("tavi_stock_clerk");
  state.spendCredits(1250, { category: "stock_orders", label: "Supplies" });
  assert.equal(state.trainEmployee("tavi_stock_clerk", "register"), false);
  assert.deepEqual(state.employeeTraining, {});
  const oldSave = state.serialize();
  delete oldSave.employeeSkills;
  delete oldSave.employeeTraining;
  const restored = PlayerState.deserialize(oldSave);
  assert.deepEqual(restored.getEmployeeProfile("tavi_stock_clerk").skillLevels, {
    register: 1, stock_shelves: 1, load_storage: 1,
  });
  assert.deepEqual(restored.employeeTraining, {});
});

test("hovercart upgrades cost more for each five-space increase and stop at 40", () => {
  const state = new PlayerState();
  state.shopLevel = 30;
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
  state.shopLevel = 3;
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

test("each hovercart upgrade waits for its Shop Level", () => {
  const state = new PlayerState();
  assert.equal(state.upgradeHovercart(), false, "Shop Level 1 cannot upgrade");
  assert.equal(state.hovercart.capacity, 15);
  assert.equal(state.credits, 1500);
  state.shopLevel = 3;
  assert.equal(state.upgradeHovercart(), true);
  assert.equal(state.hovercart.capacity, 20);
  assert.equal(state.upgradeHovercart(), false, "25 spaces needs Shop Level 8");
  state.shopLevel = 8;
  assert.equal(state.upgradeHovercart(), true);
  assert.equal(state.hovercart.capacity, 25);
});

test("receipts describe fixture resale and hovercart upgrades separately", () => {
  const state = new PlayerState();
  state.shopLevel = 3;
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
  unlockStaff(state);
  state.addCredits(1.23, { category: "sales", label: "Ration" });
  state.addCredits(2.34, { category: "sales", label: "Ration" });
  state.spendCredits(25, { category: "delivery_fees", label: "Delivery fee" });
  assert.equal(state.hireEmployee("tavi_stock_clerk", 250), true);
  assert.equal(state.credits, 1228.57);
  assert.equal(state.dayLedger.lines[0].amount, 3.57);
  state.finishShift({ customersServed: 2, customersTurnedAway: 0 });
  state.endDay(3);
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
  assert.equal(state.dayLedger.openingReputation, 3);
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
    pendingReputationChange: null,
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
    "Supply: Pulse Rifle (1 crate)", "-120 credits",
    "Delivery fees (1 order)", "Wages paid to Tavi (Stock Clerk)",
    "Credits at the start of the day", "1,000 credits",
    "Total earned", "Total spent", "-195 credits",
    "Credits", "1,105 credits",
    "Customers served", "Customers turned away (store was full)",
    "END DAY 2", "moves to Day 3",
  ]) {
    assert.ok(html.includes(text), `missing "${text}"`);
  }
  assert.doesNotMatch(html, /data-finances-start-shift/);
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
  const css = await readFile(new URL("../styles/space_dealer_window.css", import.meta.url), "utf8");
  assert.match(css, /\.finances-section-title\s*\{[^}]*font-size:\s*var\(--font-size-18\)/s);
  assert.match(css, /\.finances-balance\s*\{[^}]*margin:\s*10px 0/s);
});

test("all receipt totals, reputation, and customer counts use larger text", async () => {
  const view = financesView();
  const html = FinancesRenderer.generateHTML({ ...view, lastDay: view.today });
  const sections = html.split('<div class="finances-totals">').slice(1);
  assert.equal(sections.length, 2);
  for (const section of sections) {
    for (const label of [
      "Total earned", "Total spent", "Credits", "Store reputation change",
      "Customers served", "Customers turned away (store was full)",
    ]) {
      assert.ok(section.includes(label), `missing "${label}" from a totals section`);
    }
  }
  const css = await readFile(new URL("../styles/space_dealer_window.css", import.meta.url), "utf8");
  assert.match(css, /\.finances-totals\s+\.finances-row\s*\{[^}]*font-size:\s*var\(--font-size-18\)/s);
});

test("the Finances tab offers End Day only after the shift, and Start Shift once the day is ended", () => {
  const running = FinancesRenderer.generateHTML(financesView({
    shiftRunning: true, awaitingEndDay: false, pendingReputationChange: 3,
  }));
  assert.doesNotMatch(running, /data-end-day|data-finances-start-shift/);
  assert.match(running, /SO FAR/);
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
  const ids = ["hud-credits", "hud-rep", "hud-shop-level", "hud-hovercart", "hud-shift-time", "hud-pause-btn",
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

  const state = new PlayerState();
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
  state.endDay(2);
  assert.deepEqual(visible(), ["hud-start-shift-btn"]);
});

test("a loan is received, saved, repaid from later days' sales, and paid off", () => {
  const state = new PlayerState();
  state.spendCredits(1700, { category: "wages", label: "Tavi" });
  assert.equal(state.takeEmergencyLoan(1200, 1500), true);
  assert.equal(state.takeEmergencyLoan(1200, 1500), false, "one loan at a time");
  assert.equal(state.credits, 1000);
  assert.deepEqual(state.emergencyLoan, { balance: 1500, takenOnDay: 1 });

  // No repayment on the day the loan was taken, even with sales.
  state.addCredits(400, { category: "sales", label: "Rations", quantity: 4 });
  state.endDay(2);
  assert.equal(state.emergencyLoan.balance, 1500);
  assert.equal(state.credits, 1400);

  state.addCredits(800, { category: "sales", label: "Rations", quantity: 8 });
  state.endDay(3);
  assert.equal(state.emergencyLoan.balance, 1300);
  assert.equal(state.credits, 2000);
  const repayment = state.lastDayReceipt.lines.find((line) => line.category === "loan_repayments");
  assert.equal(repayment.amount, -200);

  const restored = PlayerState.deserialize(JSON.parse(JSON.stringify(state.serialize())));
  assert.deepEqual(restored.emergencyLoan, { balance: 1300, takenOnDay: 1 });

  assert.equal(restored.payOffEmergencyLoan(), true);
  assert.equal(restored.emergencyLoan, null);
  assert.equal(restored.credits, 700);
  assert.equal(restored.payOffEmergencyLoan(), false);
});
