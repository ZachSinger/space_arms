import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventBus, GAME_EVENTS } from "../js/logic/EventBus.js";
import { createServer } from "vite";

let server;
let cacheDirectory;
let Customer;
let GameScene;
const originalPhaser = globalThis.Phaser;

before(async () => {
  globalThis.Phaser = { Scene: class {} };
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-customer-shopping-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    plugins: [{
      name: "customer-shopping-test-stubs",
      enforce: "pre",
      resolveId(source) {
        if (source === "./CustomerSprites.js") return "\0customer-shopping-test-sprites";
        if (source === "./boot.js" || source === "../scenes/boot.js") {
          return "\0customer-shopping-test-database";
        }
      },
      load(id) {
        if (id === "\0customer-shopping-test-sprites") {
          return "export const pickRandomCustomerCharacter = () => ({ factionId: null, textureKey: 'customer_test' }); export const addCharacterSprite = () => ({}); export const showCharacterFacing = () => {}; export const CHARACTER_HEAD_HEIGHT = 32;";
        }
        if (id === "\0customer-shopping-test-database") {
          return "export const database = { getItem: (id) => ({ id, name: id, tags: [] }) };";
        }
      },
    }],
  });
  ({ Customer } = await server.ssrLoadModule("/js/logic/Customer.js"));
  ({ GameScene } = await server.ssrLoadModule("/js/scenes/game.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
  if (originalPhaser === undefined) delete globalThis.Phaser;
  else globalThis.Phaser = originalPhaser;
});

function fixture(standPoint, placements) {
  return {
    standPoint,
    placements,
    findAvailableSlot() {
      return this.placements.find((placement) => placement.quantity > 0) || null;
    },
    getAvailableUnitsFor(itemId, placement) {
      return this.placements.includes(placement) && placement.itemId === itemId
        ? placement.quantity
        : 0;
    },
    getRemainingUnitsFor(itemId, placement) {
      return this.getAvailableUnitsFor(itemId, placement) === 0
        ? 0
        : Number.MAX_SAFE_INTEGER;
    },
    remove(itemId, quantity, placement) {
      const removed = Math.min(this.getAvailableUnitsFor(itemId, placement), quantity);
      placement.quantity -= removed;
      return removed;
    },
    add(itemId, quantity, placement) {
      if (!this.placements.includes(placement) || placement.itemId !== itemId) return 0;
      placement.quantity += quantity;
      return quantity;
    },
  };
}

function makeShelfScene(shelves) {
  const scene = Object.create(GameScene.prototype);
  scene.fixtures = { shelves: () => shelves };
  scene.getStorePrice = () => 10;
  scene.market = { getPrice: () => 10 };
  return scene;
}

function makeCustomer({ factionId = "scavengers", plan }) {
  const repChanges = [];
  const floatingText = [];
  const missingPrimaryEvents = [];
  const inventoryTransfers = [];
  const reactionGraphics = [];
  const addReactionGraphics = () => {
    const graphic = {
      x: 0,
      y: 0,
      alpha: 1,
      destroyed: false,
      setDepth() { return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setAlpha(alpha) { this.alpha = alpha; return this; },
      fillStyle() { return this; },
      fillCircle() { return this; },
      lineStyle() { return this; },
      strokeCircle() { return this; },
      beginPath() { return this; },
      moveTo() { return this; },
      lineTo() { return this; },
      strokePath() { return this; },
      destroy() { this.destroyed = true; },
    };
    reactionGraphics.push(graphic);
    return graphic;
  };
  const eventBus = new EventBus();
  eventBus.on(GAME_EVENTS.INVENTORY_TRANSFERRED, (event) => inventoryTransfers.push(event));
  const customer = Object.create(Customer.prototype);
  customer.scene = {
    eventBus,
    getItem: (id) => ({
      id,
      name: id,
      tags: id === "gun" ? ["Firearm", "Rifle"] : [],
    }),
    getStorePrice: () => 10,
    market: { getPrice: () => 100 },
    showFloatingText: (...args) => floatingText.push(args),
    add: { graphics: addReactionGraphics },
  };
  customer.sprite = { x: 100, y: 100 };
  customer.factionId = factionId;
  customer.playerState = {
    subReputation: (amount, id) => repChanges.push({ amount, factionId: id }),
    notifyListeners() {},
  };
  customer.shoppingPlan = plan;
  customer.state = "SEEK_SHELF";
  customer.cart = [];
  customer.priceTolerance = 1.3;
  customer.registerPoint = { x: 900, y: 900 };
  customer.onReserveShelfSlot = (_shelf) => _shelf.standPoint;
  customer.onReserveQueueSlot = () => ({ x: 900, y: 900 });
  customer.onJoinQueue = () => {};
  customer.onMissingPrimary = (who, itemIds, itemNames) =>
    missingPrimaryEvents.push({ customer: who, itemIds, itemNames });
  customer.setDestination = (x, y, onArrive) => {
    if (x < 900 && y < 900) onArrive();
  };
  customer.enterLeaving = () => { customer.state = "LEAVING"; };
  customer.primaryBought = new Set();
  customer.primaryMissing = new Set();
  customer.priceRejectedItemIds = new Set();
  customer.bonusBought = new Set();
  customer.bonusAttempted = new Set();
  customer.purchasedFirearms = new Set();
  customer.reactionEventsShown = new Set();
  customer.reactionBubble = null;
  customer.reactionRemainingMs = 0;
  customer.onComplete = () => {};
  customer.isDestroyed = false;
  customer.scene.showFloatingText = (...args) => floatingText.push(args);
  return {
    customer,
    repChanges,
    floatingText,
    missingPrimaryEvents,
    inventoryTransfers,
    reactionGraphics,
  };
}

test("departing customers use distinct spots across the entrance", () => {
  const scene = Object.create(GameScene.prototype);
  scene.exitPoint = { x: 1000, y: 96 };
  scene.customers = [];

  const slots = Array.from({ length: 6 }, () => {
    const slot = scene.reserveExitSlot();
    scene.customers.push({ state: "LEAVING", destination: slot });
    return slot;
  });

  assert.equal(new Set(slots.map(({ x, y }) => `${x},${y}`)).size, 6);
  assert.ok(slots.every(({ x, y }) =>
    Math.abs(x - scene.exitPoint.x) <= 36 && Math.abs(y - scene.exitPoint.y) <= 8,
  ));
  assert.throws(() => scene.reserveExitSlot(), /No unoccupied customer exit slot/);
});

test("random browsing chooses only stocked shelves other than the next stop", () => {
  const empty = fixture({ x: 100, y: 100 }, []);
  const soldOut = fixture({ x: 200, y: 100 }, [{ itemId: "missing", quantity: 0 }]);
  const first = fixture({ x: 300, y: 100 }, [{ itemId: "first", quantity: 1 }]);
  const second = fixture({ x: 400, y: 100 }, [{ itemId: "second", quantity: 2 }]);
  const scene = makeShelfScene([empty, soldOut, first, second]);

  for (let i = 0; i < 20; i += 1) {
    assert.ok([first, second].includes(scene.getRandomBrowseShelf()));
  }
  assert.equal(scene.getRandomBrowseShelf(first), second);
  first.placements[0].quantity = 0;
  assert.equal(scene.getRandomBrowseShelf(), second);
  assert.equal(scene.getRandomBrowseShelf(second), null);
  second.placements[0].quantity = 0;
  assert.equal(scene.getRandomBrowseShelf(), null);
});

test("wanderer routes include stocked shelves while keeping sold-out wants for reporting", (t) => {
  t.mock.method(Math, "random", () => 0);
  const soldOut = fixture({ x: 100, y: 100 }, [{ itemId: "missing", quantity: 0 }]);
  const stocked = fixture({ x: 200, y: 100 }, [{ itemId: "available", quantity: 2 }]);
  const empty = fixture({ x: 300, y: 100 }, []);
  const plan = makeShelfScene([soldOut, stocked, empty])
    .createCustomerShoppingPlan(null, ["wanderer"]);

  assert.deepEqual(plan.primaryItemIds, ["missing"]);
  assert.deepEqual(plan.shelfStops.map((stop) => stop.fixture), [soldOut]);
  assert.deepEqual(plan.allShelfStops.map((stop) => stop.fixture), [stocked]);
});

test("customer emoticons appear only for a new event and fade while following the customer", () => {
  const { customer, reactionGraphics } = makeCustomer({ plan: {} });

  assert.equal(customer.showReaction("price-too-high", "disappointed"), true);
  assert.equal(customer.showReaction("price-too-high", "disappointed"), false);
  assert.equal(customer.showReaction("left-angry", "angry"), false);
  // Above the character's head: 100 - 32 head height - 12.
  assert.deepEqual([reactionGraphics[0].x, reactionGraphics[0].y], [123, 56]);

  customer.sprite.x = 130;
  customer.updateReaction(1500);
  assert.equal(reactionGraphics[0].x, 153);
  assert.equal(reactionGraphics[0].alpha, 1);
  customer.updateReaction(150);
  assert.equal(reactionGraphics[0].alpha, 0.5);
  customer.updateReaction(150);
  assert.equal(reactionGraphics[0].destroyed, true);
  assert.equal(customer.showReaction("left-angry", "angry"), true);
});

test("customers report missing primary stock while continuing to buy remaining items", () => {
  const inStock = fixture({ x: 100, y: 100 }, [{ itemId: "wanted", quantity: 1 }]);
  const soldOut = fixture({ x: 200, y: 100 }, [{ itemId: "missing", quantity: 0 }]);
  const bonusShelf = fixture({ x: 300, y: 100 }, [{ itemId: "bonus", quantity: 1 }]);
  const plan = {
    primaryItemIds: ["wanted", "missing"],
    bonusItemIds: ["bonus"],
    matchingAmmoIdsByFirearm: {},
    shelfStops: [
      { fixture: inStock, standPoint: inStock.standPoint },
      { fixture: soldOut, standPoint: soldOut.standPoint },
      { fixture: bonusShelf, standPoint: bonusShelf.standPoint },
    ],
  };
  const {
    customer,
    repChanges,
    floatingText,
    missingPrimaryEvents,
    inventoryTransfers,
  } = makeCustomer({ plan });
  const destinations = [];
  const setDestination = customer.setDestination;
  customer.setDestination = (x, y, onArrive) => {
    destinations.push({ x, y });
    setDestination(x, y, onArrive);
  };
  customer.visitNextShelf("primary");

  assert.deepEqual(customer.cart.map((entry) => entry.itemId), ["wanted", "bonus"]);
  assert.deepEqual(destinations, [inStock.standPoint, bonusShelf.standPoint, { x: 900, y: 900 }]);
  assert.deepEqual(inventoryTransfers, [
    {
      itemId: "wanted",
      quantity: 1,
      source: "shelf",
      destination: "customer-cart",
    },
    {
      itemId: "bonus",
      quantity: 1,
      source: "shelf",
      destination: "customer-cart",
    },
  ]);
  assert.deepEqual(missingPrimaryEvents, [{
    customer, itemIds: ["missing"], itemNames: ["missing"],
  }]);
  assert.deepEqual(repChanges, []);
  assert.deepEqual(floatingText, []);
  assert.equal(customer.state, "SEEK_REGISTER");
});

test("customers name items they cannot afford after shopping", () => {
  const shelf = fixture({ x: 100, y: 100 }, [{ itemId: "wanted", quantity: 1 }]);
  const plan = {
    primaryItemIds: ["wanted"],
    bonusItemIds: [],
    matchingAmmoIdsByFirearm: {},
    shelfStops: [{ fixture: shelf, standPoint: shelf.standPoint }],
  };
  const { customer, floatingText } = makeCustomer({ plan });
  customer.scene.getStorePrice = () => 200;
  customer.scene.market.getPrice = () => 100;

  customer.visitNextShelf("primary");

  assert.equal(customer.state, "LEAVING");
  assert.equal(floatingText.length, 1);
  assert.match(floatingText[0][2], /too expensive:\s*wanted/i);
});

test("customers do not walk through obstacles when a shelf has no route", () => {
  const shelf = fixture({ x: 100, y: 100 }, [{ itemId: "wanted", quantity: 1 }]);
  const plan = {
    primaryItemIds: ["wanted"],
    bonusItemIds: [],
    matchingAmmoIdsByFirearm: {},
    shelfStops: [{ fixture: shelf, standPoint: shelf.standPoint }],
  };
  const { customer, floatingText } = makeCustomer({ plan });
  let moved = false;
  customer.setDestination = Customer.prototype.setDestination;
  customer.scene.findPath = (_fromX, _fromY, toX) => toX === 100 ? null : [];
  customer.exitPoint = { x: 900, y: 900 };
  customer.onReserveExitSlot = () => customer.exitPoint;
  customer.sprite.body = { setVelocity() {} };
  customer.moveToward = () => { moved = true; };

  customer.visitNextShelf("primary");
  assert.equal(customer.path, null);
  customer.update(16);

  assert.equal(moved, false);
  assert.equal(customer.state, "LEAVING");
  assert.match(floatingText[0][2], /can't reach:\s*wanted/i);
});

test("a shelf that sells out while a customer approaches is skipped and reported missing", () => {
  const shelf = fixture({ x: 100, y: 100 }, [{ itemId: "wanted", quantity: 1 }]);
  const plan = {
    primaryItemIds: ["wanted"],
    bonusItemIds: [],
    matchingAmmoIdsByFirearm: {},
    shelfStops: [{ fixture: shelf, standPoint: shelf.standPoint }],
  };
  const { customer, missingPrimaryEvents } = makeCustomer({ factionId: null, plan });
  let arrive;
  customer.setDestination = (_x, _y, callback) => { arrive = callback; };
  customer.browseShelfMs = [1000, 1000];
  customer.visitNextShelf("primary");
  shelf.placements[0].quantity = 0;
  arrive();

  assert.equal(customer.state, "LEAVING");
  assert.deepEqual(missingPrimaryEvents, [{
    customer, itemIds: ["wanted"], itemNames: ["wanted"],
  }]);
  assert.deepEqual(customer.cart, []);
});

test("a browsing detour reserves a stocked shelf and skips it if it sells out on the way", (t) => {
  t.mock.method(Math, "random", () => 0);
  const wanted = fixture({ x: 100, y: 100 }, [{ itemId: "wanted", quantity: 1 }]);
  const detour = fixture({ x: 200, y: 100 }, [{ itemId: "other", quantity: 1 }]);
  const plan = {
    primaryItemIds: ["wanted"],
    bonusItemIds: [],
    matchingAmmoIdsByFirearm: {},
    shelfStops: [{ fixture: wanted, standPoint: wanted.standPoint }],
  };
  const { customer } = makeCustomer({ factionId: null, plan });
  const reservations = [];
  const destinations = [];
  const arrivals = [];
  customer.wanderChance = 1;
  customer.scene.getRandomBrowseShelf = (excluded) => {
    assert.equal(excluded, wanted);
    return detour;
  };
  customer.onReserveShelfSlot = (shelf, shopper) => {
    assert.equal(shopper, customer);
    reservations.push(shelf);
    return shelf.standPoint;
  };
  customer.setDestination = (x, y, callback) => {
    destinations.push({ x, y });
    arrivals.push(callback);
  };
  customer.visitNextShelf("primary");

  assert.deepEqual(reservations, [detour]);
  assert.deepEqual(destinations, [detour.standPoint]);
  detour.placements[0].quantity = 0;
  arrivals.shift()();
  assert.deepEqual(reservations, [detour, wanted]);
  assert.deepEqual(destinations, [detour.standPoint, wanted.standPoint]);
  arrivals.shift()();
  assert.deepEqual(customer.cart.map((entry) => entry.itemId), ["wanted"]);
  assert.equal(customer.state, "SEEK_REGISTER");
});

test("a customer changes course as soon as a browsing destination sells out", (t) => {
  t.mock.method(Math, "random", () => 0);
  const wanted = fixture({ x: 100, y: 100 }, [{ itemId: "wanted", quantity: 1 }]);
  const detour = fixture({ x: 200, y: 100 }, [{ itemId: "other", quantity: 1 }]);
  const plan = {
    primaryItemIds: ["wanted"],
    bonusItemIds: [],
    matchingAmmoIdsByFirearm: {},
    shelfStops: [{ fixture: wanted, standPoint: wanted.standPoint }],
  };
  const { customer } = makeCustomer({ factionId: null, plan });
  const destinations = [];
  customer.sprite.body = { setVelocity() {} };
  customer.wanderChance = 1;
  customer.scene.getRandomBrowseShelf = () => detour;
  customer.setDestination = (x, y, callback) => {
    destinations.push({ x, y });
    customer.onArriveAtDestination = callback;
    customer.seekingTimer = 0;
  };
  customer.followPath = () => { throw new Error("Should not continue toward the empty shelf"); };
  customer.updateReaction = () => {};
  customer.visitNextShelf("primary");
  detour.placements[0].quantity = 0;
  customer.update(16);

  assert.deepEqual(destinations, [detour.standPoint, wanted.standPoint]);
  assert.equal(customer.fixture, wanted);
  assert.equal(customer.state, "SEEK_SHELF");
});

test("customers stand looking at a shelf for a moment before taking anything", () => {
  const shelf = fixture({ x: 100, y: 100 }, [{ itemId: "wanted", quantity: 1 }]);
  const plan = {
    primaryItemIds: ["wanted"],
    bonusItemIds: [],
    matchingAmmoIdsByFirearm: {},
    shelfStops: [{ fixture: shelf, standPoint: shelf.standPoint }],
  };
  const { customer } = makeCustomer({ factionId: null, plan });
  const facings = [];
  customer.sprite.body = { setVelocity() {} };
  customer.updateFacing = (facing) => facings.push(facing);
  customer.browseShelfMs = [1000, 1000];
  customer.wanderChance = 0;
  customer.updateReaction = () => {};
  customer.visitNextShelf("primary");

  assert.equal(customer.state, "BROWSING");
  assert.deepEqual(customer.cart, []);
  customer.update(600);
  assert.deepEqual(customer.cart, []);
  assert.equal(facings.at(-1), "up", "faces the shelf front");
  customer.update(500);
  assert.deepEqual(customer.cart.map((entry) => entry.itemId), ["wanted"]);
  assert.equal(customer.state, "SEEK_REGISTER");
});

test("customers fill multiple identical wants across shelf placements and shelves without overbuying", () => {
  const first = fixture({ x: 100, y: 100 }, [
    { itemId: "wanted", quantity: 1 }, { itemId: "wanted", quantity: 1 },
  ]);
  const second = fixture({ x: 200, y: 100 }, [{ itemId: "wanted", quantity: 5 }]);
  const plan = {
    primaryItemIds: ["wanted"], bonusItemIds: [], matchingAmmoIdsByFirearm: {},
    itemQuantities: { wanted: 3 },
    shelfStops: [first, second].map((shelf) => ({ fixture: shelf, standPoint: shelf.standPoint })),
  };
  const { customer, inventoryTransfers } = makeCustomer({ factionId: null, plan });
  customer.visitNextShelf("primary");
  assert.deepEqual(customer.cart, Array.from({ length: 3 }, () => ({ itemId: "wanted", price: 10 })));
  assert.deepEqual(first.placements.map(({ quantity }) => quantity), [0, 0]);
  assert.equal(second.placements[0].quantity, 4);
  assert.equal(customer.getRemainingUnitsFor("wanted"), 0);
  assert.equal(inventoryTransfers.reduce((sum, { quantity }) => sum + quantity, 0), 3);
  assert.equal(customer.cart.reduce((sum, { price }) => sum + price, 0), 30);
});

test("multiple-item shopping takes only available stock and does not buy overpriced multiples", () => {
  for (const price of [10, 200]) {
    const shelf = fixture({ x: 100, y: 100 }, [{ itemId: "wanted", quantity: 2 }]);
    const plan = {
      primaryItemIds: ["wanted"], bonusItemIds: [], matchingAmmoIdsByFirearm: {},
      itemQuantities: { wanted: 3 },
      shelfStops: [{ fixture: shelf, standPoint: shelf.standPoint }],
    };
    const { customer } = makeCustomer({ factionId: null, plan });
    customer.scene.getStorePrice = () => price;
    customer.visitNextShelf("primary");
    assert.equal(customer.cart.length, price === 10 ? 2 : 0);
    assert.equal(shelf.placements[0].quantity, price === 10 ? 0 : 2);
  }
});

test("a customer stops looking at a shelf if it sells out during the pause", () => {
  const shelf = fixture({ x: 100, y: 100 }, [{ itemId: "wanted", quantity: 1 }]);
  const plan = {
    primaryItemIds: ["wanted"],
    bonusItemIds: [],
    matchingAmmoIdsByFirearm: {},
    shelfStops: [{ fixture: shelf, standPoint: shelf.standPoint }],
  };
  const { customer, missingPrimaryEvents } = makeCustomer({ factionId: null, plan });
  customer.sprite.body = { setVelocity() {} };
  customer.updateFacing = () => {};
  customer.browseShelfMs = [1000, 1000];
  customer.visitNextShelf("primary");
  assert.equal(customer.state, "BROWSING");
  shelf.placements[0].quantity = 0;
  customer.update(16);

  assert.equal(customer.state, "LEAVING");
  assert.deepEqual(missingPrimaryEvents, [{
    customer, itemIds: ["wanted"], itemNames: ["wanted"],
  }]);
});

test("customers react happily when they pick up an item priced at least 10% below market", () => {
  const shelf = fixture({ x: 100, y: 100 }, [{ itemId: "bargain", quantity: 1 }]);
  const { customer, reactionGraphics } = makeCustomer({
    factionId: null,
    plan: { primaryItemIds: [], bonusItemIds: [], matchingAmmoIdsByFirearm: {}, shelfStops: [] },
  });
  customer.scene.getStorePrice = () => 90;
  customer.fixture = shelf;
  customer.phaseItemIds = ["bargain"];
  customer.shoppingPhase = "bonus";
  customer.visitNextShelfStop = () => {};
  customer.shopAtCurrentShelf();

  assert.deepEqual(customer.cart, [{ itemId: "bargain", price: 90 }]);
  assert.equal(reactionGraphics.length, 1);
  assert.equal(customer.reactionEventsShown.has("good-deal"), true);
});

test("customers report all missing primary items once and skip bonuses when none are in stock", () => {
  const primaryShelf = fixture({ x: 100, y: 100 }, [
    { itemId: "wanted", quantity: 0 },
    { itemId: "missing", quantity: 0 },
  ]);
  const bonusShelf = fixture({ x: 200, y: 100 }, [{ itemId: "bonus", quantity: 1 }]);
  const plan = {
    primaryItemIds: ["wanted", "missing"],
    bonusItemIds: ["bonus"],
    matchingAmmoIdsByFirearm: {},
    shelfStops: [
      { fixture: primaryShelf, standPoint: primaryShelf.standPoint },
      { fixture: bonusShelf, standPoint: bonusShelf.standPoint },
    ],
  };
  const { customer, repChanges, missingPrimaryEvents } = makeCustomer({ factionId: null, plan });
  customer.visitNextShelf("primary");

  assert.deepEqual(missingPrimaryEvents, [{
    customer,
    itemIds: ["wanted", "missing"],
    itemNames: ["wanted", "missing"],
  }]);
  assert.deepEqual(repChanges, []);
  assert.equal(customer.state, "LEAVING");
  assert.deepEqual(customer.cart, []);
  assert.equal(bonusShelf.placements[0].quantity, 1);
});

test("missing bonus items are not reported as primary stockouts", () => {
  const primaryShelf = fixture({ x: 100, y: 100 }, [{ itemId: "wanted", quantity: 1 }]);
  const bonusShelf = fixture({ x: 200, y: 100 }, [{ itemId: "bonus", quantity: 0 }]);
  const plan = {
    primaryItemIds: ["wanted"],
    bonusItemIds: ["bonus"],
    matchingAmmoIdsByFirearm: {},
    shelfStops: [
      { fixture: primaryShelf, standPoint: primaryShelf.standPoint },
      { fixture: bonusShelf, standPoint: bonusShelf.standPoint },
    ],
  };
  const { customer, repChanges, missingPrimaryEvents } = makeCustomer({ plan });
  customer.visitNextShelf("primary");

  assert.deepEqual(repChanges, []);
  assert.deepEqual(missingPrimaryEvents, []);
  assert.deepEqual(customer.cart.map((entry) => entry.itemId), ["wanted"]);
  assert.equal(customer.bonusAttempted.has("bonus"), true);
  assert.equal(customer.state, "SEEK_REGISTER");
});

test("bonus shopping finishes when matching ammunition has no shelf to visit", () => {
  const shelf = fixture({ x: 100, y: 100 }, [{ itemId: "gun", quantity: 1 }]);
  const plan = {
    primaryItemIds: ["gun"],
    bonusItemIds: [],
    matchingAmmoIdsByFirearm: { gun: ["ammo"] },
    shelfStops: [{ fixture: shelf, standPoint: shelf.standPoint }],
  };
  const { customer } = makeCustomer({ factionId: "mercenaries", plan });
  customer.visitNextShelf("primary");

  assert.deepEqual(customer.cart.map((entry) => entry.itemId), ["gun"]);
  assert.equal(customer.bonusAttempted.has("ammo"), true);
  assert.equal(customer.state, "SEEK_REGISTER");
});

test("a bonus firearm still prompts another pass for matching ammunition", () => {
  const primary = fixture({ x: 100, y: 100 }, [{ itemId: "wanted", quantity: 1 }]);
  const firearm = fixture({ x: 200, y: 100 }, [{ itemId: "gun", quantity: 1 }]);
  const ammo = fixture({ x: 300, y: 100 }, [{ itemId: "ammo", quantity: 1 }]);
  const plan = {
    primaryItemIds: ["wanted"],
    bonusItemIds: ["gun"],
    matchingAmmoIdsByFirearm: { gun: ["ammo"] },
    shelfStops: [primary, firearm, ammo].map((shelf) =>
      ({ fixture: shelf, standPoint: shelf.standPoint })),
  };
  const { customer } = makeCustomer({ factionId: "mercenaries", plan });
  customer.visitNextShelf("primary");

  assert.deepEqual(customer.cart.map((entry) => entry.itemId), ["wanted", "gun", "ammo"]);
  assert.equal(customer.state, "SEEK_REGISTER");
});

test("Mercenaries collect matching ammunition after buying a firearm", () => {
  const firearmShelf = fixture({ x: 100, y: 100 }, [{ itemId: "gun", quantity: 1 }]);
  const ammoShelf = fixture({ x: 200, y: 100 }, [{ itemId: "ammo", quantity: 1 }]);
  const plan = {
    primaryItemIds: ["gun"],
    bonusItemIds: [],
    matchingAmmoIdsByFirearm: { gun: ["ammo"] },
    shelfStops: [
      { fixture: firearmShelf, standPoint: firearmShelf.standPoint },
      { fixture: ammoShelf, standPoint: ammoShelf.standPoint },
    ],
  };
  const { customer } = makeCustomer({ factionId: "mercenaries", plan });
  customer.visitNextShelf("primary");

  assert.deepEqual(customer.cart.map((entry) => entry.itemId), ["gun", "ammo"]);
  assert.equal(customer.state, "SEEK_REGISTER");
});

test("factions with no eligible shelf assignments leave with a hint and no penalty", () => {
  const plan = {
    primaryItemIds: [],
    bonusItemIds: [],
    matchingAmmoIdsByFirearm: {},
    shelfStops: [],
  };
  const { customer, repChanges, floatingText } = makeCustomer({
    factionId: "explorers",
    plan,
  });
  customer.shoppingPhase = "primary";
  customer.finishShoppingPhase();

  assert.deepEqual(repChanges, []);
  assert.equal(customer.state, "LEAVING");
  assert.match(floatingText[0][2], /no matching stock/i);
  assert.match(floatingText[0][2], /tools or survival gear/i);
});

test("neutral customers explain when there are no products to browse", () => {
  const { customer, floatingText } = makeCustomer({
    factionId: null,
    plan: { primaryItemIds: [], bonusItemIds: [], shelfStops: [] },
  });
  customer.shoppingPhase = "primary";
  customer.finishShoppingPhase();

  assert.match(floatingText[0][2], /no products are on the shelves/i);
});
