// ==========================================
// FILE: SupplySystem.js
// ==========================================
// Supply orders and the Loading Pad: what a crate of stock costs, the Supply tab's rows,
// placing an order, and the pad's 3x3 grid of delivery spots. Deliveries land on free spots
// chosen so the player is never boxed in; if he is anyway, he's moved just above the pad.
import { database } from "../scenes/boot.js";
import { FIXTURE_CRATE_SPRITE, ITEM_CRATE_SPRITE } from "../logic/Crate.js";
import { getCrateOrderQuantity, summarizeSupplyOrder } from "../logic/SupplyOrder.js";
import { sourceItems } from "../logic/InventoryTransfer.js";
import { canLeaveLoadingPad } from "../logic/LoadingPadEscape.js";
import {
  getBackroomBounds, getBackroomInteriorBounds, LOADING_PAD_HEIGHT, LOADING_PAD_WIDTH,
} from "../logic/RoomLayout.js";

// Loading Pad: a 3x3 grid of crate spots, each fitting one 32px crate (all px).
const LOADING_PAD_SPOT_SIZE = 32;
const LOADING_PAD_SPOT_SPACING = 40;
// How far (px) a crate may overhang a neighboring spot before that spot counts as taken.
const LOADING_PAD_OVERHANG_ALLOWANCE = 6;
let nextSupplyDeliveryId = 1;

export class SupplySystem {
  /**
   * @param {object} shop - the game scene
   * @param {{ left: number, right: number, top: number, bottom: number,
   *   centerX: number, centerY: number, contains(x: number, y: number): boolean }} padRect
   */
  constructor(shop, padRect) {
    this.shop = shop;
    this.padRect = padRect;
  }

  get padCenter() {
    return { x: this.padRect.centerX, y: this.padRect.centerY };
  }

  /** What one crate of this item costs to order today. */
  crateCost(item) {
    return this.shop.gameState.market.getSupplyCost(item.id, getCrateOrderQuantity(item));
  }

  padSpots() {
    const offsets = [-LOADING_PAD_SPOT_SPACING, 0, LOADING_PAD_SPOT_SPACING];
    const center = this.padCenter;
    return offsets.flatMap((dy) => offsets.map((dx) => ({ x: center.x + dx, y: center.y + dy })));
  }

  // Every Loading Pad spot a new crate could land on without overlapping an existing crate.
  // A crate only blocks a spot it really sits on: fixture crates are drawn larger than a spot
  // and slightly overhang their neighbors, which shouldn't count.
  freePadSpots() {
    return this.padSpots().filter((position) => !this.shop.restockCrates.some((crate) => {
      const reach = crate.sprite.displayWidth / 2 + LOADING_PAD_SPOT_SIZE / 2 - LOADING_PAD_OVERHANG_ALLOWANCE;
      return Math.abs(crate.sprite.x - position.x) < reach && Math.abs(crate.sprite.y - position.y) < reach;
    }));
  }

  firstFreePadSpot() {
    return this.freePadSpots()[0] ?? null;
  }

  // Painted floor marking: a plate with one outlined square per crate spot.
  drawPad() {
    const { x, y } = this.padCenter;
    const pad = this.shop.add.graphics().setDepth(0.5);
    pad.fillStyle(0x0f172a, 0.55);
    pad.fillRect(x - LOADING_PAD_WIDTH / 2, y - LOADING_PAD_HEIGHT / 2, LOADING_PAD_WIDTH, LOADING_PAD_HEIGHT);
    pad.lineStyle(2, 0xfacc15, 0.9);
    pad.strokeRect(x - LOADING_PAD_WIDTH / 2, y - LOADING_PAD_HEIGHT / 2, LOADING_PAD_WIDTH, LOADING_PAD_HEIGHT);
    pad.lineStyle(1, 0xfacc15, 0.35);
    for (const spot of this.padSpots()) {
      pad.strokeRect(
        spot.x - LOADING_PAD_SPOT_SIZE / 2,
        spot.y - LOADING_PAD_SPOT_SIZE / 2,
        LOADING_PAD_SPOT_SIZE,
        LOADING_PAD_SPOT_SIZE,
      );
    }
    this.shop.add
      .text(x, y - LOADING_PAD_HEIGHT / 2 - 4, "LOADING PAD", {
        fontFamily: "monospace",
        fontSize: "14px",
        fontStyle: "bold",
        color: "#facc15",
      })
      .setOrigin(0.5, 1)
      .setAlpha(0.85)
      .setDepth(0.5);
  }

  /**
   * Whether the player could still walk off the Loading Pad, if crates also sat at extraSpots.
   * @param {{ x: number, y: number }[]} [extraSpots]
   */
  canPlayerLeavePad(extraSpots = []) {
    const shop = this.shop;
    const body = shop.player?.sprite.body;
    if (!body || body.y < getBackroomBounds(shop.room.zones).y) return true;
    const rectOf = (b) => ({ left: b.x, top: b.y, width: b.width, height: b.height });
    // A crate that hasn't landed yet is sized to cover either kind of crate.
    const width = Math.max(ITEM_CRATE_SPRITE.width, FIXTURE_CRATE_SPRITE.width);
    const height = Math.max(ITEM_CRATE_SPRITE.height, FIXTURE_CRATE_SPRITE.height);
    const crates = [
      ...shop.restockCrates.filter((crate) => crate.lockedToPad).map((crate) => rectOf(crate.sprite.body)),
      ...extraSpots.map((spot) => ({ left: spot.x - width / 2, top: spot.y - height / 2, width, height })),
    ];
    return canLeaveLoadingPad({
      player: rectOf(body),
      crates,
      pad: { top: this.padRect.top },
      floor: getBackroomInteriorBounds(shop.room.zones),
    });
  }

  /**
   * Free pad spots for new crates, picked so the player isn't boxed in wherever the free
   * spots allow it.
   * @param {number} count
   */
  takePadSpots(count) {
    const free = this.freePadSpots();
    const chosen = [];
    while (chosen.length < count && free.length) {
      const index = free.findIndex((spot) => this.canPlayerLeavePad([...chosen, spot]));
      chosen.push(...free.splice(Math.max(0, index), 1));
    }
    return chosen;
  }

  // If a delivery boxed the player in anyway, he steps onto the floor just above the pad.
  freePlayerFromPad() {
    if (this.canPlayerLeavePad()) return;
    const sprite = this.shop.player.sprite;
    const body = sprite.body;
    const left = this.padRect.centerX - body.width / 2;
    const top = this.padRect.top - body.height - 2;
    body.reset(sprite.x + left - body.x, sprite.y + top - body.y);
  }

  /**
   * Puts a newly delivered crate on the pad. Call freePlayerFromPad() once all have landed.
   * @param {import("../logic/Crate.js").Crate} crate
   */
  deliver(crate) {
    crate.setPaused(this.shop.crateMotionPaused);
    crate.lockToPad();
    this.shop.restockCrates.push(crate);
  }

  /**
   * Prices and checks a supply order against the player's money and free pad spots.
   * @param {Map<string, number>} order - item id -> number of crates
   */
  orderSummary(order) {
    return summarizeSupplyOrder(order, {
      getCrateCost: (itemId) => this.crateCost(database.getItem(itemId)),
      credits: this.shop.gameState.economy.credits,
      freePadSpots: this.freePadSpots().length,
    });
  }

  // Supply tab rows: every catalog item the player holds a Supplier License for, whether or
  // not it's stocked anywhere yet (a new fixture starts empty). Affordability is checked
  // per order, so unaffordable items still appear.
  restockableItems() {
    const shop = this.shop;
    const ownedQuantityByItemId = new Map(
      shop.getInventoryItems().map(({ item, stock, offShelves }) => [
        item.id,
        stock + offShelves,
      ]),
    );
    // Items with a shelf spot (even a sold-out one): how many are out and how many fit.
    const shelfByItemId = new Map();
    for (const shelf of shop.fixtures.shelves()) {
      for (const placement of shelf.placements) {
        const totals = shelfByItemId.get(placement.itemId) || { quantity: 0, capacity: 0 };
        totals.quantity += placement.quantity;
        totals.capacity += shelf.getPlacementCapacity(placement);
        shelfByItemId.set(placement.itemId, totals);
      }
    }

    return database
      .getAllItems()
      .filter((item) => shop.gameState.catalog.owns(item.license))
      .map((item) => ({
        item,
        ownedQuantity: ownedQuantityByItemId.get(item.id) || 0,
        shelf: shelfByItemId.get(item.id) || null,
        cost: this.crateCost(item),
      }));
  }

  /**
   * Places a whole supply order: charges the stock plus one flat delivery fee, then drops
   * every crate onto the Loading Pad at once. Each crate is hauled to a fixture by hand.
   * @param {Map<string, number>} order - item id -> number of crates
   * @returns {boolean} false if unlicensed, unaffordable, or the pad lacks room
   */
  placeOrder(order) {
    const { gameState } = this.shop;
    for (const [itemId, count] of order) {
      const item = database.getItem(itemId);
      if (count > 0 && (!item || !gameState.catalog.owns(item.license))) return false;
    }
    const summary = this.orderSummary(order);
    if (!summary.canPlace) return false;

    const spots = this.takePadSpots(
      [...order.values()].reduce((sum, count) => sum + Math.max(0, count), 0),
    );
    const deliveryId = `delivery-${gameState.calendar.day}-${nextSupplyDeliveryId++}`;
    for (const [itemId, count] of order) {
      if (count <= 0) continue;
      const item = database.getItem(itemId);
      gameState.economy.spend(this.crateCost(item) * count, {
        category: "stock_orders",
        label: item.name,
        quantity: count,
      });
    }
    gameState.economy.spend(summary.deliveryFee, {
      category: "delivery_fees",
      label: "Delivery fee",
    });
    for (const [itemId, count] of order) {
      // A first-time item starts at today's market price, then stays put until repriced.
      if (count > 0) gameState.catalog.priceIfUnset(itemId, gameState.market.getPrice(itemId));
      for (let index = 0; index < count; index += 1) {
        const spawn = spots.shift();
        const quantity = getCrateOrderQuantity(database.getItem(itemId));
        const crate = this.shop.createItemCrate(itemId, 0, spawn.x, spawn.y);
        const result = sourceItems(crate, itemId, quantity, {
          sourceId: deliveryId,
          sourceLocation: { kind: "supply-delivery", deliveryId, day: gameState.calendar.day },
          eventBus: this.shop.eventBus,
          sourceName: "supply",
          destinationName: "crate",
        });
        if (result.moved !== quantity) {
          throw new Error(`Supply delivery could not fill its ${itemId} crate: ${result.reason}.`);
        }
        this.deliver(crate);
      }
    }
    this.freePlayerFromPad();
    gameState.shop.changed();
    return true;
  }
}
