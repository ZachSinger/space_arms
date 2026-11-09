import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { GAME_EVENTS } from "../js/logic/EventBus.js";

let server;
let cacheDirectory;
let Customer;
let PATIENCE_MS;
let getPatienceLevel;
let PlayerState;

before(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-patience-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    plugins: [{
      name: "patience-test-stubs",
      enforce: "pre",
      resolveId(source) {
        if (source === "../scenes/boot.js") return "\0patience-test-database";
        if (source === "./CustomerSprites.js") return "\0patience-test-sprites";
      },
      load(id) {
        if (id === "\0patience-test-database") {
          return `export const database = { getItem: (id) => ({ id, slots: id === "big" ? 4 : 1 }) };`;
        }
        if (id === "\0patience-test-sprites") return "export const pickRandomCustomerCharacter = () => ({});";
      },
    }],
  });
  ({ Customer, PATIENCE_MS, getPatienceLevel } = await server.ssrLoadModule("/js/logic/Customer.js"));
  ({ PlayerState } = await server.ssrLoadModule("/js/logic/PlayerState.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

function queuedCustomer({ serving = () => false, storeTemporarilyClosed = false } = {}) {
  const bubble = { list: [{ setFillStyle() {} }, { setText() {} }], setPosition() {}, destroyed: false };
  bubble.destroy = () => { bubble.destroyed = true; };
  const customer = Object.create(Customer.prototype);
  const angry = [];
  const floating = [];
  const reactionGraphics = [];
  customer.sprite = { x: 100, y: 100 };
  customer.state = "QUEUEING";
  customer.cart = [{ itemId: "amo_01", price: 5 }, { itemId: "big", price: 50 }];
  customer.factionId = "mercenaries";
  customer.playerState = new PlayerState();
  customer.patienceBubble = bubble;
  customer.patienceLevel = -1;
  customer.reactionEventsShown = new Set();
  customer.reactionBubble = null;
  customer.reactionRemainingMs = 0;
  customer.scene = {
    storeTemporarilyClosed,
    isServingCustomer: serving,
    showFloatingText: (...args) => floating.push(args),
    add: {
      graphics: () => {
        const graphic = {
          setDepth() { return this; },
          setPosition() { return this; },
          setAlpha() { return this; },
          fillStyle() { return this; },
          fillCircle() { return this; },
          lineStyle() { return this; },
          strokeCircle() { return this; },
          beginPath() { return this; },
          moveTo() { return this; },
          lineTo() { return this; },
          strokePath() { return this; },
          destroy() {},
        };
        reactionGraphics.push(graphic);
        return graphic;
      },
    },
  };
  customer.followPath = () => {};
  customer.updateFacing = () => {};
  customer.onLeaveAngry = (who, cart) => angry.push({ who, cart });
  customer.enterLeaving = () => { customer.state = "LEAVING"; };
  customer.resetPatience();
  return { customer, angry, floating, bubble, reactionGraphics };
}

test("patience bubbles escalate from calm to urgent", () => {
  assert.equal(getPatienceLevel(1), 0);
  assert.equal(getPatienceLevel(0.5), 1);
  assert.equal(getPatienceLevel(0.1), 2);
  assert.equal(getPatienceLevel(0), 2);
});

test("queued customers drain patience, hold while served, and leave angry at zero", () => {
  let serving = true;
  const { customer, angry, floating, bubble } = queuedCustomer({ serving: () => serving });
  customer.update(PATIENCE_MS);
  assert.equal(customer.patienceRemainingMs, PATIENCE_MS);

  serving = false;
  customer.update(PATIENCE_MS - 1);
  assert.equal(customer.state, "QUEUEING");
  assert.equal(customer.patienceLevel, 2);
  customer.resetPatience(); // a sale at the register resets the next in line
  customer.update(PATIENCE_MS - 1);
  assert.equal(customer.state, "QUEUEING");
  customer.update(1);

  assert.equal(customer.state, "LEAVING");
  assert.equal(angry.length, 1);
  assert.deepEqual(angry[0].cart.map((entry) => entry.itemId), ["amo_01", "big"]);
  assert.deepEqual(customer.cart, []);
  assert.equal(customer.playerState.globalReputation, 0);
  assert.equal(customer.playerState.factionReputation.mercenaries, 0);
  assert.deepEqual(floating, []);
  assert.equal(bubble.destroyed, true);
});

test("queued customers do not lose patience while the store is temporarily closed", () => {
  const { customer, angry } = queuedCustomer({ storeTemporarilyClosed: true });
  customer.update(PATIENCE_MS);
  assert.equal(customer.state, "QUEUEING");
  assert.equal(customer.patienceRemainingMs, PATIENCE_MS);
  assert.equal(angry.length, 0);

  customer.scene.storeTemporarilyClosed = false;
  customer.update(PATIENCE_MS);
  assert.equal(customer.state, "LEAVING");
  assert.equal(angry.length, 1);
});

test("the Go-Backs bin only empties into the hovercart, within its capacity", () => {
  const transfers = [];
  const state = new PlayerState({
    emit: (event, payload) => transfers.push({ event, payload }),
  });
  state.hovercart.capacity = 10;
  state.addToGoBacks([{ itemId: "big" }, { itemId: "big" }, { itemId: "big" }, { itemId: "amo_01" }]);
  assert.equal(state.goBacks.findStockEntry("big").quantity, 3);
  assert.deepEqual(transfers.slice(0, 2), [
    {
      event: GAME_EVENTS.INVENTORY_TRANSFERRED,
      payload: {
        itemId: "big",
        quantity: 3,
        source: "customer-cart",
        destination: "go-backs",
      },
    },
    {
      event: GAME_EVENTS.INVENTORY_TRANSFERRED,
      payload: {
        itemId: "amo_01",
        quantity: 1,
        source: "customer-cart",
        destination: "go-backs",
      },
    },
  ]);

  assert.equal(state.loadGoBacksItem("big"), true);
  assert.deepEqual(transfers[2], {
    event: GAME_EVENTS.INVENTORY_TRANSFERRED,
    payload: { itemId: "big", quantity: 1, source: "go-backs", destination: "hovercart" },
  });
  assert.equal(state.loadGoBacksItem("big"), true);
  assert.equal(state.loadGoBacksItem("big"), false); // 8 of 10 slots used
  assert.equal(state.goBacks.findStockEntry("big").quantity, 1);
  assert.equal(state.loadGoBacksItem("amo_01"), true);
  assert.equal(state.goBacks.findStockEntry("amo_01"), null);
  assert.equal(state.loadGoBacksItem("amo_01"), false);
  assert.equal(state.hovercart.findStockEntry("big").quantity, 2);

  const restored = new PlayerState();
  restored.applySave(JSON.parse(JSON.stringify(state.serialize())));
  assert.deepEqual(restored.goBacks.stock, [{ itemId: "big", quantity: 1 }]);
  assert.equal(restored.goBacks.capacity, Infinity);

  const legacy = state.serialize();
  delete legacy.goBacks;
  restored.applySave(legacy);
  assert.deepEqual(restored.goBacks.stock, []);
});

test("hiring staff spends the fee once and keeps the hire when player state is restored", () => {
  const state = new PlayerState();
  state.addReputation(60);
  state.finishShift({ customersServed: 60, customersTurnedAway: 0 });
  state.endDay(2);
  assert.equal(state.hireEmployee("tavi_stock_clerk", 250), true);
  assert.equal(state.credits, 1250);
  assert.deepEqual(state.hiredEmployees, ["tavi_stock_clerk"]);
  assert.deepEqual(state.employeeJobPriorities.tavi_stock_clerk, [
    "register", "stock_shelves", "load_storage",
  ]);
  assert.equal(state.moveEmployeeJobPriority("tavi_stock_clerk", "stock_shelves", -1), true);
  assert.deepEqual(state.employeeJobPriorities.tavi_stock_clerk, [
    "stock_shelves", "register", "load_storage",
  ]);
  assert.equal(state.hireEmployee("tavi_stock_clerk", 250), false);
  assert.equal(state.credits, 1250);

  const restored = new PlayerState();
  const saved = state.serialize();
  restored.applySave(saved);
  assert.deepEqual(restored.hiredEmployees, ["tavi_stock_clerk"]);
  assert.deepEqual(restored.employeeJobPriorities.tavi_stock_clerk, [
    "stock_shelves", "register", "load_storage",
  ]);
  assert.equal(restored.credits, 1250);

  delete saved.employeeJobPriorities;
  restored.applySave(saved);
  assert.deepEqual(restored.employeeJobPriorities.tavi_stock_clerk, [
    "register", "stock_shelves", "load_storage",
  ]);
});

test("completing a sale returns proceeds without directly changing player state", () => {
  const { customer } = queuedCustomer();
  const storeBefore = customer.playerState.globalReputation;
  const factionBefore = customer.playerState.factionReputation.mercenaries;
  const creditsBefore = customer.playerState.credits;

  assert.equal(customer.completeSale(), 55);
  assert.equal(customer.playerState.globalReputation, storeBefore);
  assert.equal(customer.playerState.factionReputation.mercenaries, factionBefore);
  assert.equal(customer.playerState.credits, creditsBefore);
  assert.equal(customer.state, "LEAVING");
});

test("only purchases of three or more items get the happy reaction", () => {
  const { customer, reactionGraphics } = queuedCustomer();
  customer.cart.push({ itemId: "third", price: 10 });

  customer.completeSale();

  assert.equal(reactionGraphics.length, 1);
});
