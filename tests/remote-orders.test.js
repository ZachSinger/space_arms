import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { acceptRemoteOffer, createRemoteOrder, remoteOrderScaling } from "../js/logic/RemoteOrders.js";
import { Crate } from "../js/logic/Crate.js";
import { DroneDeliveries } from "../js/state/slices/DroneDeliveries.js";
import { transferItems } from "../js/logic/InventoryTransfer.js";
import { REMOTE_ORDER_CRATE_SPRITES } from "../js/modules/droneDeliveries/DroneTerminalArt.js";
import { InteractableRegistry } from "../js/interaction/InteractableRegistry.js";

let server;
let cacheDirectory;
let DroneDeliverySystem;
let formatRemoteDeadline;
let InteractionSystem;

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
  ({ DroneDeliverySystem, formatRemoteDeadline } =
    await server.ssrLoadModule("/js/modules/droneDeliveries/DroneDeliverySystem.js"));
  ({ InteractionSystem } = await server.ssrLoadModule("/js/interaction/InteractionSystem.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

test("remote order deadlines use relative wording and say today on the final day", () => {
  assert.equal(formatRemoteDeadline(3, 1, "Expires"), "Expires in 3 days");
  assert.equal(formatRemoteDeadline(7, 5, "Due"), "Due in 3 days");
  assert.equal(formatRemoteDeadline(5, 5, "Due"), "Due today");
});

function createScene() {
  const image = (x, y, textureKey) => ({
    x, y, textureKey, scaleX: 1, scaleY: 1, displayHeight: 28,
    setDisplaySize(width, height) {
      this.width = width;
      this.height = height;
      this.displayHeight = height;
      return this;
    },
    setTexture(key, frame) { this.textureKey = key; this.frame = frame; return this; },
    setFrame(frame) { this.frame = frame; return this; },
    setDepth() { return this; },
    setOrigin() { return this; },
    setTint() { return this; },
    clearTint() { return this; },
  });
  const scene = {
    crateBounds: { left: 0, top: 0, right: 500, bottom: 500 },
    crateGroup: {
      add(sprite) {
        sprite.body = {
          velocity: { x: 0, y: 0 },
          enable: true,
          setSize(width, height) { this.width = width; this.height = height; return this; },
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
      image,
      sprite: image,
    },
  };
  return scene;
}

function createDeliveryFixture({ day = 1, contents = [["wpn_rif_01", 2]], offers = [], activeOrder } = {}) {
  const order = {
    id: "remote-order-1",
    receivedDay: 1,
    expiresOnDay: 2,
    items: [{ itemId: "wpn_rif_01", quantity: 2 }],
    payout: 100,
    reputation: 1,
    crateId: "crate-order",
  };
  const makeCrate = (id, orderId, x, y, contents = []) => ({
    id,
    kind: "remote-order",
    orderId,
    isCarried: false,
    inTerminal: false,
    remoteOrderLidOpen: false,
    lidCalls: [],
    sprite: {
      x, y, active: true, visible: true,
      body: { enable: true, stop() {} },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setVisible(visible) { this.visible = visible; return this; },
    },
    contents: new Map(contents),
    getAvailableUnitsFor(itemId) { return this.contents.get(itemId) ?? 0; },
    isRemoteOrderComplete() { return this.getAvailableUnitsFor("wpn_rif_01") >= 2; },
    isStationary: () => true,
    getFloorBounds() {
      return { left: this.sprite.x - 10, right: this.sprite.x + 10, top: this.sprite.y - 5, bottom: this.sprite.y + 5 };
    },
    setTerminalStored(stored) { this.inTerminal = stored; this.sprite.setVisible(!stored); },
    animateRemoteOrderLid(open = true) { this.remoteOrderLidOpen = open; this.lidCalls.push(open); },
  });
  const crate = makeCrate(order.crateId, order.id, 120, 180, contents);
  const crates = activeOrder === null ? [] : [crate];
  const returned = [];
  const changes = [];
  const messages = [];
  const state = new DroneDeliveries();
  state.activeOrder = activeOrder === undefined ? order : activeOrder;
  state.offers = offers;
  state.changed = () => changes.push("changed");
  let nextReplacement = 0;
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
        target.sprite.active = false;
        changes.push(`removed:${target.id}`);
      },
      createRemoteOrderCrate(options) {
        nextReplacement += 1;
        const replacement = makeCrate(nextReplacement === 1 ? "crate-replacement" : `crate-replacement-${nextReplacement}`,
          options.orderId, options.x, options.y);
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
    terminalRaised: true,
    terminalOpen: true,
    terminalAnimation: null,
    terminal: { setFrame(frame) { this.frame = frame; } },
    terminalPad: { setFrame(frame) { this.frame = frame; } },
    refreshWindow() {},
  });
  return { system, shop, order, crate, state, returned, changes, crates, messages };
}

test("remote order offers roll once per shift hour, without any customers, only while an offer slot is free", () => {
  const system = Object.create(DroneDeliverySystem.prototype);
  let received = 0;
  const clock = { started: true, elapsedHours: 0 };
  const reputation = { shopLevel: 1 };
  Object.assign(system, {
    shop: { shiftClock: clock, gameState: { reputation } },
    orderState: { activeOrder: { id: "accepted" }, offers: [] },
    hoursRolled: 0,
    receiveOrder() { received += 1; },
  });
  clock.elapsedHours = 0.99;
  system.updateOrderArrivals();
  assert.equal(system.hoursRolled, 0);
  clock.elapsedHours = 200;
  system.updateOrderArrivals();
  assert.equal(system.hoursRolled, 200);
  assert.ok(received > 0 && received < 60);
  received = 0;
  system.orderState.offers = [{ id: "waiting" }];
  clock.elapsedHours = 400;
  system.updateOrderArrivals();
  assert.equal(received, 0);
  reputation.shopLevel = 11;
  clock.elapsedHours = 600;
  system.updateOrderArrivals();
  assert.ok(received > 0);
});

test("with a co-op friend in the shop, offers come about twice as often and one more can wait", () => {
  const system = Object.create(DroneDeliverySystem.prototype);
  const clock = { started: true, elapsedHours: 0 };
  const shop = { shiftClock: clock, gameState: { reputation: { shopLevel: 1 } }, coop: null };
  let received = 0;
  Object.assign(system, {
    shop,
    orderState: { offers: [] },
    hoursRolled: 0,
    receiveOrder() { received += 1; },
  });
  const rollHours = (hours) => {
    received = 0;
    system.hoursRolled = 0;
    clock.elapsedHours = hours;
    system.updateOrderArrivals();
    return received;
  };
  const alone = rollHours(4000);
  shop.coop = { partner: {} };
  const together = rollHours(4000);
  assert.ok(together > alone * 1.7 && together < alone * 2.3, `${alone} alone vs ${together} together`);
  system.orderState.offers = [{ id: "waiting" }];
  assert.ok(rollHours(100) > 0, "a second offer can wait with a friend in the shop");
  shop.coop = null;
  assert.equal(rollHours(100), 0);
});

test("more offers can wait and orders hold more product types every 10 store levels", () => {
  assert.deepEqual(remoteOrderScaling(1), { maxOffers: 1, maxProductTypes: 3 });
  assert.deepEqual(remoteOrderScaling(10), { maxOffers: 1, maxProductTypes: 3 });
  assert.deepEqual(remoteOrderScaling(11), { maxOffers: 2, maxProductTypes: 4 });
  assert.deepEqual(remoteOrderScaling(50), { maxOffers: 5, maxProductTypes: 6 });
});

test("remote orders use any contract the store level allows, owned or not, and pay 30% above market value", () => {
  const contractLevels = { weapons: 1, ammo: 1, tools: 2, future: 5 };
  const items = [
    { id: "one", license: "weapons" },
    { id: "two", license: "ammo" },
    { id: "three", license: "tools" },
    { id: "later", license: "future" },
  ];
  const order = createRemoteOrder({
    items,
    day: 4,
    shopLevel: 2,
    random: () => 0.5,
    licenseLevel: (license) => contractLevels[license],
    marketPrice: () => 10,
  });

  assert.equal(order.receivedDay, 4);
  assert.equal(order.offerEndsDay, 5);
  assert.equal(order.items.length, 3);
  assert.ok(order.items.every(({ itemId, quantity }) =>
    itemId !== "later" && quantity >= 3 && quantity <= 8));
  const marketTotal = order.items.reduce((sum, line) => sum + line.quantity * 10, 0);
  assert.equal(order.payout, marketTotal * 1.3);
  assert.equal(order.reputation, 3);
  assert.equal(createRemoteOrder({
    items: items.slice(2),
    day: 1,
    shopLevel: 2,
    random: () => 0.5,
    licenseLevel: (license) => contractLevels[license],
    marketPrice: () => 10,
  }), null);

  const accepted = acceptRemoteOffer({ id: "remote-order-1", ...order }, 5);
  assert.equal(accepted.acceptedDay, 5);
  assert.equal(accepted.expiresOnDay, 7);
  assert.equal("offerEndsDay" in accepted, false);
});

test("remote orders never ask for items deleted in the dev tools", () => {
  const items = ["a", "b", "c", "d"].map((id) => ({ id, license: "weapons", hidden: id === "b" }));
  for (const roll of [0, 0.3, 0.6, 0.99]) {
    const order = createRemoteOrder({
      items, day: 1, shopLevel: 1, random: () => roll, licenseLevel: () => 1, marketPrice: () => 10,
    });
    assert.ok(order.items.every(({ itemId }) => itemId !== "b"));
  }
});

test("accepting an offer creates its crate; offers that run out or are declined cost no reputation", () => {
  const offer = (id, offerEndsDay) => ({
    id, receivedDay: 1, offerEndsDay, items: [{ itemId: "wpn_rif_01", quantity: 3 }], payout: 50, reputation: 2,
  });
  const fixture = createDeliveryFixture({
    day: 2,
    activeOrder: null,
    offers: [offer("remote-order-2", 2), offer("remote-order-3", 2), offer("remote-order-4", 3), offer("remote-order-5", 2)],
  });
  assert.equal(fixture.system.acceptOffer("remote-order-2"), true);
  assert.equal(fixture.state.activeOrder.crateId, "crate-replacement");
  assert.equal(fixture.state.activeOrder.expiresOnDay, 4);
  assert.equal(fixture.system.acceptOffer("remote-order-3"), true);
  assert.equal(fixture.state.orders.length, 2);
  assert.ok(fixture.crates.every((crate) => crate.inTerminal));

  assert.equal(fixture.system.declineOffer("remote-order-4"), true);
  assert.equal(fixture.system.endDay(), true);
  assert.deepEqual(fixture.state.offers, []);
  assert.ok(fixture.state.activeOrder);
  assert.ok(!fixture.changes.some((change) => change.startsWith("lose:")));
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
  assert.deepEqual(fixture.crate.sprite, { x: 291, y: 6471 });
  assert.deepEqual(fixture.shop.crateSystem.restockCrates, [fixture.crate]);
});

test("remote order crate switches from red to green and back when its contents reset", () => {
  const crate = new Crate(createScene(), null, 0, 100, 100, {
    kind: "remote-order",
    orderId: "remote-order-1",
    requiredItems: [{ itemId: "wpn_rif_01", quantity: 1 }],
  });

  assert.equal(crate.sprite.textureKey, REMOTE_ORDER_CRATE_SPRITES.incomplete.key);
  crate.animateRemoteOrderLid();
  assert.equal(crate.sprite.frame, 3);
  assert.equal(crate.add("wpn_rif_01", 1), 1);
  assert.equal(crate.sprite.textureKey, REMOTE_ORDER_CRATE_SPRITES.complete.key);
  assert.equal(crate.sprite.frame, 3, "packing the last item must not close the lid");
  crate.resetRemoteOrderContents();
  assert.equal(crate.sprite.textureKey, REMOTE_ORDER_CRATE_SPRITES.incomplete.key);
  assert.equal(crate.sprite.frame, 3, "resetting the contents keeps the crate open");
  crate.animateRemoteOrderLid(false);
  assert.equal(crate.sprite.frame, 0);
});

test("accepted orders survive selection, saving, and completing a different order", () => {
  const fixture = createDeliveryFixture();
  fixture.state.open({ ...fixture.order, id: "remote-order-2", crateId: "crate-2" });
  fixture.state.select(fixture.order.id);
  const restored = DroneDeliveries.fromSave(fixture.state.toSave());
  assert.equal(restored.activeOrder.id, fixture.order.id);
  assert.equal(restored.orders.length, 2);
  assert.equal(restored.close("remote-order-2"), true);
  assert.equal(restored.activeOrder.id, fixture.order.id);
  assert.equal(restored.orders.length, 1);
});

test("an expired background order loses reputation without cancelling the selected order", () => {
  const fixture = createDeliveryFixture({ day: 2 });
  fixture.state.addOffer({ ...fixture.order, id: "remote-order-2", offerEndsDay: 2 });
  fixture.system.acceptOffer("remote-order-2");
  assert.equal(fixture.system.endDay(), true);
  assert.equal(fixture.state.activeOrder.id, "remote-order-2");
  assert.equal(fixture.state.orders.length, 1);
  assert.deepEqual(fixture.returned, [{ itemId: "wpn_rif_01", quantity: 2 }]);
  assert.ok(fixture.changes.includes("lose:1"));
});

test("pickup leaves the pad raised, and accepting another order swaps crates without closing the hatch", () => {
  const fixture = createDeliveryFixture({ contents: [] });
  const { system, crate, state } = fixture;
  crate.inTerminal = true;
  system.terminalRaised = false;
  system.terminalOpen = false;
  system.syncTerminalState();
  system.updateTerminalAnimation(480);
  assert.equal(crate.remoteOrderLidOpen, true);
  crate.isCarried = true;
  system.syncTerminalState();
  assert.equal(system.terminalAnimation, null);
  assert.equal(system.terminal.frame, 7);

  state.addOffer({ ...fixture.order, id: "remote-order-2", offerEndsDay: 2 });
  system.acceptOffer("remote-order-2");
  system.syncTerminalState();
  assert.ok(system.terminalAnimation.frames.every((frame) => frame >= 4));
  system.updateTerminalAnimation(180);
  assert.equal(system.terminal.frame, 4);
  assert.equal(system.terminalOpen, true);
  system.updateTerminalAnimation(180);
  system.syncTerminalState();
  system.updateTerminalAnimation(240);
  assert.equal(system.terminal.frame, 7);
  assert.equal(state.orders.length, 2);
  const next = system.findOrderCrate();
  assert.equal(next.inTerminal, false);
  assert.equal(next.remoteOrderLidOpen, true);
  assert.deepEqual(crate.lidCalls, [true], "the carried crate must not close during the swap");

  system.selectOrder(crate.orderId);
  system.syncTerminalState();
  system.updateTerminalAnimation(180);
  system.updateTerminalAnimation(180);
  system.syncTerminalState();
  system.updateTerminalAnimation(240);
  assert.equal(next.inTerminal, true);
  assert.equal(next.sprite.visible, false);
  assert.equal(system.terminal.frame, 7, "the pad comes back up empty for the carried order");
});

test("shipping closes only the returned crate and keeps the hatch open until the last accepted order ships", () => {
  const fixture = createDeliveryFixture();
  const { system, state, crate } = fixture;
  crate.sprite.setPosition(291, 6471);
  crate.animateRemoteOrderLid();
  state.addOffer({ ...fixture.order, id: "remote-order-2", offerEndsDay: 2 });
  system.acceptOffer("remote-order-2");
  state.select(crate.orderId);
  system.updateDeliveryPad(0);
  assert.deepEqual(crate.lidCalls, [true, false]);
  assert.equal(crate.remoteOrderShipping, true);
  assert.equal(crate.sprite.body.enable, false, "the terminal locks the accepted shipment against pickup or pushing");
  system.updateDeliveryPad(700);
  system.updateTerminalAnimation(180);
  assert.equal(state.orders.length, 1);
  assert.equal(system.terminalOpen, true);
  assert.equal(system.terminal.frame, 4);
  system.updateTerminalAnimation(180);
  system.syncTerminalState();
  system.updateTerminalAnimation(240);
  const last = system.findOrderCrate();
  assert.equal(last.remoteOrderLidOpen, true);
  last.contents.set("wpn_rif_01", 2);
  system.updateDeliveryPad(0);
  system.updateDeliveryPad(700);
  system.updateTerminalAnimation(180);
  assert.equal(state.orders.length, 0);
  system.syncTerminalState();
  system.updateTerminalAnimation(240);
  assert.equal(system.terminal.frame, 0);
  assert.equal(system.terminalOpen, false);
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

function createPackingFixture(position) {
  const scene = createScene();
  const stock = new Crate(scene, "wpn_rif_01", 2, 100, 100, { id: "crate-stock" });
  const order = new Crate(scene, null, 0, 160, 100, {
    id: "crate-order", kind: "remote-order", orderId: "remote-order-1",
    requiredItems: [{ itemId: "wpn_rif_01", quantity: 1 }],
  });
  order.setCarriedBy("player");
  const stack = ["base", "middle", "top"].includes(position)
    ? [
      new Crate(scene, "amo_01", 2, 100, 100, { id: "crate-base" }),
      new Crate(scene, "amo_01", 2, 100, 90, { id: "crate-middle" }),
      new Crate(scene, "amo_01", 2, 100, 80, { id: "crate-top" }),
    ] : [stock];
  if (stack.length > 1) {
    stack[["base", "middle", "top"].indexOf(position)] = stock;
    stack.forEach((crate, index) => {
      crate.sprite.y = 100 - index * 10;
      if (index === 0) return;
      crate.setStackedOn(stack[0].id);
      crate.sprite.body.enable = false;
    });
  }
  if (position === "loading-pad") stock.locationState = { kind: "loading-pad", padId: "loading-pad" };
  const events = [];
  const messages = [];
  const shop = {
    player: { sprite: { x: 100, y: 145 }, currentFacing: "up" },
    carriedCrate: order,
    fixtures: { shelves: () => [] },
    crateSystem: {
      floorStacks: new Map(stack.length > 1 ? [[stack[0], stack.slice(1)]] : []),
      getFloorCrates: () => stack,
      getCarriedCrates: () => [order],
    },
    interactables: new InteractableRegistry(),
    controlMode: { allows: () => true },
    checkoutSystem: { operatingRegister: null },
    eventBus: { emit: (_type, event) => events.push(event) },
    messages: { show: (message) => messages.push(message) },
  };
  shop.interactionSystem = new InteractionSystem(shop);
  const system = Object.assign(Object.create(DroneDeliverySystem.prototype), {
    shop,
    orderState: { orders: [{ id: order.orderId, crateId: order.id }], changed() {} },
    itemsById: new Map([["wpn_rif_01", { name: "Rifle" }]]),
    refreshWindow() {},
  });
  system.registerInteractions();
  return { shop, system, stock, order, stack, events, messages };
}

for (const position of ["floor", "loading-pad", "base", "middle", "top"]) {
  test(`E packs one item from a ${position} crate without moving it or overfilling the order`, () => {
    const { shop, stock, order, stack, events } = createPackingFixture(position);
    const before = stack.map((crate) => ({
      location: crate.getLocation(), x: crate.sprite.x, y: crate.sprite.y, enabled: crate.sprite.body.enable,
    }));
    shop.interactionSystem.handleInteract();
    assert.equal(order.getAvailableUnitsFor("wpn_rif_01"), 1);
    assert.equal(stock.quantity, 1);
    assert.deepEqual(events.map((event) => [event.sourceId, event.destinationId, event.quantity]),
      [[stock.id, order.id, 1]]);
    assert.deepEqual(events[0].sourceLocation, stock.getLocation());
    assert.deepEqual(stack.map((crate) => ({
      location: crate.getLocation(), x: crate.sprite.x, y: crate.sprite.y, enabled: crate.sprite.body.enable,
    })), before);
    shop.interactionSystem.handleInteract();
    assert.equal(stock.quantity, 1);
    assert.equal(order.getAvailableUnitsFor("wpn_rif_01"), 1);
    assert.equal(events.length, 1);
    if (position === "loading-pad") {
      assert.equal(stock.canTake(), false, "ordinary stocking must still require picking up the pad crate");
      assert.equal(stock.remove("wpn_rif_01", 1), 0);
    }
  });
}

test("packing from a stack still requires facing its floor base within reach and waiting for it to stop", () => {
  const { shop, order, stock, stack } = createPackingFixture("top");
  shop.player.sprite.y = 200;
  shop.interactionSystem.handleInteract();
  assert.equal(stock.quantity, 2);
  shop.player.sprite.y = 145;
  shop.player.currentFacing = "down";
  shop.interactionSystem.handleInteract();
  assert.equal(stock.quantity, 2);
  shop.player.currentFacing = "up";
  stack[0].sprite.body.velocity.x = 10;
  shop.interactionSystem.handleInteract();
  assert.equal(stock.quantity, 2);
  stack[0].sprite.body.velocity.x = 0;
  shop.interactionSystem.handleInteract();
  assert.equal(stock.quantity, 1);
  assert.equal(order.getAvailableUnitsFor("wpn_rif_01"), 1);
});

test("holding E keeps packing after a short pause and stops when released or the order is full", async () => {
  const { PlayerControls } = await server.ssrLoadModule("/js/input/PlayerControls.js");
  const { shop, stock, order } = createPackingFixture("top");
  order.requiredItems = [{ itemId: "wpn_rif_01", quantity: 3 }];
  stock.quantity = 5;
  shop.time = { now: 0 };
  const controls = new PlayerControls(shop);
  let held = true;
  controls.isActionDown = (action) => action === "interact" && held;
  const packed = () => order.getAvailableUnitsFor("wpn_rif_01");

  controls.interactNow();
  assert.equal(packed(), 1);
  shop.time.now = 200;
  controls.updatePackRepeat();
  assert.equal(packed(), 1, "a quick tap packs only one item");
  shop.time.now = 300;
  controls.updatePackRepeat();
  assert.equal(packed(), 2);
  shop.time.now = 450;
  controls.updatePackRepeat();
  assert.equal(packed(), 3);
  shop.time.now = 600;
  controls.updatePackRepeat();
  assert.equal(packed(), 3);
  assert.equal(stock.quantity, 2);
  assert.equal(controls.packRepeat, null, "holding stops once the order needs nothing more");

  order.requiredItems = [{ itemId: "wpn_rif_01", quantity: 5 }];
  controls.interactNow();
  assert.equal(packed(), 4);
  held = false;
  shop.time.now = 2000;
  controls.updatePackRepeat();
  assert.equal(packed(), 4, "letting go stops packing");
});

test("packing the last item from a Loading Pad crate leaves the empty crate locked in its spot", () => {
  const { shop, stock, order } = createPackingFixture("loading-pad");
  stock.quantity = 1;
  shop.interactionSystem.handleInteract();
  assert.equal(order.getAvailableUnitsFor("wpn_rif_01"), 1);
  assert.equal(stock.quantity, 0);
  assert.equal(stock.itemId, null);
  assert.equal(stock.lockedToPad, true);
  assert.deepEqual(stock.getLocation(), { kind: "loading-pad", padId: "loading-pad" });
});

test("order item sources group shelves and crates by area and skip other items", async () => {
  const { describeOrderSources, findOrderItemSources } =
    await server.ssrLoadModule("/js/modules/droneDeliveries/OrderSources.js");
  const shelf = (y, placements) => ({ y, placements });
  const crate = (itemId, quantity, y) => ({ kind: "item", itemId, quantity, sprite: { x: 10, y } });
  const sources = findOrderItemSources("rifle", {
    shelves: [
      shelf(100, [{ itemId: "rifle", quantity: 4 }, { itemId: "rifle", quantity: 2 }]),
      shelf(120, [{ itemId: "ammo", quantity: 9 }]),
    ],
    floorCrates: [crate("rifle", 12, 900), crate("rifle", 0, 900), crate("ammo", 5, 900),
      { kind: "remote-order", itemId: null, quantity: 3, sprite: { x: 0, y: 900 } }],
    carriedCrates: [crate("rifle", 3, 100)],
    shelfPoint: (entry) => ({ x: 0, y: entry.y }),
    areaAtPoint: (_x, y) => (y > 500 ? "backroom" : "shop"),
  });

  assert.deepEqual(sources.map(({ kind, area, quantity }) => [kind, area, quantity]), [
    ["shelf", "shop", 6],
    ["crate", "backroom", 12],
    ["carried", "shop", 3],
  ]);
  assert.equal(
    describeOrderSources(sources, (area) => (area === "shop" ? "Sales floor" : "Backroom")),
    "Sales floor shelves: 6 · Backroom crates: 12 · Crates you're carrying: 3",
  );
});
