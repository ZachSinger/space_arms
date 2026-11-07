// ==========================================
// FILE: PlayerState.js
// ==========================================
// The player's persistent economy: credits, reputation, licenses, store prices, the
// hovercart, and the Go-Backs bin. Notifies subscribers on every change.
import { InventoryPool } from "./InventoryPool.js";
import { transferItems } from "./InventoryTransfer.js";
import employeeRoster from "../../data/Employees.json" with { type: "json" };

// What one character can personally carry, in units; smaller than any fixture.
export const HOVERCART_CAPACITY = 10;

function defaultEmployeeJobPriorities(employeeId) {
  const employee = employeeRoster.find((candidate) => candidate.id === employeeId);
  if (!employee) throw new Error(`Unknown employee: ${employeeId}`);
  return [...employee.jobPriorities];
}

export class PlayerState {
  constructor(eventBus = null) {
    this.eventBus = eventBus;
    this.credits = 1500;
    this.globalReputation = 2;
    // Customers lost because the store was at capacity: lost sales, not delayed ones.
    this.customersTurnedAway = 0;

    // Factions strictly adhere to the MVP Tag Taxonomy. No Military.
    this.factionReputation = {
      scavengers: 0,
      mercenaries: 0,
      explorers: 0,
    };
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

    this.listeners = [];
  }

  addCredits(amount) {
    this.credits += amount;
    this.notifyListeners();
  }

  spendCredits(amount) {
    this.credits -= amount;
    this.notifyListeners();
    return true;
  }

  /**
   * Change global reputation, and the faction's too when one is given.
   * @param {number} amount
   * @param {string | null} [factionId]
   */
  addReputation(amount, factionId = null) {
    this.globalReputation += amount;

    if (factionId && this.factionReputation[factionId] !== undefined) {
      this.factionReputation[factionId] += amount;
    }

    this.notifyListeners();
  }

  subReputation(amount, factionId = null) {
    this.globalReputation -= amount;

    if (factionId && this.factionReputation[factionId] !== undefined) {
      this.factionReputation[factionId] -= amount;
    }

    this.notifyListeners();
  }

  setStorePrice(itemId, price) {
    this.storePrices[itemId] = price;
    this.notifyListeners();
  }

  hireEmployee(employeeId, hireCost) {
    if (typeof employeeId !== "string" || !employeeId ||
      !Number.isSafeInteger(hireCost) || hireCost < 0) {
      throw new TypeError("Hiring requires an employee id and a non-negative whole-credit cost.");
    }
    const jobPriorities = defaultEmployeeJobPriorities(employeeId);
    if (this.hiredEmployees.includes(employeeId) || this.credits < hireCost) return false;
    this.credits -= hireCost;
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
      factionReputation: { ...this.factionReputation },
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
   */
  applySave(data) {
    Object.assign(this, {
      credits: data.credits,
      globalReputation: data.globalReputation,
      factionReputation: { ...data.factionReputation },
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
        capacity: data.hovercart?.capacity ?? HOVERCART_CAPACITY,
        stock: (data.hovercart?.stock || []).map((entry) => ({ ...entry })),
      }),
      goBacks: new InventoryPool({
        capacity: Infinity,
        stock: (data.goBacks || []).map((entry) => ({ ...entry })),
      }),
    });
    this.notifyListeners();
  }
}
