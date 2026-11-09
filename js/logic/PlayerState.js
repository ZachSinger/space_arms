// ==========================================
// FILE: PlayerState.js
// ==========================================
// The player's persistent economy: credits, reputation, licenses, store prices, the
// hovercart, and the Go-Backs bin. Notifies subscribers on every change.
import { InventoryPool } from "./InventoryPool.js";
import { transferItems } from "./InventoryTransfer.js";
import { DayLedger } from "./DayLedger.js";
import { isMoney, sumMoney } from "./Money.js";
import { getShopLevelForReputation, isKnownShopLevel } from "./ShopProgression.js";
import { CUSTOMER_FACTION_IDS } from "./CustomerBuyLists.js";
import employeeRoster from "../../data/Employees.json" with { type: "json" };

// The starting capacity and upgrade rules for the player's hovercart.
import { getNextHovercartUpgrade, HOVERCART_CAPACITY } from "./Hovercart.js";

export { HOVERCART_CAPACITY };

function emptyFactionReputation() {
  return Object.fromEntries(CUSTOMER_FACTION_IDS.map((id) => [id, 0]));
}

function emptyReputationTally() {
  return { global: 0, factions: emptyFactionReputation() };
}

function defaultEmployeeJobPriorities(employeeId) {
  const employee = employeeRoster.find((candidate) => candidate.id === employeeId);
  if (!employee) throw new Error(`Unknown employee: ${employeeId}`);
  return [...employee.jobPriorities];
}

export class PlayerState {
  constructor(eventBus = null) {
    this.eventBus = eventBus;
    this.credits = 1500;
    this.globalReputation = 0;
    this.shopLevel = 1;
    this.pendingReputation = emptyReputationTally();
    // Customers lost because the store was at capacity: lost sales, not delayed ones.
    this.customersTurnedAway = 0;

    // Factions strictly adhere to the MVP Tag Taxonomy. No Military.
    this.factionReputation = emptyFactionReputation();
    this.activeFactions = new Set();

    // Starting license keeps the basic fixtures usable and purchasable.
    this.activeLicenses = new Set(["lic_fixture_basics"]);

    // The player's own retail price per item id (credits per unit).
    this.storePrices = {};

    // Same model as a StorageFixture, just not on the map; moves stock between fixtures.
    this.hovercart = new InventoryPool({ capacity: HOVERCART_CAPACITY, stock: [] });

    // Carts abandoned by angry customers (unlimited room); emptied only into the hovercart.
    this.goBacks = new InventoryPool({ capacity: Infinity, stock: [] });
    this.hiredEmployees = [];
    this.employeeJobPriorities = {};

    // Every credit earned or spent today is itemized here for the End Day receipt.
    this.dayLedger = new DayLedger({
      day: 1,
      openingCredits: this.credits,
      openingReputation: this.globalReputation,
    });
    this.lastDayReceipt = null;
    // True from the end of a shift until the player clicks End Day.
    this.awaitingEndDay = false;

    this.listeners = [];
  }

  /**
   * @param {number} amount - credits with up to two decimal places, at least 0
   * @param {{ category: string, label: string, quantity?: number }} entry - receipt line
   */
  addCredits(amount, entry) {
    if (!isMoney(amount) || amount < 0) {
      throw new TypeError(`Credits earned must be non-negative money with at most two decimal places, got ${amount}.`);
    }
    const balance = sumMoney([this.credits, amount]);
    this.dayLedger.record({ ...entry, amount });
    this.credits = balance;
    this.notifyListeners();
  }

  /**
   * @param {number} amount - credits with up to two decimal places, at least 0
   * @param {{ category: string, label: string, quantity?: number }} entry - receipt line
   */
  spendCredits(amount, entry) {
    if (!isMoney(amount) || amount < 0) {
      throw new TypeError(`Credits spent must be non-negative money with at most two decimal places, got ${amount}.`);
    }
    const balance = sumMoney([this.credits, -amount]);
    this.dayLedger.record({ ...entry, amount: -amount });
    this.credits = balance;
    this.notifyListeners();
    return true;
  }

  upgradeHovercart() {
    const upgrade = getNextHovercartUpgrade(this.hovercart.capacity);
    if (!upgrade || this.credits < upgrade.price) return false;
    this.hovercart.capacity = upgrade.capacity;
    this.spendCredits(upgrade.price, {
      category: "equipment",
      label: `Hovercart capacity: ${upgrade.capacity} spaces`,
    });
    return true;
  }

  /**
   * Records how the shift went and waits for the player to end the day.
   * @param {{ customersServed: number, customersTurnedAway: number }} results
   */
  finishShift(results) {
    const globalReputation = this.globalReputation + this.pendingReputation.global;
    const factionReputation = Object.fromEntries(
      Object.entries(this.factionReputation).map(([id, reputation]) => [
        id, reputation + (this.pendingReputation.factions[id] ?? 0),
      ]),
    );
    if (!Number.isSafeInteger(globalReputation) ||
      !Object.values(factionReputation).every(Number.isSafeInteger)) {
      throw new RangeError("Shift reputation exceeds the supported range.");
    }
    this.dayLedger.recordShift(results);
    this.globalReputation = globalReputation;
    this.factionReputation = factionReputation;
    this.pendingReputation = emptyReputationTally();
    this.shopLevel = Math.max(this.shopLevel, getShopLevelForReputation(globalReputation));
    this.awaitingEndDay = true;
    this.notifyListeners();
  }

  /**
   * Closes today's receipt and opens a fresh one for the next day.
   * @param {number} nextDay
   * @returns {object} the finished day's receipt
   */
  endDay(nextDay) {
    const receipt = this.dayLedger.close(this.credits, this.globalReputation);
    this.lastDayReceipt = receipt;
    this.dayLedger = new DayLedger({
      day: nextDay,
      openingCredits: this.credits,
      openingReputation: this.globalReputation,
    });
    this.awaitingEndDay = false;
    this.notifyListeners();
    return receipt;
  }

  /**
   * Tally store reputation, and the faction's too when one is given.
   * @param {number} amount
   * @param {string | null} [factionId]
   */
  addReputation(amount, factionId = null) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new TypeError(`Reputation gain must be a non-negative whole number, got ${amount}.`);
    }
    this.tallyReputation(amount, factionId);
  }

  subReputation(amount, factionId = null) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new TypeError(`Reputation loss must be a non-negative whole number, got ${amount}.`);
    }
    this.tallyReputation(-amount, factionId);
  }

  tallyReputation(change, factionId) {
    const global = this.pendingReputation.global + change;
    const faction = factionId && this.pendingReputation.factions[factionId] !== undefined
      ? this.pendingReputation.factions[factionId] + change
      : null;
    if (!Number.isSafeInteger(global) || (faction !== null && !Number.isSafeInteger(faction))) {
      throw new RangeError("Pending reputation exceeds the supported range.");
    }
    this.pendingReputation.global = global;
    if (faction !== null) this.pendingReputation.factions[factionId] = faction;
    this.notifyListeners();
  }

  setStorePrice(itemId, price) {
    if (!isMoney(price) || price < 1) throw new TypeError(`Invalid store price: ${price}.`);
    this.storePrices[itemId] = price;
    this.notifyListeners();
  }

  hireEmployee(employeeId, hireCost) {
    if (typeof employeeId !== "string" || !employeeId ||
      !Number.isSafeInteger(hireCost) || hireCost < 0) {
      throw new TypeError("Hiring requires an employee id and a non-negative whole-credit cost.");
    }
    const jobPriorities = defaultEmployeeJobPriorities(employeeId);
    const employee = employeeRoster.find((candidate) => candidate.id === employeeId);
    if (!isKnownShopLevel(employee.requiredShopLevel)) {
      throw new Error(`Unknown required Shop Level for ${employeeId}.`);
    }
    if (this.shopLevel < employee.requiredShopLevel ||
      this.hiredEmployees.includes(employeeId) || this.credits < hireCost) return false;
    this.dayLedger.record({
      category: "hiring",
      label: `${employee.name} (${employee.role})`,
      amount: -hireCost,
    });
    this.credits = sumMoney([this.credits, -hireCost]);
    this.hiredEmployees.push(employeeId);
    this.employeeJobPriorities[employeeId] = jobPriorities;
    this.notifyListeners();
    return true;
  }

  moveEmployeeJobPriority(employeeId, jobId, direction) {
    if (!this.hiredEmployees.includes(employeeId) ||
      !Number.isInteger(direction) || Math.abs(direction) !== 1) return false;
    const priorities = this.employeeJobPriorities[employeeId];
    if (!Array.isArray(priorities)) {
      throw new Error(`Employee ${employeeId} has no saved job priorities.`);
    }
    const index = priorities.indexOf(jobId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= priorities.length) return false;
    [priorities[index], priorities[targetIndex]] = [priorities[targetIndex], priorities[index]];
    this.notifyListeners();
    return true;
  }

  addToGoBacks(cart) {
    const stock = [];
    for (const { itemId } of cart) {
      const entry = stock.find((candidate) => candidate.itemId === itemId);
      if (entry) entry.quantity += 1;
      else stock.push({ itemId, quantity: 1 });
    }

    const customerCart = new InventoryPool({ capacity: Infinity, stock });
    for (const { itemId, quantity } of stock) {
      const result = transferItems(customerCart, this.goBacks, itemId, quantity, {
        eventBus: this.eventBus,
        sourceName: "customer-cart",
        destinationName: "go-backs",
      });
      if (result.moved !== quantity) {
        throw new Error(`Could not return ${itemId} to Go-Backs: ${result.reason}.`);
      }
    }
    this.notifyListeners();
  }

  /**
   * Move 1 unit from the Go-Backs bin into the hovercart.
   * @param {string} itemId
   * @returns {boolean} false if the hovercart has no room or the bin has none
   */
  loadGoBacksItem(itemId) {
    const result = transferItems(this.goBacks, this.hovercart, itemId, 1, {
      eventBus: this.eventBus,
      sourceName: "go-backs",
      destinationName: "hovercart",
    });
    if (result.moved !== 1) return false;
    this.goBacks.stock = this.goBacks.stock.filter((entry) => entry.quantity > 0);
    this.notifyListeners();
    return true;
  }

  signLicense(licenseId) {
    this.activeLicenses.add(licenseId);
    this.notifyListeners();
  }

  setActiveFactions(factionIds) {
    this.activeFactions = new Set(factionIds);
  }

  /**
   * Register a listener; it is called immediately and on every change.
   * @param {(state: PlayerState) => void} callback
   */
  subscribe(callback) {
    this.listeners.push(callback);
    callback(this);
  }

  notifyListeners() {
    this.listeners.forEach((callback) => callback(this));
  }

  serialize() {
    return {
      credits: this.credits,
      globalReputation: this.globalReputation,
      shopLevel: this.shopLevel,
      factionReputation: { ...this.factionReputation },
      pendingReputation: {
        global: this.pendingReputation.global,
        factions: { ...this.pendingReputation.factions },
      },
      hiredEmployees: [...this.hiredEmployees],
      employeeJobPriorities: Object.fromEntries(
        this.hiredEmployees.map((employeeId) => [
          employeeId,
          [...this.employeeJobPriorities[employeeId]],
        ]),
      ),
      activeLicenses: [...this.activeLicenses],
      storePrices: { ...this.storePrices },
      customersTurnedAway: this.customersTurnedAway,
      hovercart: {
        capacity: this.hovercart.capacity,
        stock: this.hovercart.stock.filter((entry) => entry.quantity > 0).map((entry) => ({ ...entry })),
      },
      goBacks: this.goBacks.stock.filter((entry) => entry.quantity > 0).map((entry) => ({ ...entry })),
      dayLedger: this.dayLedger.serialize(),
      lastDayReceipt: this.lastDayReceipt
        ? { ...this.lastDayReceipt, lines: this.lastDayReceipt.lines.map((line) => ({ ...line })) }
        : null,
      awaitingEndDay: this.awaitingEndDay,
    };
  }

  static deserialize(data) {
    const state = new PlayerState();
    state.applySave(data);
    return state;
  }

  /**
   * Overwrite this state from save data in place, keeping existing subscribers.
   * @param {object} data - output of serialize()
   * @param {{ day?: number }} [options] - the current day, for saves from before receipts
   */
  applySave(data, { day = 1 } = {}) {
    Object.assign(this, {
      credits: data.credits,
      globalReputation: data.globalReputation,
      shopLevel: Math.max(data.shopLevel ?? 1, getShopLevelForReputation(data.globalReputation)),
      factionReputation: { ...data.factionReputation },
      pendingReputation: data.pendingReputation
        ? { global: data.pendingReputation.global, factions: { ...data.pendingReputation.factions } }
        : emptyReputationTally(),
      hiredEmployees: [...(data.hiredEmployees || [])],
      employeeJobPriorities: Object.fromEntries(
        (data.hiredEmployees || []).map((employeeId) => [
          employeeId,
          [...(data.employeeJobPriorities?.[employeeId] ??
            defaultEmployeeJobPriorities(employeeId))],
        ]),
      ),
      customersTurnedAway: data.customersTurnedAway,
      activeFactions: new Set(),
      activeLicenses: new Set([...data.activeLicenses, "lic_fixture_basics"]),
      storePrices: { ...data.storePrices },
      hovercart: new InventoryPool({
        // Keep larger carts from existing saves, including their contents.
        capacity: Math.max(HOVERCART_CAPACITY, data.hovercart?.capacity ?? HOVERCART_CAPACITY),
        stock: (data.hovercart?.stock || []).map((entry) => ({ ...entry })),
      }),
      goBacks: new InventoryPool({
        capacity: Infinity,
        stock: (data.goBacks || []).map((entry) => ({ ...entry })),
      }),
      // Saves from before receipts start today's receipt from the loaded balance.
      dayLedger: data.dayLedger
        ? DayLedger.fromSave(data.dayLedger)
        : new DayLedger({
          day,
          openingCredits: data.credits,
          openingReputation: data.globalReputation,
        }),
      lastDayReceipt: data.lastDayReceipt
        ? { ...data.lastDayReceipt, lines: data.lastDayReceipt.lines.map((line) => ({ ...line })) }
        : null,
      awaitingEndDay: data.awaitingEndDay ?? false,
    });
    this.notifyListeners();
  }
}
