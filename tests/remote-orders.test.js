import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createRemoteOrder } from "../js/logic/RemoteOrders.js";
import { Crate } from "../js/logic/Crate.js";
import { transferItems } from "../js/logic/InventoryTransfer.js";

let server;
let cacheDirectory;
let DroneDeliverySystem;

before(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-remote-order-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  ({ DroneDeliverySystem } = await server.ssrLoadModule("/js/modules/droneDeliveries/DroneDeliverySystem.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

function createScene() {
  const scene = {
    crateBounds: { left: 0, top: 0, right: 500, bottom: 500 },
    crateGroup: {
      add(sprite) {
        sprite.body = {
          velocity: { x: 0, y: 0 },
          setSize() { return this; },
          setAllowGravity() { return this; },
          setAllowRotation() { return this; },
          setBounce() { return this; },
          setBoundsRectangle() { return this; },
          setCollideWorldBounds() { return this; },
          setOffset() { return this; },
          updateFromGameObject() {},
        };
      },
    },
    add: {
      image(x, y) {
        return {
          x, y, scaleX: 1, scaleY: 1, displayHeight: 28,
          setDisplaySize(width, height) {
            this.width = width;
            this.height = height;
            this.displayHeight = height;
            return this;
          },
          setDepth() { return this; },
          setOrigin() { return this; },
          setTint() { return this; },
          clearTint() { return this; },
        };
      },
    },
  };
  return scene;
}

function createDeliveryFixture({ day = 1, contents = [["wpn_rif_01", 2]] } = {}) {
  const order = {
    id: "remote-order-1",
    receivedDay: 1,
    expiresOnDay: 2,
    items: [{ itemId: "wpn_rif_01", quantity: 2 }],
    payout: 100,
    reputation: 1,
    crateId: "crate-order",
  };
  const crate = {
    id: order.crateId,
    kind: "remote-order",
    orderId: order.id,
    isCarried: false,
    sprite: { x: 120, y: 180 },
    contents: new Map(contents),
    getAvailableUnitsFor(itemId) { return this.contents.get(itemId) ?? 0; },
    isRemoteOrderComplete() { return this.getAvailableUnitsFor("wpn_rif_01") >= 2; },
  };
  const crates = [crate];
  const returned = [];
  const changes = [];
  const messages = [];
  const state = {
    activeOrder: order,
    changed() { changes.push("changed"); },
    updateActiveOrder(updates) { this.activeOrder = { ...this.activeOrder, ...updates }; },
    close() { this.activeOrder = null; changes.push("closed"); },
  };
  const shop = {
    gameState: {
      calendar: { day },
      goBacks: {
        add(itemId, quantity) { returned.push({ itemId, quantity }); return quantity; },
      },
      reputation: {
        gain(value) { changes.push(`gain:${value}`); },
        lose(value) { changes.push(`lose:${value}`); },
      },
      economy: { add(amount, entry) { changes.push(`paid:${amount}:${entry.category}`); } },
      crates: { changed() { changes.push("crates-changed"); } },
    },
    crateSystem: {
      getFloorCrates: () => crates.filter((entry) => !entry.isCarried),
      getCarriedCrates: () => crates.filter((entry) => entry.isCarried),
      removeRemoteOrderCrate(target) {
        const index = crates.indexOf(target);
        if (index >= 0) crates.splice(index, 1);
        changes.push(`removed:${target.id}`);
      },
      createRemoteOrderCrate(options) {
        const replacement = {
          id: "crate-replacement",
          kind: "remote-order",
          orderId: options.orderId,
          isCarried: false,
          contents: new Map(),
          sprite: { x: options.x, y: options.y },
          isRemoteOrderComplete: () => false,
        };
        crates.push(replacement);
        return replacement;
      },
    },
    player: { sprite: {} },
    messages: { show(message) { messages.push(message); } },
  };
  shop.crateSystem.restockCrates = [];
  shop.crateSystem.syncFloorStacks = () => {};
  shop.crateSystem.removeCarriedCrate = (target) => {
    target.isCarried = false;
    return true;
  };
  const system = Object.create(DroneDeliverySystem.prototype);
  Object.assign(system, {
    shop,
    orderState: state,
    pendingShipId: null,
    refreshWindow() {},
  });
  return { system, shop, order, crate, state, returned, changes, crates, messages };
}

test("remote orders contain multiple licensed products and pay 30% above market value", () => {
  const items = [
    { id: "one", license: "weapons" },
    { id: "two", license: "ammo" },
    { id: "three", license: "tools" },
    { id: "locked", license: "unowned" },
  ];
  const order = createRemoteOrder({
    items,
    day: 4,
    random: () => 0.5,
    ownsLicense: (license) => license !== "unowned",
    marketPrice: () => 10,
  });

  assert.equal(order.receivedDay, 4);
  assert.equal(order.expiresOnDay, 5);
  assert.equal(order.items.length, 3);
  assert.ok(order.items.every(({ itemId, quantity }) =>
    items.some((item) => item.id === itemId && item.license !== "unowned") &&
    quantity >= 3 && quantity <= 8));
  const marketTotal = order.items.reduce((sum, line) => sum + line.quantity * 10, 0);
  assert.equal(order.payout, marketTotal * 1.3);
  assert.equal(order.reputation, 3);
  assert.equal(createRemoteOrder({
    items: items.slice(0, 1),
    day: 1,
    random: () => 0.5,
    ownsLicense: () => true,
    marketPrice: () => 10,
  }), null);
});

test("reset returns packed stock and keeps the order open with a new empty crate", () => {
  const fixture = createDeliveryFixture();
  assert.equal(fixture.system.resetOrder(), true);
  assert.deepEqual(fixture.returned, [{ itemId: "wpn_rif_01", quantity: 2 }]);
  assert.equal(fixture.state.activeOrder.id, fixture.order.id);
  assert.equal(fixture.state.activeOrder.crateId, "crate-replacement");
  assert.equal(fixture.crates.length, 1);
});

test("cancelling and expiring return packed stock and lose the order's reputation", () => {
  const cancelled = createDeliveryFixture();
  assert.equal(cancelled.system.cancelOrder(), true);
  assert.equal(cancelled.state.activeOrder, null);
  assert.ok(cancelled.changes.includes("lose:1"));
  assert.deepEqual(cancelled.returned, [{ itemId: "wpn_rif_01", quantity: 2 }]);

  const expired = createDeliveryFixture({ day: 2 });
  assert.equal(expired.system.endDay(), true);
  assert.equal(expired.state.activeOrder, null);
  assert.ok(expired.changes.includes("lose:1"));
});

test("shipping pays and gains reputation only after the order crate is complete", () => {
  const fixture = createDeliveryFixture({ contents: [["wpn_rif_01", 1]] });
  assert.equal(fixture.system.shipOrder(fixture.order, fixture.crate), false);
  assert.deepEqual(fixture.changes, []);

  fixture.crate.contents.set("wpn_rif_01", 2);
  assert.equal(fixture.system.shipOrder(fixture.order, fixture.crate), true);
  assert.equal(fixture.state.activeOrder, null);
  assert.ok(fixture.changes.includes("paid:100:drone_deliveries"));
  assert.ok(fixture.changes.includes("gain:1"));
});

test("the drone pad refuses an overlapping crate and accepts a clear order crate", () => {
  const fixture = createDeliveryFixture();
  fixture.shop.carriedCrate = fixture.crate;
  fixture.crate.isCarried = true;
  fixture.crate.isDropPositionClear = () => false;
  assert.equal(fixture.system.putOrderCrateOnPad(fixture.crate), false);
  assert.equal(fixture.messages.at(-1),
    "Make room on the drone pad before setting down the remote order crate.");

  fixture.crate.isDropPositionClear = () => true;
  fixture.crate.drop = (x, y) => {
    fixture.crate.sprite = { x, y };
    fixture.crate.isCarried = false;
  };
  assert.equal(fixture.system.putOrderCrateOnPad(fixture.crate), true);
  assert.deepEqual(fixture.crate.sprite, { x: 160, y: 6560 });
  assert.deepEqual(fixture.shop.crateSystem.restockCrates, [fixture.crate]);
});

test("stock transfers into the order crate one item at a time and cannot be taken back out", () => {
  const scene = createScene();
  const stock = new Crate(scene, "wpn_rif_01", 4, 100, 100, { id: "crate-stock" });
  const order = new Crate(scene, null, 0, 120, 100, {
    id: "crate-order",
    kind: "remote-order",
    orderId: "remote-order-1",
    requiredItems: [
      { itemId: "wpn_rif_01", quantity: 2 },
      { itemId: "amo_01", quantity: 1 },
    ],
  });

  assert.equal(transferItems(stock, order, "wpn_rif_01", 1).moved, 1);
  assert.equal(stock.quantity, 3);
  assert.equal(order.getAvailableUnitsFor("wpn_rif_01"), 1);
  assert.equal(order.remove("wpn_rif_01", 1), 0);
  assert.equal(order.add("unrequested-item", 1), 0);
  assert.equal(order.isRemoteOrderComplete(), false);
  assert.equal(transferItems(stock, order, "wpn_rif_01", 1).moved, 1);
  const ammo = new Crate(scene, "amo_01", 1, 140, 100, { id: "crate-ammo" });
  assert.equal(transferItems(ammo, order, "amo_01", 1).moved, 1);
  assert.equal(order.isRemoteOrderComplete(), true);
});
