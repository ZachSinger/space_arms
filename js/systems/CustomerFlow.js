// Who comes into the shop and when: the shift's customer pool, the arrival timetable, the
// temporary "closed" sign, and letting each customer in at the door.
// See also: CustomerPooling.js (pool math), Customer.js (what a shopper does once inside).
import { GAME_EVENTS } from "../core/Events.js";
import { loadTuning } from "../core/Tuning.js";
import customerTuning from "../../data/tuning/customers.json" with { type: "json" };
import { database } from "../scenes/boot.js";
import { Customer } from "../logic/Customer.js";
import {
  addDiscountBonusItem, BARGAIN_PRICE_RATIO, createCustomerBuyList, createCustomerItemQuantities,
} from "../logic/CustomerBuyLists.js";
import { addTraitBonusItems } from "../logic/CustomerTraits.js";
import {
  createCustomerArrivalSchedule, growCustomerArrivalSchedule, createCustomerPool,
} from "../logic/CustomerPooling.js";
import { SHIFT_DURATION_MS } from "../logic/ShiftClock.js";

export const CUSTOMER_TUNING = loadTuning("customers", customerTuning);

export class CustomerFlow {
  /** @param {object} shop - the game scene; its `customers` list holds everyone inside */
  constructor(shop) {
    this.shop = shop;
    this.schedule = [];
    this.nextArrival = 0;
    this.pool = null;
    this.poolAtShiftStart = null;
    this.poolRefreshCooldownMs = 0;
    this.temporarilyClosed = false;
    this.temporarilyClosedSinceMs = null;
  }

  // Fixes the shift's customer pool and arrival times from the store as it stands now.
  prepareSchedule() {
    this.pool = this.calculatePool();
    this.poolAtShiftStart = this.pool;
    this.schedule = createCustomerArrivalSchedule(this.pool.customerFactionIds, SHIFT_DURATION_MS);
    this.nextArrival = 0;
    this.poolRefreshCooldownMs = 0;
  }

  // A new shift (or the end of one) always takes the temporary closed sign down.
  clearTemporaryClosure() {
    this.temporarilyClosed = false;
    this.temporarilyClosedSinceMs = null;
  }

  calculatePool() {
    const { shop } = this;
    const shelfPlacements = shop.fixtures.shelves().flatMap((shelf) =>
      shelf.placements.map((placement) => ({ ...placement })),
    );
    return createCustomerPool({
      storeReputation: shop.gameState.reputation.global,
      factionReputation: shop.gameState.reputation.factions,
      activeFactions: shop.gameState.catalog.activeFactions,
      shelfPlacements,
      getItem: (itemId) => database.getItem(itemId),
      employeeCount: shop.gameState.staff.working().length,
      tieBreakOffset: shop.gameState.calendar.day,
    });
  }

  /**
   * Now and then, adds late arrivals if restocking mid-shift grew the pool.
   * The pool never shrinks mid-shift.
   * @param {number} delta - ms since last frame
   */
  refreshPool(delta) {
    const { shiftClock, debugInfo } = this.shop;
    if (!shiftClock.started || shiftClock.softClosed || this.temporarilyClosed || !this.pool) return;
    this.poolRefreshCooldownMs -= delta;
    if (this.poolRefreshCooldownMs > 0) return;
    this.poolRefreshCooldownMs = CUSTOMER_TUNING.poolRefreshIntervalMs;

    const result = growCustomerArrivalSchedule({
      schedule: this.schedule,
      currentPool: this.pool,
      nextPool: this.calculatePool(),
      elapsedMs: shiftClock.getElapsedMs(),
      shiftDurationMs: SHIFT_DURATION_MS,
    });
    if (result.addedFactionIds.length === 0) return;
    this.pool = result.pool;
    this.schedule = result.schedule;
    debugInfo?.record("customer-pool-grew", {
      added: result.addedFactionIds.length,
      totalCustomers: result.pool.totalCustomers,
      shelfStockUnits: result.pool.calculation.shelfStockUnits,
    });
  }

  spawnScheduled() {
    const { shiftClock } = this.shop;
    if (!shiftClock.started || shiftClock.softClosed || this.temporarilyClosed || !this.schedule) return;

    const elapsedMs = shiftClock.getElapsedMs();
    while (this.nextArrival < this.schedule.length && this.schedule[this.nextArrival].atMs <= elapsedMs) {
      const { factionId } = this.schedule[this.nextArrival];
      this.nextArrival += 1;
      this.spawn(factionId);
    }
  }

  hasRoom() {
    return this.shop.customers.length < CUSTOMER_TUNING.maxCustomersInStore;
  }

  /**
   * Lets one customer in unless arrivals are closed or the store is full.
   * @param {string | null} factionId
   */
  spawn(factionId = null) {
    const shop = this.shop;
    if (this.temporarilyClosed || shop.shiftClock.softClosed) return;
    if (!this.hasRoom()) {
      shop.gameState.reputation.turnAwayCustomer();
      shop.debugInfo?.record("customer-turned-away", { factionId, reason: "store-at-capacity" });
      return;
    }

    const customer = new Customer({
      store: shop.customerStore,
      factionId,
      getShoppingPlan: (factionId, traits) => this.shoppingPlan(factionId, traits),
      getStoreConditions: () => this.traitConditions(),
      registerPoint: shop.fixtures.register()?.queuePoints?.[0],
      exitPoint: shop.exitPoint,
      onReserveShelfSlot: (shelf, arrivingCustomer) =>
        shop.checkoutSystem.reserveShelfSlot(shelf, arrivingCustomer),
      onReserveQueueSlot: (queueingCustomer) => shop.checkoutSystem.reserveQueueSlot(queueingCustomer),
      onReserveExitSlot: () => shop.checkoutSystem.reserveExitSlot(),
      gameState: shop.gameState,
      spawnBounds: shop.customerSpawnBounds,
      onJoinQueue: (arrivingCustomer) => shop.checkoutSystem.handleJoinQueue(arrivingCustomer),
      onLeaveAngry: (angryCustomer, cart) => {
        shop.eventBus.emit(GAME_EVENTS.CUSTOMER_LEFT_ANGRY, { customer: angryCustomer, cart });
      },
      onMissingPrimary: (customer, itemIds, itemNames) => {
        shop.eventBus.emit(GAME_EVENTS.CUSTOMER_MISSING_PRIMARY, { customer, itemIds, itemNames });
      },
      onComplete: (completedCustomer) => {
        shop.debugInfo?.recordCustomer("customer-exited", completedCustomer);
        shop.customers = shop.customers.filter((candidate) => candidate !== completedCustomer);
      },
    });
    shop.customerGroup.add(customer.sprite);
    shop.customers.push(customer);
    shop.storeDoorAnimation.letIn(customer.sprite);
    shop.debugInfo?.recordCustomer("customer-entered", customer);
  }

  toggleTemporaryClosure() {
    const { shiftClock, hud } = this.shop;
    if (!shiftClock.started || shiftClock.softClosed || shiftClock.isPaused) return false;

    if (this.temporarilyClosed) {
      const closedDuration = Math.max(0, shiftClock.getElapsedMs() - this.temporarilyClosedSinceMs);
      this.schedule = this.schedule.map((arrival, index) =>
        index < this.nextArrival ? arrival : { ...arrival, atMs: arrival.atMs + closedDuration });
      this.clearTemporaryClosure();
      hud.renderStoreStatus(false);
      this.shop.showGameMessage("Store reopened. Customer arrivals have resumed.", "#38bdf8");
    } else {
      this.temporarilyClosed = true;
      this.temporarilyClosedSinceMs = shiftClock.getElapsedMs();
      hud.renderStoreStatus(true);
      this.shop.showGameMessage(
        "Store temporarily closed. Customers inside can finish shopping; new arrivals are paused.",
        "#f59e0b",
      );
    }
    return true;
  }

  // What trait appearance conditions (CustomerTraits.js) can check about the store.
  traitConditions() {
    const shelves = this.shop.fixtures.shelves();
    const itemIds = new Set(shelves.flatMap((shelf) => shelf.placements.map((placement) => placement.itemId)));
    return { shelfCount: shelves.length, itemVariety: itemIds.size };
  }

  /**
   * A buy list from what's on the shelves, plus the shelves worth visiting for it.
   * @param {string | null} factionId
   * @param {string[]} [traits]
   */
  shoppingPlan(factionId, traits = []) {
    const shop = this.shop;
    const shelves = shop.fixtures.shelves();
    const shelfItemIds = shelves.flatMap((shelf) => shelf.placements.map((placement) => placement.itemId));
    const buyList = createCustomerBuyList(factionId, shelfItemIds, (itemId) => database.getItem(itemId));
    buyList.bonusItemIds = addDiscountBonusItem(
      buyList,
      shelfItemIds,
      (itemId) => shop.getStorePrice(itemId) <= shop.gameState.market.getPrice(itemId) * BARGAIN_PRICE_RATIO,
    );
    buyList.bonusItemIds = addTraitBonusItems(buyList, shelfItemIds, traits);
    const targetIds = new Set([
      ...buyList.primaryItemIds,
      ...buyList.bonusItemIds,
      ...Object.values(buyList.matchingAmmoIdsByFirearm).flat(),
    ]);
    const shelfStops = shelves.map((fixture) => ({ fixture, standPoint: fixture.standPoint })).filter(({ fixture }) =>
      fixture.placements.some((placement) => targetIds.has(placement.itemId)),
    );
    const allShelfStops = shelves.filter((fixture) => fixture.findAvailableSlot())
      .map((fixture) => ({ fixture, standPoint: fixture.standPoint }));
    return {
      ...buyList,
      itemQuantities: createCustomerItemQuantities([...targetIds]),
      shelfStops,
      allShelfStops,
    };
  }
}
