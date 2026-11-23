// ==========================================
// FILE: GameState.js
// ==========================================
// Everything the game saves, split into slices. Each slice owns its data and announces its own
// changes; actions that touch several slices at once (hiring costs money and adds staff) live here.
//
// Loading is staged: `GameState.fromSave` builds a complete new state off to the side (throwing
// if anything is wrong), and only then does `replaceWith` swap it in, so a bad save never leaves
// the game half loaded.
import { Economy } from "./slices/Economy.js";
import { Reputation } from "./slices/Reputation.js";
import { Catalog } from "./slices/Catalog.js";
import { Staff } from "./slices/Staff.js";
import { Calendar } from "./slices/Calendar.js";
import { GoBacks } from "./slices/GoBacks.js";
import { Shop } from "./slices/Shop.js";
import { Crates } from "./slices/Crates.js";
import { Trash } from "./slices/Trash.js";
import { DroneDeliveries } from "./slices/DroneDeliveries.js";
import { Market } from "../logic/Market.js";
import { getStaffLimit } from "../logic/ShopProgression.js";
import { gameRandom } from "../core/Random.js";
import { DecisionRules } from "./DecisionRules.js";

const SLICE_NAMES = Object.freeze([
  "economy", "reputation", "catalog", "staff", "calendar", "market", "goBacks", "shop", "crates", "trash",
  "droneDeliveries",
]);

export class GameState {
  /**
   * A new game, or with `saved` a game restored from an upgraded, checked save.
   * @param {{ items: object[], random?: () => number, events?: object | null,
   *   saved?: { playerState: object, market: object, fixtures?: object[], unlockedZones?: string[] } | null }} options
   */
  constructor({ items, random = gameRandom, events = null, saved = null }) {
    this.items = items;
    this.random = random;
    this.events = events;
    this.rules = new DecisionRules();
    const player = saved?.playerState;
    const market = saved?.market;
    this.economy = saved ? Economy.fromSave(player, { day: market.day }) : new Economy();
    this.reputation = saved
      ? Reputation.fromSave(player, this.rules)
      : new Reputation(this.rules);
    this.catalog = saved ? Catalog.fromSave(player) : new Catalog();
    this.staff = saved ? Staff.fromSave(player) : new Staff();
    this.calendar = saved ? Calendar.fromSave(player, market) : new Calendar();
    // A restored market keeps its saved prices and draws no new random numbers.
    this.market = new Market(items, random, market ?? null);
    this.goBacks = saved ? GoBacks.fromSave(player, events) : new GoBacks(events);
    this.shop = saved ? Shop.fromSave(saved) : Shop.newGame();
    this.crates = saved ? Crates.fromSave(saved) : new Crates();
    this.trash = saved ? Trash.fromSave(saved) : new Trash();
    this.droneDeliveries = saved ? DroneDeliveries.fromSave(player) : new DroneDeliveries();
    this.listeners = new Set();
    for (const name of SLICE_NAMES) this[name].attach(() => this.#notify());
  }

  #holding = false;
  #held = false;

  #notify() {
    if (this.#holding) {
      this.#held = true;
      return;
    }
    for (const listener of [...this.listeners]) listener(this);
  }

  /**
   * Called right away, then whenever any slice changes. Returns an unsubscribe function.
   * @param {(state: GameState) => void} callback
   * @param {{ immediate?: boolean }} [options]
   */
  subscribe(callback, { immediate = true } = {}) {
    this.listeners.add(callback);
    if (immediate) callback(this);
    return () => this.listeners.delete(callback);
  }

  /** @returns {import("./Slice.js").Slice[]} */
  slices() {
    return SLICE_NAMES.map((name) => this[name]);
  }

  /**
   * @param {string} employeeId
   * @returns {boolean} false if the shop is at its staff limit, they're already hired, or it's unaffordable
   */
  hireEmployee(employeeId) {
    if (typeof employeeId !== "string" || !employeeId) throw new TypeError("Hiring requires an employee id.");
    const employee = this.staff.profile(employeeId);
    if (this.staff.hired.length >= getStaffLimit(this.reputation.shopLevel) ||
      this.staff.isHired(employeeId) || !this.economy.canAfford(employee.hireCost)) return false;
    this.staff.add(employeeId);
    this.economy.spend(employee.hireCost, { category: "hiring", label: employee.name });
    // Register-first hires start on the first register nobody is assigned to.
    if (employee.jobPriorities[0] === "register") {
      const register = this.shop.fixtures.registers()
        .find(({ id }) => !this.staff.registerAssignments[id]);
      if (register) this.staff.assignRegister(employeeId, register.id);
    }
    return true;
  }

  trainEmployee(employeeId, jobId) {
    const offer = this.staff.trainingOffer(employeeId, jobId);
    if (!offer || !this.staff.isHired(employeeId) ||
      this.staff.training[employeeId] || !this.economy.canAfford(offer.cost)) return false;
    this.staff.bookTraining(employeeId, jobId);
    this.economy.spend(offer.cost, {
      category: "training",
      label: `${this.staff.profile(employeeId).name}: ${offer.label} Level ${offer.targetLevel}`,
    });
    return true;
  }

  /**
   * Records how the shift went and waits for the player to end the day.
   * @param {{ customersServed: number, customersTurnedAway: number, priceReactions?: { bargain: number, skipped: number, disgusted: number } }} results
   */
  finishShift(results) {
    const totals = this.reputation.totalsAfterShift();
    this.economy.recordShift(results);
    this.staff.finishTraining();
    this.reputation.applyShift(totals);
    this.calendar.finishShift();
  }

  /**
   * New market prices, the next day, and a fresh receipt.
   * @returns {object} the finished day's receipt
   */
  endDay() {
    this.market.advanceDay();
    this.catalog.syncPinnedMarketPrices(this.market);
    this.calendar.nextDay();
    return this.economy.closeDay(this.calendar.day, this.reputation.global);
  }

  /** @returns {{ playerState: object, market: object, fixtures: object[], unlockedZones: string[], layoutVersion: number }} the save sections this state owns */
  toSave() {
    const economy = this.economy.toSave();
    const reputation = this.reputation.toSave();
    const staff = this.staff.toSave();
    // A register that was sold or packed up takes its assignment with it.
    const placedRegisters = new Set(this.shop.fixtures.registers().map(({ id }) => id));
    staff.registerAssignments = Object.fromEntries(Object.entries(staff.registerAssignments)
      .filter(([registerId]) => placedRegisters.has(registerId)));
    const catalog = this.catalog.toSave();
    return {
      playerState: {
        credits: economy.credits,
        globalReputation: reputation.globalReputation,
        shopLevel: reputation.shopLevel,
        factionReputation: reputation.factionReputation,
        pendingReputation: reputation.pendingReputation,
        ...staff,
        ...catalog,
        customersTurnedAway: reputation.customersTurnedAway,
        ...this.goBacks.toSave(),
        dayLedger: economy.dayLedger,
        dayReceipts: economy.dayReceipts,
        awaitingEndDay: this.calendar.awaitingEndDay,
        emergencyLoan: economy.emergencyLoan,
        ...this.droneDeliveries.toSave(),
      },
      market: { day: this.calendar.day, ...this.market.serialize() },
      ...this.shop.toSave(),
      ...this.crates.toSave(),
      ...this.trash.toSave(),
    };
  }

  /**
   * Builds a complete state from an upgraded, checked save without touching the running game.
   * @param {{ playerState: object, market: object, fixtures?: object[], unlockedZones?: string[] }} saved
   * @param {{ items: object[], random?: () => number, events?: object | null }} options
   */
  static fromSave(saved, { items, random = gameRandom, events = null }) {
    return new GameState({ items, random, events, saved });
  }

  /**
   * Swaps in a state built by `fromSave`, keeping every subscription. `rebuildWorld` runs after
   * the swap and before anyone is told, so screens never draw a half-loaded game.
   * @param {GameState} next
   * @param {() => void} [rebuildWorld]
   */
  replaceWith(next, rebuildWorld = () => {}) {
    for (const name of SLICE_NAMES) {
      if (typeof this[name].adopt === "function") this[name].adopt(next[name]);
      else Object.assign(this[name], next[name]);
    }
    // Each slice tells its own subscribers; whole-game subscribers hear about it once.
    this.batch(() => {
      rebuildWorld();
      for (const name of SLICE_NAMES) this[name].changed();
    });
  }

  /**
   * Runs `fn`, telling whole-game subscribers once at the end instead of after every change.
   * @param {() => void} fn
   */
  batch(fn) {
    if (this.#holding) {
      fn();
      return;
    }
    this.#holding = true;
    try {
      fn();
    } finally {
      this.#holding = false;
    }
    if (this.#held) {
      this.#held = false;
      this.#notify();
    }
  }
}
