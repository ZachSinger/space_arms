import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { summarizeSupplyOrder, DELIVERY_FEE } from "../js/logic/SupplyOrder.js";
import { GAME_EVENTS } from "../js/logic/EventBus.js";
import { isMoney } from "../js/logic/Money.js";
import { SupplierLicense } from "../js/logic/Licenses.js";

let server;
let ManagerTablet;
let cacheDirectory;
const originalDocument = globalThis.document;

before(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-pricing-test-"));
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
});

after(async () => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  delete globalThis.__inventoryTestWindow;
  delete globalThis.__supplyErrorBuzzes;
  delete globalThis.__inventoryTestLicenses;
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
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
  const document = { activeElement: null };
  globalThis.document = document;

  const focus = (next) => {
    const previous = document.activeElement;
    if (previous === next) return;
    if (previous) body.emit("focusout", { target: previous, relatedTarget: next });
    document.activeElement = next;
    if (next) body.emit("focusin", { target: next, relatedTarget: previous });
  };
  const control = (kind, itemId, action, value) => ({
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
    closest(selector) { return this.matches(selector) ? this : null; },
    focus() { focus(this); },
    blur() { if (document.activeElement === this) focus(null); },
  });
  const panel = {
    controls: [],
    renderCount: 0,
    contains(element) { return this.controls.includes(element); },
    querySelector(selector) {
      if (selector === ".inventory-list") return list;
      return null;
    },
    querySelectorAll() { return this.controls.filter((item) => item.kind === "button"); },
    set innerHTML(markup) {
      if (this.contains(document.activeElement)) focus(null);
      this.renderCount += 1;
      this.markup = markup;
      this.controls = [];
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
  };
  body.querySelector = (selector) => {
    if (selector === ".tablet-tab-bar") return tabBar;
    if (selector === '[data-tab-panel="inventory"]') return panel;
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
  const playerState = {
    listeners: [],
    hiredEmployees: [],
    credits: 1500,
    subscribe(listener) { this.listeners.push(listener); listener(); },
    notifyListeners() { for (const listener of this.listeners) listener(); },
  };
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
    playerState,
    eventBus,
    input: { keyboard },
    employees: [],
    customerCartCount: 0,
    canHireEmployees: () => true,
    market: { getPrice: (itemId) => marketPrices.get(itemId) },
    storage: 1,
    getStorePrice: (itemId) => prices.get(itemId),
    setStorePrice(itemId, price) {
      if (!isMoney(price) || price < 1) return false;
      prices.set(itemId, price);
      playerState.notifyListeners();
      return true;
    },
    getInventoryItems() {
      return ["rifle", "pistol"].map((itemId) => ({
        item: { id: itemId, name: itemId },
        storage: this.storage,
        stock: 0,
        inCustomerCarts: this.customerCartCount,
        marketPrice: marketPrices.get(itemId),
        storePrice: prices.get(itemId),
      }));
    },
    getRestockableItems: () => [],
    getSupplyOrderSummary: () => ({ crates: 0, maxCrates: 9, stockCost: 0, deliveryFee: 0, total: 0, problem: null, canPlace: false }),
    getLoadingPadSpawnPositions: () => [],
    canRearrangeFixtures: () => false,
    getFixturePurchaseOptions: () => [],
    getExpansionPurchaseOptions: () => [],
    getBackroomPurchaseOptions: () => [],
    getFinancesView: () => ({
      day: 1,
      shiftRunning: false,
      awaitingEndDay: false,
      canEndDay: false,
      today: {
        day: 1, openingCredits: 1500, closingCredits: 1500, reputationChange: 0,
        earned: [], spent: [], totalEarned: 0, totalSpent: 0, shift: null,
      },
      lastDay: null,
    }),
    fixtures: { all: () => [], displayName: () => "" },
  };
  const tablet = new ManagerTablet({}, playerState, scene);
  const click = (itemId, action) => {
    const button = panel.button(itemId, action);
    focus(button);
    body.emit("click", { target: button });
  };
  return { body, click, document, focus, keyboard, list, marketPrices, panel, scene, tablet };
}

test("price buttons update the displayed value and retain keyboard focus", () => {
  const h = createHarness();
  h.click("rifle", "increase");
  assert.equal(h.panel.input("rifle").value, "110");
  assert.equal(h.scene.getStorePrice("rifle"), 110);
  assert.equal(h.document.activeElement, h.panel.button("rifle", "increase"));
  assert.equal(h.keyboard.enabled, false);

  const focusedButton = h.document.activeElement;
  h.body.emit("keydown", { target: focusedButton, key: "Enter" });
  assert.equal(h.document.activeElement, focusedButton);
  h.body.emit("click", { target: focusedButton });
  assert.equal(h.panel.input("rifle").value, "121");

  h.click("rifle", "decrease");
  assert.equal(h.panel.input("rifle").value, "108.9");
  h.marketPrices.set("rifle", 300);
  h.click("rifle", "market");
  assert.equal(h.panel.input("rifle").value, "300");
  assert.equal(h.panel.input("pistol").value, "200");
  assert.equal(h.list.scrollTop, 37);
  h.focus(null);
  assert.equal(h.keyboard.enabled, true);
});

test("contract signing enforces each shop level without spending credits early", async () => {
  const data = JSON.parse(await readFile(new URL("../data/Licenses.json", import.meta.url), "utf8"));
  globalThis.__inventoryTestLicenses = new Map(
    data.map((license) => [license.id, new SupplierLicense(license)]),
  );
  const warnings = [];
  const entries = [];
  const state = {
    shopLevel: 1,
    globalReputation: 1000,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 1500,
    activeLicenses: new Set(),
    spendCredits(amount, entry) { this.credits -= amount; entries.push(entry); },
    signLicense(id) { this.activeLicenses.add(id); },
  };
  const tablet = Object.create(ManagerTablet.prototype);
  tablet.playerState = state;
  tablet.scene = {
    showShopMessage: (message) => warnings.push(message),
    recalculateActiveFactions() {},
  };
  tablet.handleSignContract("lic_start_apparel");
  assert.equal(state.credits, 1500);
  assert.equal(state.activeLicenses.has("lic_start_apparel"), false);
  assert.match(warnings[0], /locked.*requirements/i);

  state.shopLevel = 2;
  state.globalReputation = -5;
  tablet.handleSignContract("lic_start_apparel");
  assert.equal(state.credits, 1400);
  assert.equal(state.activeLicenses.has("lic_start_apparel"), true);
  tablet.handleSignContract("lic_fixture_storage_bank");
  assert.equal(state.credits, 1400);
  assert.equal(state.activeLicenses.has("lic_fixture_storage_bank"), false);

  state.shopLevel = 14;
  tablet.handleSignContract("lic_fixture_storage_bank");
  assert.equal(state.credits, 400);
  assert.equal(state.activeLicenses.has("lic_fixture_storage_bank"), true);
  assert.deepEqual(entries.map((entry) => entry.category), ["licenses", "licenses"]);
});

test("opening the tablet hides checkout and closing it resumes register work", () => {
  const { scene, tablet } = createHarness();
  const calls = [];
  scene.checkoutWindow = { suspend: () => calls.push("suspend") };
  scene.resumeRegisterCheckout = () => calls.push("resume");
  tablet.uiWindow.openWindow = () => calls.push("tablet-open");
  tablet.openWindow();
  assert.deepEqual(calls, ["tablet-open", "suspend"]);
  tablet.fixturePurchaseNotice = "Bought a fixture.";
  tablet.fixtureSaleConfirmation = { name: "LOCKER" };
  tablet.uiWindow.onClose();
  assert.deepEqual(calls, ["tablet-open", "suspend", "resume"]);
  assert.equal(tablet.fixturePurchaseNotice, "");
  assert.equal(tablet.fixtureSaleConfirmation, null);
});

test("reopening the tablet refreshes cleared employee confirmations", () => {
  const { scene, tablet } = createHarness();
  scene.checkoutWindow = { suspend() {} };
  scene.resumeRegisterCheckout = () => {};
  tablet.uiWindow.openWindow = () => {};
  tablet.employeeTrainingConfirmation = { employeeId: "tavi_stock_clerk", jobId: "register" };
  tablet.uiWindow.onClose();
  const refreshed = [];
  tablet.refreshEmployeePanel = () => refreshed.push({
    training: tablet.employeeTrainingConfirmation,
  });
  tablet.openWindow();
  assert.deepEqual(refreshed, [{ training: null }]);
});

test("inventory refreshes when customers shop and finish checkout", () => {
  const h = createHarness();
  h.scene.customerCartCount = 2;
  h.scene.eventBus.emit(GAME_EVENTS.INVENTORY_TRANSFERRED, {
    destination: "customer-cart",
  });
  assert.match(h.panel.markup, /data-inventory-carts>2</);
  assert.match(h.panel.markup, /IN CARTS/);

  h.scene.customerCartCount = 0;
  h.scene.eventBus.emit(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, {});
  assert.match(h.panel.markup, /data-inventory-carts>0</);
});

test("a typed price commits before a subsequent button click", async () => {
  const h = createHarness();
  const input = h.panel.input("rifle");
  h.focus(input);
  input.value = "200";
  h.body.emit("change", { target: input });
  assert.equal(h.tablet.inventoryRefreshPending, true);

  const renders = h.panel.renderCount;
  const button = h.panel.button("rifle", "increase");
  h.focus(button);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.panel.renderCount, renders);
  assert.equal(h.panel.contains(button), true);

  h.body.emit("click", { target: button });
  assert.equal(h.panel.input("rifle").value, "220");
  assert.equal(h.scene.getStorePrice("rifle"), 220);
  assert.equal(h.tablet.inventoryRefreshPending, false);
  h.focus(null);
});

test("percentage buttons change low prices by at least one credit", () => {
  const h = createHarness();
  h.scene.setStorePrice("rifle", 1);
  h.click("rifle", "increase");
  assert.equal(h.panel.input("rifle").value, "2");
  h.click("rifle", "decrease");
  assert.equal(h.panel.input("rifle").value, "1");
  h.click("rifle", "decrease");
  assert.equal(h.panel.input("rifle").value, "1");
  h.scene.setStorePrice("rifle", 5);
  h.click("rifle", "decrease");
  assert.equal(h.panel.input("rifle").value, "4");
  h.focus(null);
});

test("pending changes refresh when leaving price controls", async () => {
  const h = createHarness();
  h.focus(h.panel.input("rifle"));
  h.scene.storage = 5;
  h.scene.playerState.notifyListeners();
  assert.equal(h.tablet.inventoryRefreshPending, true);
  h.focus(h.panel.button("rifle", "market"));
  h.focus(null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.tablet.inventoryRefreshPending, false);
  assert.match(h.panel.markup, /data-inventory-storage>5<\/span>/);
  assert.equal(h.keyboard.enabled, true);
});

function createSupplyHarness(credits) {
  const tablet = Object.create(ManagerTablet.prototype);
  const warnings = [];
  let refreshes = 0;
  globalThis.__supplyErrorBuzzes = 0;
  tablet.playerState = { credits };
  tablet.supplyOrder = new Map();
  tablet.scene = {
    getSupplyOrderSummary: (order) => summarizeSupplyOrder(order, {
      getCrateCost: (id) => ({ ammo: 40, rations: 10 })[id],
      credits: tablet.playerState.credits,
      freePadSpots: 9,
    }),
    showShopMessage: (message) => warnings.push(message),
  };
  tablet.refreshSupplyPanel = () => { refreshes += 1; };
  return { tablet, warnings, refreshes: () => refreshes, buzzes: () => globalThis.__supplyErrorBuzzes };
}

test("an unaffordable first crate is rejected with a warning and sound, including the delivery fee", () => {
  const h = createSupplyHarness(40 + DELIVERY_FEE - 1);
  h.tablet.changeSupplyOrder("ammo", 1);
  assert.deepEqual([...h.tablet.supplyOrder], []);
  assert.match(h.warnings[0], /Not enough credits/);
  assert.match(h.warnings[0], /65 credits/);
  assert.equal(h.buzzes(), 1);
  assert.equal(h.refreshes(), 0);
});

test("cart additions consider every crate already selected and allow the exact available budget", () => {
  const h = createSupplyHarness(40 + 10 + DELIVERY_FEE);
  h.tablet.changeSupplyOrder("ammo", 1);
  h.tablet.changeSupplyOrder("rations", 1);
  assert.deepEqual([...h.tablet.supplyOrder], [["ammo", 1], ["rations", 1]]);
  assert.equal(h.warnings.length, 0);
  assert.equal(h.buzzes(), 0);
  assert.equal(h.refreshes(), 2);
  h.tablet.changeSupplyOrder("rations", 1);
  assert.deepEqual([...h.tablet.supplyOrder], [["ammo", 1], ["rations", 1]]);
  assert.match(h.warnings[0], /85 credits/);
  assert.equal(h.buzzes(), 1);
});

test("adding another crate of the same item cannot exceed the budget", () => {
  const h = createSupplyHarness(40 + DELIVERY_FEE);
  h.tablet.changeSupplyOrder("ammo", 1);
  h.tablet.changeSupplyOrder("ammo", 1);
  assert.equal(h.tablet.supplyOrder.get("ammo"), 1);
  assert.equal(h.buzzes(), 1);
});

test("lower funds reject additions but never prevent removing crates from the order", () => {
  const h = createSupplyHarness(1000);
  h.tablet.changeSupplyOrder("ammo", 1);
  h.tablet.playerState.credits = 0;
  h.tablet.changeSupplyOrder("rations", 1);
  assert.deepEqual([...h.tablet.supplyOrder], [["ammo", 1]]);
  assert.equal(h.buzzes(), 1);
  h.tablet.changeSupplyOrder("ammo", -1);
  assert.equal(h.tablet.supplyOrder.size, 0);
  assert.equal(h.buzzes(), 1);
});

test("fixture sale confirmations identify the chosen fixture or crate", () => {
  const tablet = Object.create(ManagerTablet.prototype);
  const locker = { id: "locker_2", type: "locker_single" };
  const crate = { kind: "fixture", typeId: "shelf_budget_2x4" };
  tablet.scene = {
    fixtures: { displayName: () => "LOCKER 2" },
    getFixtureSaleBlockReason: () => null,
    getFixtureCrateSaleBlockReason: () => null,
  };
  tablet.refreshLayoutPanels = () => {};
  tablet.prepareFixtureSale("placed", locker);
  assert.equal(tablet.fixtureSaleConfirmation.name, "LOCKER 2");
  assert.equal(tablet.fixtureSaleConfirmation.value, 90);
  tablet.prepareFixtureSale("crate", crate);
  assert.equal(tablet.fixtureSaleConfirmation.name, "BUDGET SHELF 2x4 crate");
  assert.equal(tablet.fixtureSaleConfirmation.value, 150);
});

test("a removed fixture cannot be sold through an old confirmation", () => {
  const tablet = Object.create(ManagerTablet.prototype);
  const locker = { id: "locker_2", type: "locker_single" };
  const messages = [];
  tablet.scene = {
    fixtures: { displayName: () => "LOCKER 2", get: () => undefined },
    getFixtureSaleBlockReason: () => null,
    showShopMessage: (message) => messages.push(message),
  };
  tablet.refreshLayoutPanels = () => {};
  tablet.prepareFixtureSale("placed", locker);
  tablet.confirmFixtureSale();
  assert.equal(tablet.fixtureSaleConfirmation, null);
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
  const fixtures = makePanel({ ".fixture-management-scroll": 137 });
  const layout = makePanel({ ".layout-fixture-list": 23 });
  const tablet = Object.create(ManagerTablet.prototype);
  tablet.bodyElement = {
    querySelector: (selector) => selector.includes('"fixtures"') ? fixtures : layout,
  };
  tablet.renderPanelContent = () => "";
  tablet.updateSaveStatus = () => {};
  tablet.refreshLayoutPanels();
  assert.equal(fixtures.querySelector(".fixture-management-scroll").scrollTop, 137);
  assert.equal(layout.querySelector(".layout-fixture-list").scrollTop, 23);
});
