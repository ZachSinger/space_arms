import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { GAME_EVENTS } from "../js/core/Events.js";

let server;
let cacheDirectory;
let Customer;
let PATIENCE_MS;
let getPatienceLevel;
let CheckoutSystem;
let GameState;
let nextTestCrateId = 1;

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
          return `export const database = { getItem: (id) => ({ id }) };`;
        }
        if (id === "\0patience-test-sprites") return "export const pickRandomCustomerCharacter = () => ({}); export const addCharacterSprite = () => ({}); export const showCharacterFacing = () => {}; export const CHARACTER_HEAD_HEIGHT = 42; export const CHARACTER_ART_WIDTH = 46;";
      },
    }],
  });
  ({ Customer, PATIENCE_MS, getPatienceLevel } = await server.ssrLoadModule("/js/logic/Customer.js"));
  ({ CheckoutSystem } = await server.ssrLoadModule("/js/systems/CheckoutSystem.js"));
  ({ GameState } = await server.ssrLoadModule("/js/state/GameState.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

const ITEMS = [{ id: "amo_01", baseCost: 5 }, { id: "big", baseCost: 50 }];
const newGame = () => new GameState({ items: ITEMS, random: () => 0.5 });

function queuedCustomer({ position = 1, maxPatienceMs = PATIENCE_MS, storeTemporarilyClosed = false } = {}) {
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
  customer.gameState = newGame();
  customer.maxPatienceMs = maxPatienceMs;
  customer.queuePosition = null;
  customer.patienceRemainingMs = null;
  customer.patienceBubble = bubble;
  customer.patienceLevel = -1;
  customer.reactionEventsShown = new Set();
  customer.reactionBubble = null;
  customer.reactionRemainingMs = 0;
  customer.scene = {
    customerFlow: { temporarilyClosed: storeTemporarilyClosed },
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
  customer.store = customer.scene;
  customer.followPath = () => {};
  customer.updateFacing = () => {};
  customer.onLeaveAngry = (who, cart) => {
    angry.push({ who, cart });
    for (const { itemId } of cart) who.remove(itemId, 1);
  };
  customer.enterLeaving = () => { customer.state = "LEAVING"; };
  if (position != null) customer.setQueuePosition(position);
  return { customer, angry, floating, bubble, reactionGraphics };
}

function queueHarness() {
  const registers = ["one", "two"].map((id) => ({
    id,
    queuePoints: Array.from({ length: 8 }, (_, index) => ({ x: index * 32, y: 0 })),
  }));
  const checkoutWindow = {
    cart: null,
    onComplete: null,
    isCheckingOut(cart) { return this.cart === cart; },
    openForCustomer(cart, onComplete) { this.cart = cart; this.onComplete = onComplete; },
    close() { this.cart = null; this.onComplete = null; },
  };
  const scene = {
    fixtures: {
      register: () => registers[0],
      registers: () => registers,
      get: (id) => registers.find((register) => register.id === id),
    },
    checkoutWindow,
    controlMode: { allows: () => true },
    gameState: { goBacks: { addCart() {} } },
    eventBus: { emit() {} },
    messages: { floatText() {} },
  };
  const checkout = new CheckoutSystem(scene);

  function addCustomer(register, maxPatienceMs = PATIENCE_MS) {
    const result = queuedCustomer({ position: null, maxPatienceMs });
    const { customer } = result;
    customer.registerPoint = register.queuePoints[0];
    customer.targetRegisterId = register.id;
    customer.setQueueTarget = (x, y) => { customer.queueTarget = { x, y }; };
    customer.onJoinQueue = (who) => checkout.handleJoinQueue(who);
    const onLeaveAngry = customer.onLeaveAngry;
    customer.onLeaveAngry = (who, cart) => {
      onLeaveAngry(who, cart);
      checkout.handleAngryLeave(who, cart);
    };
    customer.joinQueue();
    return customer;
  }

  return { registers, checkout, checkoutWindow, scene, addCustomer };
}

test("patience bubbles escalate from calm to urgent", () => {
  assert.equal(getPatienceLevel(1), 0);
  assert.equal(getPatienceLevel(0.5), 1);
  assert.equal(getPatienceLevel(0.1), 2);
  assert.equal(getPatienceLevel(0), 2);
});

test("customers behind the front of the line leave angry when their waiting time runs out", () => {
  const { customer, angry, floating, bubble } = queuedCustomer();
  const startingPatience = PATIENCE_MS + 10000;
  customer.update(startingPatience - 1);
  assert.equal(customer.state, "QUEUEING");
  assert.equal(customer.patienceLevel, 2);
  customer.update(1);

  assert.equal(customer.state, "LEAVING");
  assert.equal(angry.length, 1);
  assert.deepEqual(angry[0].cart.map((entry) => entry.itemId), ["amo_01", "big"]);
  assert.deepEqual(customer.cart, []);
  assert.equal(customer.gameState.reputation.global, 0);
  assert.equal(customer.gameState.reputation.factions.mercenaries, 0);
  assert.deepEqual(floating, []);
  assert.equal(bubble.destroyed, true);
});

test("the front customer never runs out of patience, even without a cashier", () => {
  const { customer, angry } = queuedCustomer({ position: 0 });
  customer.update(PATIENCE_MS * 10);
  assert.equal(customer.state, "QUEUEING");
  assert.equal(customer.patienceRemainingMs, PATIENCE_MS);
  assert.deepEqual(angry, []);
});

test("queued customers do not lose patience while the store is temporarily closed", () => {
  const { customer, angry } = queuedCustomer({ storeTemporarilyClosed: true });
  const startingPatience = PATIENCE_MS + 10000;
  customer.update(startingPatience);
  assert.equal(customer.state, "QUEUEING");
  assert.equal(customer.patienceRemainingMs, startingPatience);
  assert.equal(angry.length, 0);

  customer.scene.customerFlow.temporarilyClosed = false;
  customer.update(startingPatience);
  assert.equal(customer.state, "LEAVING");
  assert.equal(angry.length, 1);
});

test("joining and advancing in a line change patience without affecting other lines", () => {
  const { registers, checkout, checkoutWindow, addCustomer } = queueHarness();
  const [firstRegister, otherRegister] = registers;
  const first = addCustomer(firstRegister);
  const second = addCustomer(firstRegister);
  const third = addCustomer(firstRegister, 24000);
  const fourth = addCustomer(firstRegister);
  const otherFirst = addCustomer(otherRegister);
  const otherSecond = addCustomer(otherRegister);

  assert.deepEqual(
    [first, second, third, fourth, otherFirst, otherSecond].map((customer) => customer.patienceRemainingMs),
    [40000, 50000, 44000, 70000, 40000, 50000],
  );
  second.updatePatience(9000);
  third.updatePatience(12000);
  fourth.updatePatience(8000);
  const fifth = addCustomer(firstRegister);
  assert.deepEqual(
    [second, third, fourth, fifth].map((customer) => customer.patienceRemainingMs),
    [41000, 32000, 62000, 80000],
  );

  second.leaveAngry();
  assert.deepEqual(
    [third, fourth, fifth].map((customer) => customer.patienceRemainingMs),
    [37000, 67000, 85000],
  );
  assert.equal(otherSecond.patienceRemainingMs, 50000);

  checkout.operatingRegister = true;
  checkout.operatingRegisterFixture = firstRegister;
  checkout.startCheckout(first);
  checkoutWindow.onComplete();

  assert.deepEqual(
    [third, fourth, fifth].map((customer) => customer.patienceRemainingMs),
    [24000, 72000, 90000],
  );
  assert.deepEqual(
    [third, fourth, fifth].map((customer) => customer.queuePosition),
    [0, 1, 2],
  );
  checkout.layoutRegisterLine(firstRegister);
  assert.deepEqual(
    [third, fourth, fifth].map((customer) => customer.patienceRemainingMs),
    [24000, 72000, 90000],
  );
  assert.equal(otherSecond.patienceRemainingMs, 50000);

  third.updatePatience(100000);
  assert.equal(third.state, "QUEUEING");
  assert.equal(third.patienceRemainingMs, 24000);
});

test("a customer who leaves after the third wrong change costs no extra reputation", async () => {
  const { ReputationPenalties } = await server.ssrLoadModule("/js/systems/ReputationPenalties.js");
  const handlers = new Map();
  const floats = [];
  const penalties = new ReputationPenalties({ messages: { floatText: (...args) => floats.push(args) } });
  penalties.listen({ on: (event, handler) => handlers.set(event, handler) });
  const { customer } = queuedCustomer();
  const leftAngry = handlers.get(GAME_EVENTS.CUSTOMER_LEFT_ANGRY);

  leftAngry({ customer, cart: [], reputationPenalty: false });
  assert.equal(customer.gameState.reputation.pending.global, 0);
  assert.equal(floats.length, 0);

  leftAngry({ customer, cart: [] });
  assert.equal(customer.gameState.reputation.pending.global, -1);
});

test("a customer who leaves over an outrageous price only costs store reputation", async () => {
  const { ReputationPenalties } = await server.ssrLoadModule("/js/systems/ReputationPenalties.js");
  const handlers = new Map();
  const floats = [];
  const penalties = new ReputationPenalties({ messages: { floatText: (...args) => floats.push(args) } });
  penalties.listen({ on: (event, handler) => handlers.set(event, handler) });
  const { customer } = queuedCustomer();

  handlers.get(GAME_EVENTS.CUSTOMER_LEFT_ANGRY)({
    customer, cart: [], factionReputationPenalty: false,
  });

  assert.equal(customer.gameState.reputation.pending.global, -1);
  assert.equal(customer.gameState.reputation.pending.factions.mercenaries, 0);
  assert.match(floats[0][2], /-1 store reputation/);
  assert.doesNotMatch(floats[0][2], /Mercenaries reputation/);
});

test("employee checkout and a front customer leaving both advance the line", () => {
  const { registers, checkout, addCustomer } = queueHarness();
  const register = registers[0];
  const first = addCustomer(register);
  const second = addCustomer(register);
  const third = addCustomer(register);
  const employee = { sprite: { x: 0, y: 0 }, currentJob: { register, customer: first } };
  second.updatePatience(10000);
  third.updatePatience(10000);

  assert.equal(checkout.completeEmployeeCheckout(employee, first), true);
  assert.equal(second.patienceRemainingMs, 40000);
  assert.equal(third.patienceRemainingMs, 55000);
  second.leaveAngry();
  assert.equal(third.queuePosition, 0);
  assert.equal(third.patienceRemainingMs, 40000);
});

test("returned items collect in the Go-Backs bin and pack into crates up to their capacity", () => {
  const transfers = [];
  const state = new GameState({
    items: ITEMS, events: { emit: (event, payload) => transfers.push({ event, payload }) },
  });
  const customer = {
    id: "customer-cart-return",
    location: { kind: "customer-cart", customerId: "customer-cart-return" },
    cart: [
      { itemId: "big" }, { itemId: "big" }, { itemId: "big" }, { itemId: "amo_01" },
    ],
    getContainerId() { return this.id; },
    getLocation() { return this.location; },
    getAvailableUnitsFor(itemId) { return this.cart.filter((entry) => entry.itemId === itemId).length; },
    canTake(itemId) { return this.getAvailableUnitsFor(itemId) > 0; },
    remove(itemId, quantity) {
      let removed = 0;
      for (let index = this.cart.length - 1; index >= 0 && removed < quantity; index -= 1) {
        if (this.cart[index].itemId !== itemId) continue;
        this.cart.splice(index, 1);
        removed += 1;
      }
      return removed;
    },
    add(itemId, quantity) {
      for (let index = 0; index < quantity; index += 1) this.cart.push({ itemId });
      return quantity;
    },
  };
  state.goBacks.addCart(customer);
  assert.equal(state.goBacks.pool.findStockEntry("big").quantity, 3);
  assert.deepEqual(transfers.slice(0, 2), [
    {
      event: GAME_EVENTS.INVENTORY_TRANSFERRED,
      payload: {
        itemId: "big",
        quantity: 3,
        source: "customer-cart",
        destination: "go-backs",
        sourceId: customer.id,
        destinationId: "go-backs",
        sourceLocation: customer.location,
        destinationLocation: { kind: "go-backs", containerId: "go-backs" },
      },
    },
    {
      event: GAME_EVENTS.INVENTORY_TRANSFERRED,
      payload: {
        itemId: "amo_01",
        quantity: 1,
        source: "customer-cart",
        destination: "go-backs",
        sourceId: customer.id,
        destinationId: "go-backs",
        sourceLocation: customer.location,
        destinationLocation: { kind: "go-backs", containerId: "go-backs" },
      },
    },
  ]);
  assert.deepEqual(customer.cart, []);

  const crate = (limit) => ({
    id: `test-crate-${nextTestCrateId++}`,
    getContainerId() {
      return this.id;
    },
    getLocation() {
      return { kind: "test-crate", containerId: this.id };
    },
    itemId: null, quantity: 0,
    canTake() { return true; },
    canPut() { return true; },
    getAvailableUnitsFor(itemId) { return itemId === this.itemId ? this.quantity : 0; },
    remove(itemId, quantity) {
      const removed = Math.min(this.getAvailableUnitsFor(itemId), quantity);
      this.quantity -= removed;
      return removed;
    },
    getRemainingUnitsFor(itemId) {
      return this.quantity > 0 && this.itemId !== itemId ? 0 : limit - this.quantity;
    },
    add(itemId, quantity) { this.itemId = itemId; this.quantity += quantity; return quantity; },
  });
  const first = crate(2);
  assert.equal(state.goBacks.packInto("big", first), 2);
  assert.deepEqual(transfers[2], {
    event: GAME_EVENTS.INVENTORY_TRANSFERRED,
    payload: {
      itemId: "big",
      quantity: 2,
      source: "go-backs",
      destination: "crate",
      sourceId: "go-backs",
      destinationId: first.id,
      sourceLocation: { kind: "go-backs", containerId: "go-backs" },
      destinationLocation: { kind: "test-crate", containerId: first.id },
    },
  });
  assert.equal(state.goBacks.packInto("big", first), 0, "a full crate takes nothing");
  assert.equal(state.goBacks.packInto("amo_01", first), 0, "a crate holds one item type");
  assert.equal(state.goBacks.pool.findStockEntry("big").quantity, 1);
  const second = crate(2);
  assert.equal(state.goBacks.packInto("amo_01", second), 1);
  assert.equal(state.goBacks.pool.findStockEntry("amo_01"), null);
  assert.equal(state.goBacks.packInto("amo_01", crate(2)), 0);
  assert.deepEqual([first.itemId, first.quantity, second.itemId, second.quantity], ["big", 2, "amo_01", 1]);

  const saved = JSON.parse(JSON.stringify(state.toSave()));
  assert.equal(Object.hasOwn(saved.playerState, "hovercart"), false);
  const restored = GameState.fromSave(saved, { items: ITEMS });
  assert.deepEqual(restored.goBacks.stock, [{ itemId: "big", quantity: 1 }]);
  assert.equal(restored.goBacks.pool.capacity, Infinity);

  delete saved.playerState.goBacks;
  assert.deepEqual(GameState.fromSave(saved, { items: ITEMS }).goBacks.stock, []);
});

test("hiring staff spends the fee once and keeps the hire when player state is restored", () => {
  const state = newGame();
  state.reputation.gain(90);
  state.finishShift({ customersServed: 90, customersTurnedAway: 0 });
  state.endDay();
  assert.equal(state.hireEmployee("tavi_stock_clerk"), true);
  assert.equal(state.economy.credits, 1250);
  assert.deepEqual(state.staff.hired, ["tavi_stock_clerk"]);
  assert.deepEqual(state.staff.jobPriorities.tavi_stock_clerk, [
    "register", "stock_shelves", "clean",
  ]);
  assert.equal(state.staff.prioritizeJob("tavi_stock_clerk", "clean"), true);
  assert.deepEqual(state.staff.jobPriorities.tavi_stock_clerk, [
    "clean", "register", "stock_shelves",
  ]);
  assert.equal(state.staff.prioritizeJob("tavi_stock_clerk", "clean"), false, "already first");
  assert.equal(state.hireEmployee("tavi_stock_clerk"), false);
  assert.equal(state.economy.credits, 1250);

  const saved = JSON.parse(JSON.stringify(state.toSave()));
  let restored = GameState.fromSave(saved, { items: ITEMS });
  assert.deepEqual(restored.staff.hired, ["tavi_stock_clerk"]);
  assert.deepEqual(restored.staff.jobPriorities.tavi_stock_clerk, [
    "clean", "register", "stock_shelves",
  ]);
  assert.equal(restored.economy.credits, 1250);

  delete saved.playerState.employeeJobPriorities;
  restored = GameState.fromSave(saved, { items: ITEMS });
  assert.deepEqual(restored.staff.jobPriorities.tavi_stock_clerk, [
    "register", "stock_shelves", "clean",
  ]);
});

test("completing a sale returns proceeds without directly changing player state", () => {
  const { customer } = queuedCustomer();
  const storeBefore = customer.gameState.reputation.global;
  const factionBefore = customer.gameState.reputation.factions.mercenaries;
  const creditsBefore = customer.gameState.economy.credits;

  assert.equal(customer.completeSale(), 55);
  assert.equal(customer.gameState.reputation.global, storeBefore);
  assert.equal(customer.gameState.reputation.factions.mercenaries, factionBefore);
  assert.equal(customer.gameState.economy.credits, creditsBefore);
  assert.equal(customer.state, "LEAVING");
});

test("purchasing three or more items does not trigger a happy reaction", () => {
  const { customer, reactionGraphics } = queuedCustomer();
  customer.cart.push({ itemId: "third", price: 10 });

  customer.completeSale();

  assert.equal(reactionGraphics.length, 0);
});
