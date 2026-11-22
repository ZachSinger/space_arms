import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "vite";
import { summarizeSupplyOrder, DELIVERY_FEE } from "../js/logic/SupplyOrder.js";
import { GAME_EVENTS } from "../js/core/Events.js";
import { isMoney } from "../js/logic/Money.js";
import { InventoryRenderer } from "../js/logic/InventoryRenderer.js";
import { SupplierLicense } from "../js/logic/Licenses.js";

let server;
let ManagerTablet;
let SupplyTab;
let EmployeeTab;
let FixturesTab;
let LayoutTab;
let GameState;
let cacheDirectory;
const originalDocument = globalThis.document;
const originalElement = globalThis.Element;

class TestElement {}

before(async () => {
  globalThis.Element = TestElement;
  cacheDirectory = await mkdtemp(join(fileURLToPath(new URL("..", import.meta.url)), ".pricing-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    plugins: [{
      name: "inventory-pricing-test-stubs",
      enforce: "pre",
      resolveId(source) {
        if (source === "../scenes/boot.js") return "\0inventory-test-database";
        if (source === "./UIWindow.js") return "\0inventory-test-window";
        if (source === "./FixtureHighlight.js") return "\0inventory-test-highlight";
        if (source === "./Sfx.js") return "\0inventory-test-sfx";
      },
      load(id) {
        if (id === "\0inventory-test-sfx") {
          return "export function playErrorBuzz() { globalThis.__supplyErrorBuzzes += 1; }";
        }
        if (id === "\0inventory-test-highlight") {
          return "export class FixtureHighlight { reset() {} destroy() {} }";
        }
        if (id === "\0inventory-test-database") {
          return `export const database = {
            getAllLicenses: () => [],
            getLicense: (id) => globalThis.__inventoryTestLicenses?.get(id),
          };`;
        }
        if (id === "\0inventory-test-window") {
          return "export class UIWindow { constructor() { this.element = globalThis.__inventoryTestWindow; } }";
        }
      },
    }],
  });
  ({ ManagerTablet } = await server.ssrLoadModule("/js/logic/ManagerTablet.js"));
  ({ SupplyTab } = await server.ssrLoadModule("/js/logic/SupplyTab.js"));
  ({ EmployeeTab } = await server.ssrLoadModule("/js/logic/EmployeeTab.js"));
  ({ FixturesTab } = await server.ssrLoadModule("/js/logic/FixturesTab.js"));
  ({ LayoutTab } = await server.ssrLoadModule("/js/logic/LayoutTab.js"));
  ({ GameState } = await server.ssrLoadModule("/js/state/GameState.js"));
});

after(async () => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalElement === undefined) delete globalThis.Element;
  else globalThis.Element = originalElement;
  delete globalThis.__inventoryTestWindow;
  delete globalThis.__supplyErrorBuzzes;
  delete globalThis.__inventoryTestLicenses;
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

test("Inventory shows whether an item follows the market price", () => {
  const html = InventoryRenderer.generateHTML([{
    item: { id: "rifle", name: "Rifle" },
    stock: 1,
    offShelves: 0,
    unitCost: 80,
    storePrice: 100,
    marketPricePinned: true,
  }]);

  assert.match(html, /FOLLOWING MARKET/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /This price will match the market whenever it changes/);
});

function createHarness() {
  const events = () => ({
    listeners: new Map(),
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    },
    emit(type, event) {
      for (const listener of this.listeners.get(type) || []) listener(event);
    },
  });
  const body = events();
  const tabBar = events();
  const list = { scrollTop: 37, querySelectorAll: () => [] };
  const supplyList = { scrollTop: 0 };
  const supplyPanel = events();
  supplyPanel.querySelector = (selector) => selector === ".supply-list" ? supplyList : null;
  const employeePanel = {
    contains: (element) => element !== null,
    querySelectorAll: () => [],
    set innerHTML(markup) { this.markup = markup; },
  };
  const contractsPanel = {
    contains: (element) => element !== null,
    set innerHTML(markup) { this.markup = markup; },
  };
  const fixtureLists = {
    ".fixtures-catalog-list": { scrollTop: 0 },
    ".fixtures-owned-list": { scrollTop: 0 },
  };
  const fixturesPanel = {
    contains: (element) => element !== null,
    querySelector: (selector) => fixtureLists[selector] ?? null,
    set innerHTML(markup) {
      this.markup = markup;
      for (const list of Object.values(fixtureLists)) list.scrollTop = 0;
    },
  };
  const layoutList = { scrollTop: 23 };
  const layoutPanel = {
    contains: (element) => element !== null,
    querySelector: (selector) => selector === ".layout-expansions-list" ? layoutList : null,
    set innerHTML(_markup) { layoutList.scrollTop = 0; },
  };
  const financesDayList = { scrollTop: 0 };
  const financesPanel = {
    contains: (element) => element !== null,
    querySelector: (selector) => selector === ".finances-day-list" ? financesDayList : null,
    set innerHTML(_markup) { financesDayList.scrollTop = 0; },
  };
  const handbookPanel = {
    contains: (element) => element !== null,
    set innerHTML(markup) { this.markup = markup; },
  };
  const document = { activeElement: null };
  globalThis.document = document;

  const focus = (next) => {
    const previous = document.activeElement;
    if (previous === next) return;
    if (previous) body.emit("focusout", { target: previous, relatedTarget: next });
    document.activeElement = next;
    if (next) body.emit("focusin", { target: next, relatedTarget: previous });
  };
  const control = (kind, itemId, action, value) => Object.assign(new TestElement(), {
    kind,
    dataset: { priceItemId: itemId, priceAction: action },
    value,
    matches(selector) {
      return selector.split(",").some((part) => {
        switch (part.trim()) {
          case "[data-price-item-id]": return true;
          case "[data-price-action]": return this.kind === "button";
          case "input[data-price-item-id]": return this.kind === "input";
          case "button[data-price-action]": return this.kind === "button";
          default: return false;
        }
      });
    },
    closest(selector) {
      if (selector === ".inventory-item-card") {
        return {
          querySelector: (query) =>
            query === "[data-inventory-profit]" ? panel.profits.get(itemId) : null,
        };
      }
      return this.matches(selector) ? this : null;
    },
    focus() { focus(this); },
    blur() { if (document.activeElement === this) focus(null); },
    setAttribute(name, value) { this[name] = value; },
  });
  const panel = {
    controls: [],
    renderCount: 0,
    contains(element) { return this.controls.includes(element); },
    querySelector(selector) {
      if (selector === ".inventory-list") return list;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "input[data-price-item-id]") {
        return this.controls.filter((item) => item.kind === "input");
      }
      return this.controls.filter((item) => item.kind === "button");
    },
    set innerHTML(markup) {
      if (this.contains(document.activeElement)) focus(null);
      this.renderCount += 1;
      this.markup = markup;
      this.controls = [];
      this.profits = new Map(
        [...markup.matchAll(/data-item-id="([^"]+)"[\s\S]*?(<span class="inventory-profit [^"]+" data-inventory-profit[^>]*>[^<]*<\/span>)/g)]
          .map(([, itemId, html]) => [itemId, { outerHTML: html }]),
      );
      for (const [, value, itemId] of markup.matchAll(
        /<input\b[^>]*value="([^"]*)"[^>]*data-price-item-id="([^"]*)"[^>]*>/g,
      )) {
        this.controls.push(control("input", itemId, undefined, value));
      }
      for (const [, action, itemId] of markup.matchAll(
        /<button\b[^>]*data-price-action="([^"]*)"[^>]*data-price-item-id="([^"]*)"[^>]*>/g,
      )) {
        this.controls.push(control("button", itemId, action));
      }
    },
    input(itemId) {
      return this.controls.find((item) => item.kind === "input" && item.dataset.priceItemId === itemId);
    },
    button(itemId, action) {
      return this.controls.find((item) =>
        item.kind === "button" &&
        item.dataset.priceItemId === itemId &&
        item.dataset.priceAction === action,
      );
    },
    profit(itemId) { return this.profits.get(itemId)?.outerHTML; },
  };
  body.querySelector = (selector) => {
    if (selector === ".tablet-tab-bar") return tabBar;
    if (selector === '[data-tab-panel="inventory"]') return panel;
    if (selector === '[data-tab-panel="employee"]') return employeePanel;
    if (selector === '[data-tab-panel="contracts"]') return contractsPanel;
    if (selector === '[data-tab-panel="supply"]') return supplyPanel;
    if (selector === '[data-tab-panel="fixtures"]') return fixturesPanel;
    if (selector === '[data-tab-panel="layout"]') return layoutPanel;
    if (selector === '[data-tab-panel="finances"]') return financesPanel;
    if (selector === '[data-tab-panel="handbook"]') return handbookPanel;
    return null;
  };
  body.querySelectorAll = () => [];
  globalThis.__inventoryTestWindow = {
    querySelector(selector) {
      if (selector === ".retro-window-body") return body;
      if (selector === ".inventory-list") return list;
      return null;
    },
  };

  const prices = new Map([["rifle", 100], ["pistol", 200]]);
  const marketPrices = new Map([["rifle", 275], ["pistol", 250]]);
  const unitCosts = new Map([["rifle", 80], ["pistol", 250]]);
  const gameState = new GameState({ items: [] });
  gameState.market.getPrice = (itemId) => marketPrices.get(itemId);
  const eventBus = {
    listeners: new Map(),
    on(event, listener) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(listener);
    },
    emit(event, payload) {
      for (const listener of this.listeners.get(event) || []) listener(payload);
    },
  };
  const keyboard = {
    enabled: true,
    disableGlobalCapture() {},
    enableGlobalCapture() {},
    resetKeys() {},
  };
  const scene = {
    gameState,
    eventBus,
    input: { keyboard },
    employees: [],
    customerCartCount: 0,
    staffSystem: { canManage: () => true },
    saves: { loadFailed: false },
    offShelves: 1,
    catalogSystem: {
      getStorePrice: (itemId) => prices.get(itemId),
      setStorePrice(itemId, price) {
        if (!isMoney(price) || price < 1) return false;
        prices.set(itemId, price);
        gameState.catalog.setPrice(itemId, price);
        gameState.shop.changed();
        return true;
      },
      setMarketPricePinned(itemId, pinned) {
        gameState.catalog.setMarketPricePinned(itemId, pinned, marketPrices.get(itemId));
        if (pinned) prices.set(itemId, marketPrices.get(itemId));
        gameState.shop.changed();
      },
      getInventoryItems() {
        return ["rifle", "pistol"].map((itemId) => ({
          item: { id: itemId, name: itemId },
          offShelves: scene.offShelves,
          stock: 0,
          inCustomerCarts: scene.customerCartCount,
          marketPrice: marketPrices.get(itemId),
          unitCost: unitCosts.get(itemId),
          storePrice: prices.get(itemId),
          marketPricePinned: gameState.catalog.marketPricePinnedItems.has(itemId),
        }));
      },
    },
    supply: {
      restockableItems: () => [],
      orderSummary: () => ({ crates: 0, maxCrates: 9, stockCost: 0, deliveryFee: 0, total: 0, problem: null, canPlace: false }),
      freePadSpots: () => [],
    },
    fixtureSystem: {
      canRearrange: () => false,
      canExpand: () => false,
      purchaseOptions: () => [],
      expansionOptions: () => [],
      backroomOptions: () => [],
    },
    shift: { financesView: () => ({
      day: 1,
      shiftRunning: false,
      awaitingEndDay: false,
      canEndDay: false,
      today: {
        day: 1, openingCredits: 1500, closingCredits: 1500, reputationChange: 0,
        earned: [], spent: [], totalEarned: 0, totalSpent: 0, shift: null,
      },
      receipts: [],
      lifetime: { daysCompleted: 0, totalSales: 0, customersServed: 0 },
    }) },
    fixtures: { all: () => [], registers: () => [], displayName: () => "" },
  };
  const tablet = new ManagerTablet({}, gameState, scene);
  const click = (itemId, action) => {
    const button = panel.button(itemId, action);
    focus(button);
    body.emit("click", { target: button });
  };
  return { body, click, document, focus, keyboard, list, marketPrices, panel, scene, tablet };
}

test("inventory calculates profit per item from supplier cost, not market price", () => {
  const html = InventoryRenderer.generateHTML([
    { item: { id: "rifle", name: "Rifle" }, stock: 3, offShelves: 7, marketPrice: 20.88, unitCost: 12.34, storePrice: 30.56 },
    { item: { id: "pistol", name: "Pistol" }, stock: 2, marketPrice: 12, unitCost: 15.10, storePrice: 10.05 },
    { item: { id: "kit", name: "Kit" }, stock: 1, marketPrice: 7, unitCost: 10, storePrice: 10 },
  ]);

  assert.deepEqual(
    [...html.matchAll(/<h3 class="type-h3">([^<]+)<\/h3>/g)].map(([, label]) => label),
    ["Name", "On Shelves", "In Crates", "Price", "Profit"],
  );
  assert.match(html, /data-inventory-stock[^>]*>3</);
  assert.match(html, /data-inventory-crates[^>]*>7</);
  assert.match(html, /inventory-profit positive" data-inventory-profit[^>]*>18\.22</);
  assert.match(html, /inventory-profit negative" data-inventory-profit[^>]*>-5\.05</);
  assert.match(html, /inventory-profit neutral" data-inventory-profit[^>]*>0</);
  assert.match(html, /Delivery fees are not included/);
  assert.doesNotMatch(html, /Off Shelves|In Carts|data-inventory-carts|data-inventory-market/);
});

test("the Inventory tab escapes item data in text and attributes", () => {
  const markup = InventoryRenderer.generateHTML([{
    item: {
      id: 'rifle" onclick="run()',
      name: '<img src=x onerror="run()"> & Supply',
      image: 'images/" onerror="run()',
    },
    stock: 0,
    offShelves: 0,
    unitCost: 1,
    storePrice: 2,
  }]);

  assert.match(markup, /&lt;img src=x onerror=&quot;run\(\)&quot;&gt; &amp; Supply/);
  assert.match(markup, /data-item-id="rifle&quot; onclick=&quot;run\(\)"/);
  assert.match(markup, /src="images\/&quot; onerror=&quot;run\(\)"/);
  assert.doesNotMatch(markup, /<img src=x onerror=/);
  assert.doesNotMatch(markup, /data-item-id="rifle" onclick=/);
});

test("price buttons update the displayed value and retain keyboard focus", () => {
  const h = createHarness();
  h.click("rifle", "increase");
  assert.equal(h.panel.input("rifle").value, "110");
  assert.match(h.panel.profit("rifle"), />30<\/span>/);
  assert.equal(h.scene.catalogSystem.getStorePrice("rifle"), 110);
  assert.equal(h.document.activeElement, h.panel.button("rifle", "increase"));
  assert.equal(h.keyboard.enabled, false);

  const focusedButton = h.document.activeElement;
  h.body.emit("keydown", { target: focusedButton, key: "Enter" });
  assert.equal(h.document.activeElement, focusedButton);
  h.body.emit("click", { target: focusedButton });
  assert.equal(h.panel.input("rifle").value, "121");

  h.click("rifle", "decrease");
  assert.equal(h.panel.input("rifle").value, "108.9");
  const profitBeforeMarketChange = h.panel.profit("rifle");
  h.marketPrices.set("rifle", 300);
  h.scene.gameState.shop.changed();
  assert.equal(h.panel.profit("rifle"), profitBeforeMarketChange);
  h.click("rifle", "market");
  assert.equal(h.panel.input("rifle").value, "300");
  assert.match(h.panel.profit("rifle"), />220<\/span>/);
  assert.equal(h.panel.input("pistol").value, "200");
  assert.equal(h.list.scrollTop, 37);
  h.focus(null);
  assert.equal(h.keyboard.enabled, true);
});

test("Inventory can keep an item at market price until the player changes it", () => {
  const h = createHarness();
  h.click("rifle", "pin");

  assert.equal(h.scene.catalogSystem.getStorePrice("rifle"), 275);
  assert.equal(h.scene.gameState.catalog.marketPricePinnedItems.has("rifle"), true);

  h.click("rifle", "increase");
  assert.equal(h.scene.catalogSystem.getStorePrice("rifle"), 302.5);
  assert.equal(h.scene.gameState.catalog.marketPricePinnedItems.has("rifle"), false);
});

test("committing a typed price updates profit without replacing the next price button", async () => {
  const h = createHarness();
  const input = h.panel.input("rifle");
  h.focus(input);
  input.value = "95.37";
  const renders = h.panel.renderCount;
  h.body.emit("change", { target: input });
  assert.equal(h.scene.catalogSystem.getStorePrice("rifle"), 95.37);
  assert.match(h.panel.profit("rifle"), />15\.37<\/span>/);
  assert.equal(h.panel.renderCount, renders);

  const button = h.panel.button("rifle", "increase");
  h.focus(button);
  assert.equal(h.panel.contains(button), true);
  assert.match(h.panel.profit("rifle"), />15\.37<\/span>/);
  h.focus(null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(h.panel.profit("rifle"), />15\.37<\/span>/);
});

test("contract signing enforces each shop level without spending credits early", async () => {
  const data = JSON.parse(await readFile(new URL("../data/Licenses.json", import.meta.url), "utf8"));
  globalThis.__inventoryTestLicenses = new Map(
    data.map((license) => [license.id, new SupplierLicense(license)]),
  );
  const warnings = [];
  const state = new GameState({ items: [] });
  state.reputation.global = 1000;
  const tablet = Object.create(ManagerTablet.prototype);
  tablet.gameState = state;
  tablet.scene = {
    messages: { show: (message) => warnings.push(message) },
    catalogSystem: { recalculateActiveFactions() {} },
  };
  tablet.handleSignContract("lic_start_apparel");
  assert.equal(state.economy.credits, 1500);
  assert.equal(state.catalog.owns("lic_start_apparel"), false);
  assert.match(warnings[0], /locked.*requirements/i);

  state.reputation.shopLevel = 6;
  state.reputation.global = -5;
  tablet.handleSignContract("lic_start_apparel");
  assert.equal(state.economy.credits, 400);
  assert.equal(state.catalog.owns("lic_start_apparel"), true);
  assert.deepEqual(state.economy.dayLedger.lines.map((line) => line.category), ["licenses"]);
});

test("Contracts tab routes signing to the tablet contract action", () => {
  const { body, tablet } = createHarness();
  const signed = [];
  tablet.handleSignContract = (licenseId) => signed.push(licenseId);
  const button = Object.assign(new TestElement(), {
    dataset: { licenseId: "lic_start_rations" },
    closest(selector) { return selector === "[data-license-id]" ? this : null; },
  });

  body.emit("click", { target: button });

  assert.deepEqual(signed, ["lic_start_rations"]);
});

test("Fixtures tab routes purchase, move, and crate actions", () => {
  const { body, scene, tablet } = createHarness();
  const calls = [];
  scene.fixtureSystem.buy = (typeId) => { calls.push(["buy", typeId]); return true; };
  scene.fixtureSystem.crate = (fixtureId) => calls.push(["crate", fixtureId]);
  scene.fixturePlacement = { begin: (fixtureId) => calls.push(["move", fixtureId]) };
  const control = (attribute, key, value) => Object.assign(new TestElement(), {
    dataset: { [key]: value },
    closest(selector) { return selector === attribute ? this : null; },
  });

  body.emit("click", {
    target: control("[data-buy-fixture-id]", "buyFixtureId", "shelf_budget_2x2"),
  });
  body.emit("click", {
    target: control("[data-move-fixture-id]", "moveFixtureId", "fixture-1"),
  });
  body.emit("click", {
    target: control("[data-crate-fixture-id]", "crateFixtureId", "fixture-1"),
  });

  assert.deepEqual(calls, [
    ["buy", "shelf_budget_2x2"],
    ["move", "fixture-1"],
    ["crate", "fixture-1"],
  ]);
  assert.match(tablet.fixturesTab.purchaseNotice, /Bought BUDGET SHELF 2x2/);
});

test("Layout tab routes floor and backroom expansion purchases", () => {
  const { body, scene } = createHarness();
  const calls = [];
  scene.fixtureSystem.buyExpansion = (expansionId) => calls.push(["floor", expansionId]);
  scene.fixtureSystem.buyBackroomUpgrade = (upgradeId) => calls.push(["backroom", upgradeId]);
  const control = (attribute, key, value) => Object.assign(new TestElement(), {
    dataset: { [key]: value },
    closest(selector) { return selector === attribute ? this : null; },
  });

  body.emit("click", {
    target: control("[data-buy-expansion-id]", "buyExpansionId", "expansion_west"),
  });
  body.emit("click", {
    target: control("[data-buy-backroom-id]", "buyBackroomId", "backroom_a"),
  });

  assert.deepEqual(calls, [
    ["floor", "expansion_west"],
    ["backroom", "backroom_a"],
  ]);
});

test("Finances tab routes day selection and shift and loan actions", () => {
  const { body, scene, tablet } = createHarness();
  const calls = [];
  scene.shift.start = () => calls.push("start");
  scene.shift.endDay = () => { calls.push("end-day"); return true; };
  scene.shift.takeLoan = () => calls.push("take-loan");
  scene.shift.payOffLoan = () => calls.push("pay-off-loan");
  tablet.uiWindow.close = () => calls.push("close");
  const click = (selector, dataset = {}) => body.emit("click", {
    target: Object.assign(new TestElement(), {
      dataset,
      closest(candidate) { return candidate === selector ? this : null; },
    }),
  });

  click("[data-finances-day]", { financesDay: "2" });
  assert.equal(tablet.financesTab.selectedDay, 2);
  click("[data-finances-day]", { financesDay: "today" });
  assert.equal(tablet.financesTab.selectedDay, null);
  click("[data-finances-start-shift]");
  click("[data-end-day]");
  click("[data-take-emergency-loan]");
  click("[data-pay-off-emergency-loan]");

  assert.deepEqual(calls, ["start", "end-day", "close", "take-loan", "pay-off-loan"]);
});

test("Handbook tab routes topic selection and redraws its content", () => {
  const { body, tablet } = createHarness();
  const topicButton = Object.assign(new TestElement(), {
    dataset: { handbookTopic: "levels" },
    closest(selector) { return selector === "[data-handbook-topic]" ? this : null; },
  });

  body.emit("click", { target: topicButton });

  assert.equal(tablet.handbookTab.topic, "levels");
  assert.match(tablet.handbookTab.panel.markup, /What Each Level Unlocks/);
});

test("refreshing Finances preserves the day list scroll position", () => {
  const { tablet } = createHarness();
  const dayList = tablet.financesTab.panel.querySelector(".finances-day-list");
  dayList.scrollTop = 87;

  tablet.refreshFinancesPanel();

  assert.equal(dayList.scrollTop, 87);
});

test("opening the tablet hides checkout and closing it resumes register work", () => {
  const { scene, tablet } = createHarness();
  const calls = [];
  scene.checkoutWindow = { suspend: () => calls.push("suspend") };
  scene.checkoutSystem = { resumeRegisterCheckout: () => calls.push("resume") };
  tablet.uiWindow.openWindow = () => calls.push("tablet-open");
  tablet.openWindow();
  assert.deepEqual(calls, ["tablet-open", "suspend"]);
  tablet.fixturesTab.purchaseNotice = "Bought a fixture.";
  tablet.fixturesTab.saleConfirmation = { name: "BUDGET SHELF 2x4" };
  tablet.uiWindow.onClose();
  assert.deepEqual(calls, ["tablet-open", "suspend", "resume"]);
  assert.equal(tablet.fixturesTab.purchaseNotice, "");
  assert.equal(tablet.fixturesTab.saleConfirmation, null);
});

test("reopening the tablet refreshes the employee panel", () => {
  const { scene, tablet } = createHarness();
  scene.checkoutWindow = { suspend() {} };
  scene.checkoutSystem = { resumeRegisterCheckout() {} };
  tablet.uiWindow.openWindow = () => {};
  tablet.uiWindow.onClose();
  let refreshed = 0;
  tablet.refreshEmployeePanel = () => { refreshed += 1; };
  tablet.openWindow();
  assert.equal(refreshed, 1);
});

test("employee priority choices put the chosen job first and ignore the selected job", () => {
  const { body, scene, tablet } = createHarness();
  const calls = [];
  scene.staffSystem.prioritizeJob = (...args) => { calls.push(args); return true; };
  const choice = (pressed) => Object.assign(new TestElement(), {
    dataset: { employeePriorityId: "tavi_stock_clerk", employeePriorityJob: "clean" },
    getAttribute: () => String(pressed),
    closest(selector) { return selector === "button[data-employee-priority-id]" ? this : null; },
  });
  body.emit("click", { target: choice(false) });
  assert.deepEqual(calls, [["tavi_stock_clerk", "clean"]]);
  body.emit("click", { target: choice(true) });
  assert.equal(calls.length, 1);

  let refreshed = 0;
  scene.staffSystem.prioritizeJob = () => false;
  tablet.employeeTab.redraw = () => { refreshed += 1; };
  body.emit("click", { target: choice(false) });
  assert.equal(refreshed, 1);
});

test("employee tab routes hiring and shift actions to the staff system", () => {
  const { body, scene, tablet } = createHarness();
  const calls = [];
  scene.staffSystem.hire = (employeeId) => calls.push(["hire", employeeId]);
  scene.staffSystem.setOnShift = (employeeId, onShift) => calls.push(["shift", employeeId, onShift]);
  tablet.employeeTab.redraw = () => calls.push(["redraw"]);
  const control = (attribute, dataset) => Object.assign(new TestElement(), {
    dataset,
    closest(selector) { return selector === attribute ? this : null; },
  });

  body.emit("click", {
    target: control("[data-hire-employee-id]", { hireEmployeeId: "tavi_stock_clerk" }),
  });
  body.emit("click", {
    target: control("[data-employee-shift-id]", {
      employeeShiftId: "tavi_stock_clerk",
      employeeShiftOn: "false",
    }),
  });

  assert.deepEqual(calls, [
    ["hire", "tavi_stock_clerk"],
    ["shift", "tavi_stock_clerk", false],
    ["redraw"],
  ]);
});

test("employee training choices stay independent and booking uses the chosen skill", () => {
  const { body, scene, tablet } = createHarness();
  const bookings = [];
  scene.staffSystem.train = (...args) => { bookings.push(args); return true; };
  let redraws = 0;
  tablet.employeeTab.redraw = () => { redraws += 1; };
  const control = (employeeId, jobId, action, disabled = false) => Object.assign(new TestElement(), {
    dataset: {
      employeeTrainingId: employeeId, employeeTrainingJob: jobId, employeeTrainingAction: action,
    },
    disabled,
    closest(selector) { return selector === "button[data-employee-training-id]" ? this : null; },
  });

  body.emit("click", { target: control("tavi_stock_clerk", "stock_shelves", "select") });
  body.emit("click", { target: control("sera_floor_assistant", "clean", "select") });
  assert.deepEqual(tablet.employeeTab.trainingSelection, {
    tavi_stock_clerk: "stock_shelves", sera_floor_assistant: "clean",
  });
  assert.deepEqual(bookings, []);
  body.emit("click", { target: control("tavi_stock_clerk", "stock_shelves", "book") });
  body.emit("click", { target: control("sera_floor_assistant", "clean", "book", true) });
  assert.deepEqual(bookings, [["tavi_stock_clerk", "stock_shelves"]]);
  assert.equal(redraws, 3);
});

test("a loaded training skill stays selected after that course finishes", () => {
  const { scene, tablet } = createHarness();
  const id = "tavi_stock_clerk";
  scene.gameState.reputation.shopLevel = 4;
  scene.gameState.staff.hired = [id];
  scene.gameState.staff.jobPriorities[id] = ["register", "stock_shelves", "clean"];
  scene.gameState.staff.training[id] = "clean";
  assert.match(tablet.employeeTab.draw(),
    /data-employee-training-job="clean"\s+data-employee-training-action="select" aria-pressed="true"/);

  delete scene.gameState.staff.training[id];
  scene.gameState.staff.skills[id] = { register: 1, stock_shelves: 1, clean: 2 };
  const finished = tablet.employeeTab.draw();
  assert.match(finished, /data-employee-training-job="clean"\s+data-employee-training-action="select" aria-pressed="true"/);
  assert.match(finished, /Cleaning speed: 120% → 140% of Level 1 speed/);
});

test("focused training buttons release game controls until focus leaves", () => {
  const h = createHarness();
  const button = Object.assign(new TestElement(), {
    matches(selector) {
      return selector.split(",").some((part) => part.trim() === "button[data-employee-training-id]");
    },
  });
  h.focus(button);
  assert.equal(h.keyboard.enabled, false);
  h.focus(null);
  assert.equal(h.keyboard.enabled, true);
});

test("employee jobs drag within one staff list and remain movable with keyboard buttons", () => {
  const { body, scene, tablet } = createHarness();
  const employeeId = "tavi_stock_clerk";
  // "register" is saved in the order but hidden from the list; moves skip over it.
  const priorities = ["stock_shelves", "register", "clean"];
  tablet.employeeTab.gameState.staff.jobPriorities[employeeId] = priorities;
  const moves = [];
  scene.staffSystem.moveJob = (...args) => {
    moves.push(args);
    const from = priorities.indexOf(args[1]);
    priorities.splice(from, 1);
    priorities.splice(args[2], 0, args[1]);
    return true;
  };
  tablet.employeeTab.redraw = () => {};
  const row = (id, job) => Object.assign(new TestElement(), {
    dataset: { employeeJobId: id, employeeJob: job },
    getAttribute: () => "true",
    getBoundingClientRect: () => ({ top: 10, height: 20 }),
    closest: function(selector) { return selector === "[data-employee-job-id]" ? this : null; },
  });
  const event = (target, clientY = 25) => ({
    target, clientY, prevented: false,
    preventDefault() { this.prevented = true; },
    dataTransfer: { setData() {} },
  });
  body.emit("dragstart", event(row(employeeId, "stock_shelves")));
  const over = event(row(employeeId, "clean"));
  body.emit("dragover", over);
  assert.equal(over.prevented, true);
  body.emit("drop", event(row(employeeId, "clean")));
  assert.deepEqual(priorities.filter((job) => job !== "register"), ["clean", "stock_shelves"]);

  body.emit("dragstart", event(row(employeeId, "stock_shelves")));
  body.emit("drop", event(row("sera_floor_assistant", "clean")));
  assert.equal(moves.length, 1, "a drop on another employee cannot change their jobs");
  body.emit("dragstart", event(row(employeeId, "stock_shelves")));
  scene.staffSystem.canManage = () => false;
  body.emit("drop", event(row(employeeId, "clean"), 12));
  assert.equal(moves.length, 1, "starting a shift during the drag cancels the change");
  const blocked = event(row(employeeId, "stock_shelves"));
  body.emit("dragstart", blocked);
  assert.equal(blocked.prevented, true);
  scene.staffSystem.canManage = () => true;

  const button = Object.assign(new TestElement(), {
    dataset: { employeePriorityId: employeeId, employeePriorityJob: "stock_shelves", employeePriorityMove: "up" },
    getAttribute: () => null,
    closest: function(selector) { return selector === "button[data-employee-priority-id]" ? this : null; },
  });
  body.emit("click", { target: button });
  assert.deepEqual(priorities.filter((job) => job !== "register"), ["stock_shelves", "clean"]);
  button.dataset.employeePriorityMove = "down";
  body.emit("click", { target: button });
  assert.deepEqual(priorities.filter((job) => job !== "register"), ["clean", "stock_shelves"]);
  button.disabled = true;
  body.emit("click", { target: button });
  assert.equal(moves.length, 3);
});

test("employee tab refresh preserves each column's scroll and priority focus", () => {
  const previousDocument = globalThis.document;
  const oldButton = {
    dataset: { employeePriorityId: "tavi_stock_clerk", employeePriorityJob: "register" },
    matches: (selector) => selector === "button[data-employee-priority-id]",
  };
  const newButton = { dataset: { ...oldButton.dataset }, focus: (options) => { newButton.focusOptions = options; } };
  const before = [
    { dataset: { employeeScroll: "hiring" }, scrollTop: 140 },
    { dataset: { employeeScroll: "staff" }, scrollTop: 72 },
  ];
  const after = before.map(({ dataset }) => ({ dataset: { ...dataset }, scrollTop: 0 }));
  let rendered = false;
  const panel = {
    contains: (element) => element === oldButton,
    querySelectorAll(selector) {
      if (selector === "[data-employee-scroll]") return rendered ? after : before;
      if (selector === "button[data-employee-priority-id]") return [newButton];
      return [];
    },
    set innerHTML(markup) { rendered = Boolean(markup); },
  };
  const employeeTab = new EmployeeTab({}, {});
  employeeTab.panel = panel;
  employeeTab.renderPanel = () => "updated";
  globalThis.document = { activeElement: oldButton };
  try {
    employeeTab.redraw();
    assert.deepEqual(after.map(({ scrollTop }) => scrollTop), [140, 72]);
    assert.deepEqual(newButton.focusOptions, { preventScroll: true });
  } finally {
    globalThis.document = previousDocument;
  }
});

test("employee training refresh preserves scroll and focus, including after booking", () => {
  const previousDocument = globalThis.document;
  const oldButton = {
    dataset: {
      employeeTrainingId: "tavi_stock_clerk", employeeTrainingJob: "clean", employeeTrainingAction: "book",
    },
    matches: (selector) => selector === "button[data-employee-training-id]",
  };
  const book = { dataset: { ...oldButton.dataset }, disabled: false, focus: (options) => { book.focusOptions = options; } };
  const skill = {
    dataset: { ...oldButton.dataset, employeeTrainingAction: "select" },
    focus: (options) => { skill.focusOptions = options; },
  };
  const before = { dataset: { employeeScroll: "staff" }, scrollTop: 140 };
  const after = { dataset: { employeeScroll: "staff" }, scrollTop: 0 };
  let rendered = false;
  const panel = {
    contains: (element) => element === oldButton,
    querySelectorAll(selector) {
      if (selector === "[data-employee-scroll]") return [rendered ? after : before];
      if (selector === "button[data-employee-training-id]") return [skill, book];
      return [];
    },
    set innerHTML(markup) { rendered = Boolean(markup); },
  };
  const employeeTab = new EmployeeTab({}, {});
  employeeTab.panel = panel;
  employeeTab.renderPanel = () => "updated";
  globalThis.document = { activeElement: oldButton };
  try {
    employeeTab.redraw();
    assert.equal(after.scrollTop, 140);
    assert.deepEqual(book.focusOptions, { preventScroll: true });

    book.disabled = true;
    delete book.focusOptions;
    employeeTab.redraw();
    assert.equal(after.scrollTop, 140);
    assert.equal(book.focusOptions, undefined);
    assert.deepEqual(skill.focusOptions, { preventScroll: true });
  } finally {
    globalThis.document = previousDocument;
  }
});

test("inventory refreshes when customers shop and finish checkout", () => {
  const h = createHarness();
  h.scene.customerCartCount = 2;
  const initialRenderCount = h.panel.renderCount;
  h.scene.eventBus.emit(GAME_EVENTS.INVENTORY_TRANSFERRED, {
    destination: "customer-cart",
  });
  assert.ok(h.panel.renderCount > initialRenderCount);
  assert.match(h.panel.markup, /data-inventory-stock/);
  assert.doesNotMatch(h.panel.markup, /IN CARTS|OFF SHELVES/);

  h.scene.customerCartCount = 0;
  const cartRenderCount = h.panel.renderCount;
  h.scene.eventBus.emit(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, {});
  assert.ok(h.panel.renderCount > cartRenderCount);
});

test("a typed price commits before a subsequent button click", async () => {
  const h = createHarness();
  const input = h.panel.input("rifle");
  h.focus(input);
  input.value = "200";
  h.body.emit("change", { target: input });
  assert.equal(h.tablet.inventoryTab.refreshPending, true);

  const renders = h.panel.renderCount;
  const button = h.panel.button("rifle", "increase");
  h.focus(button);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.panel.renderCount, renders);
  assert.equal(h.panel.contains(button), true);

  h.body.emit("click", { target: button });
  assert.equal(h.panel.input("rifle").value, "220");
  assert.equal(h.scene.catalogSystem.getStorePrice("rifle"), 220);
  assert.equal(h.tablet.inventoryTab.refreshPending, false);
  h.focus(null);
});

test("percentage buttons change low prices by at least one credit", () => {
  const h = createHarness();
  h.scene.catalogSystem.setStorePrice("rifle", 1);
  h.click("rifle", "increase");
  assert.equal(h.panel.input("rifle").value, "2");
  h.click("rifle", "decrease");
  assert.equal(h.panel.input("rifle").value, "1");
  h.click("rifle", "decrease");
  assert.equal(h.panel.input("rifle").value, "1");
  h.scene.catalogSystem.setStorePrice("rifle", 5);
  h.click("rifle", "decrease");
  assert.equal(h.panel.input("rifle").value, "4");
  h.focus(null);
});

test("pending changes refresh when leaving price controls", async () => {
  const h = createHarness();
  h.focus(h.panel.input("rifle"));
  h.scene.offShelves = 5;
  h.scene.gameState.shop.changed();
  assert.equal(h.tablet.inventoryTab.refreshPending, true);
  h.focus(h.panel.button("rifle", "market"));
  h.focus(null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.tablet.inventoryTab.refreshPending, false);
  assert.doesNotMatch(h.panel.markup, /data-inventory-off-shelves/);
  assert.equal(h.keyboard.enabled, true);
});

function createSupplyHarness(credits) {
  const tablet = Object.create(ManagerTablet.prototype);
  const warnings = [];
  let refreshes = 0;
  globalThis.__supplyErrorBuzzes = 0;
  tablet.gameState = { economy: { credits } };
  tablet.supplyOrder = new Map();
  tablet.scene = {
    supply: {
      orderSummary: (order) => summarizeSupplyOrder(order, {
        getCrateCost: (id) => ({ ammo: 40, rations: 10 })[id],
        credits: tablet.gameState.economy.credits,
        freePadSpots: 9,
      }),
    },
    messages: { show: (message) => warnings.push(message) },
  };
  const supplyTab = new SupplyTab(tablet.scene);
  supplyTab.redraw = () => { refreshes += 1; };
  tablet.supplyTab = supplyTab;
  return { supplyTab, tablet, warnings, refreshes: () => refreshes, buzzes: () => globalThis.__supplyErrorBuzzes };
}

test("an unaffordable first crate is rejected with a warning and sound, including the delivery fee", () => {
  const h = createSupplyHarness(40 + DELIVERY_FEE - 1);
  h.supplyTab.changeOrder("ammo", 1);
  assert.deepEqual([...h.supplyTab.order], []);
  assert.match(h.warnings[0], /Not enough money/);
  assert.match(h.warnings[0], /costs 65/);
  assert.equal(h.buzzes(), 1);
  assert.equal(h.refreshes(), 0);
});

test("cart additions consider every crate already selected and allow the exact available budget", () => {
  const h = createSupplyHarness(40 + 10 + DELIVERY_FEE);
  h.supplyTab.changeOrder("ammo", 1);
  h.supplyTab.changeOrder("rations", 1);
  assert.deepEqual([...h.supplyTab.order], [["ammo", 1], ["rations", 1]]);
  assert.equal(h.warnings.length, 0);
  assert.equal(h.buzzes(), 0);
  assert.equal(h.refreshes(), 2);
  h.supplyTab.changeOrder("rations", 1);
  assert.deepEqual([...h.supplyTab.order], [["ammo", 1], ["rations", 1]]);
  assert.match(h.warnings[0], /costs 85/);
  assert.equal(h.buzzes(), 1);
});

test("adding another crate of the same item cannot exceed the budget", () => {
  const h = createSupplyHarness(40 + DELIVERY_FEE);
  h.supplyTab.changeOrder("ammo", 1);
  h.supplyTab.changeOrder("ammo", 1);
  assert.equal(h.supplyTab.order.get("ammo"), 1);
  assert.equal(h.buzzes(), 1);
});

test("lower funds reject additions but never prevent removing crates from the order", () => {
  const h = createSupplyHarness(1000);
  h.supplyTab.changeOrder("ammo", 1);
  h.tablet.gameState.economy.credits = 0;
  h.supplyTab.changeOrder("rations", 1);
  assert.deepEqual([...h.supplyTab.order], [["ammo", 1]]);
  assert.equal(h.buzzes(), 1);
  h.supplyTab.changeOrder("ammo", -1);
  assert.equal(h.supplyTab.order.size, 0);
  assert.equal(h.buzzes(), 1);
});

test("fixture sale confirmations identify the chosen fixture or crate", () => {
  const tablet = Object.create(ManagerTablet.prototype);
  tablet.fixturesTab = { purchaseNotice: "", saleConfirmation: null };
  const shelf = { id: "shelf_2", type: "shelf_budget_2x4" };
  const crate = { kind: "fixture", typeId: "shelf_budget_2x4" };
  tablet.scene = {
    fixtures: { displayName: () => "BUDGET SHELF 2x4" },
    fixtureSystem: { saleBlockReason: () => null, crateSaleBlockReason: () => null },
  };
  tablet.refreshLayoutPanels = () => {};
  tablet.prepareFixtureSale("placed", shelf);
  assert.equal(tablet.fixturesTab.saleConfirmation.name, "BUDGET SHELF 2x4");
  assert.equal(tablet.fixturesTab.saleConfirmation.value, 150);
  tablet.prepareFixtureSale("crate", crate);
  assert.equal(tablet.fixturesTab.saleConfirmation.name, "BUDGET SHELF 2x4 crate");
  assert.equal(tablet.fixturesTab.saleConfirmation.value, 150);
});

test("a removed fixture cannot be sold through an old confirmation", () => {
  const tablet = Object.create(ManagerTablet.prototype);
  tablet.fixturesTab = { purchaseNotice: "", saleConfirmation: null };
  const shelf = { id: "shelf_2", type: "shelf_budget_2x4" };
  const messages = [];
  tablet.scene = {
    fixtures: { displayName: () => "BUDGET SHELF 2x4", get: () => undefined },
    fixtureSystem: { saleBlockReason: () => null },
    messages: { show: (message) => messages.push(message) },
  };
  tablet.refreshLayoutPanels = () => {};
  tablet.prepareFixtureSale("placed", shelf);
  tablet.confirmFixtureSale();
  assert.equal(tablet.fixturesTab.saleConfirmation, null);
  assert.match(messages[0], /no longer available/);
});

test("refreshing fixture panels preserves list scroll positions", () => {
  const makePanel = (positions) => {
    let lists = Object.fromEntries(Object.entries(positions).map(([selector, top]) => [selector, { scrollTop: top }]));
    return {
      querySelector: (selector) => lists[selector] ?? null,
      set innerHTML(_html) {
        lists = Object.fromEntries(Object.keys(lists).map((selector) => [selector, { scrollTop: 0 }]));
      },
    };
  };
  const fixtures = makePanel({ ".fixtures-catalog-list": 137, ".fixtures-owned-list": 61 });
  const layout = makePanel({ ".layout-expansions-list": 23 });
  const tablet = Object.create(ManagerTablet.prototype);
  tablet.fixturesTab = new FixturesTab({});
  tablet.fixturesTab.panel = fixtures;
  tablet.fixturesTab.renderPanel = () => "";
  tablet.layoutTab = new LayoutTab({});
  tablet.layoutTab.panel = layout;
  tablet.layoutTab.renderPanel = () => "";
  tablet.bodyElement = {
    querySelector: (selector) => selector.includes('"fixtures"') ? fixtures : layout,
  };
  tablet.renderPanelContent = () => "";
  tablet.updateSaveStatus = () => {};
  tablet.refreshLayoutPanels();
  assert.equal(fixtures.querySelector(".fixtures-catalog-list").scrollTop, 137);
  assert.equal(fixtures.querySelector(".fixtures-owned-list").scrollTop, 61);
  assert.equal(layout.querySelector(".layout-expansions-list").scrollTop, 23);
});
