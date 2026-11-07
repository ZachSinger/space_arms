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

before(async () => {
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
      },
      load(id) {
        if (id === "\0customer-shopping-test-sprites") {
          return "export const pickRandomCustomerCharacter = () => ({ factionId: null, facingTextures: {} });";
        }
      },
    }],
  });
  ({ Customer } = await server.ssrLoadModule("/js/logic/Customer.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

function fixture(standPoint, placements) {
  return {
    standPoint,
    placements,
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

function makeCustomer({ factionId = "scavengers", plan }) {
  const repChanges = [];
  const floatingText = [];
  const missingPrimaryEvents = [];
  const inventoryTransfers = [];
  const eventBus = new EventBus();
  eventBus.on(GAME_EVENTS.INVENTORY_TRANSFERRED, (event) => inventoryTransfers.push(event));
  const customer = Object.create(Customer.prototype);
  customer.scene = {
    eventBus,
    getItem: (id) => ({
      id,
      tags: id === "gun" ? ["Firearm", "Rifle"] : [],
    }),
    getStorePrice: () => 10,
    market: { getPrice: () => 100 },
    showFloatingText: (...args) => floatingText.push(args),
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
  customer.onMissingPrimary = (who, itemIds) =>
    missingPrimaryEvents.push({ customer: who, itemIds });
  customer.setDestination = (x, y, onArrive) => {
    if (x < 900 && y < 900) onArrive();
  };
  customer.enterLeaving = () => { customer.state = "LEAVING"; };
  customer.primaryBought = new Set();
  customer.primaryMissing = new Set();
  customer.bonusBought = new Set();
  customer.bonusAttempted = new Set();
  customer.purchasedFirearms = new Set();
  customer.onComplete = () => {};
  customer.isDestroyed = false;
  customer.scene.showFloatingText = (...args) => floatingText.push(args);
  return { customer, repChanges, floatingText, missingPrimaryEvents, inventoryTransfers };
}

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
  customer.visitNextShelf("primary");

  assert.deepEqual(customer.cart.map((entry) => entry.itemId), ["wanted", "bonus"]);
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
  assert.deepEqual(missingPrimaryEvents, [{ customer, itemIds: ["missing"] }]);
  assert.deepEqual(repChanges, []);
  assert.deepEqual(floatingText, []);
  assert.equal(customer.state, "SEEK_REGISTER");
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

  assert.deepEqual(missingPrimaryEvents, [{ customer, itemIds: ["wanted", "missing"] }]);
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
  assert.match(floatingText[0][2], /tools or survival gear/i);
});
