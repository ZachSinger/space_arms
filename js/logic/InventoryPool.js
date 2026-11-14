// ==========================================
// FILE: InventoryPool.js
// ==========================================
// Capacity-pool stock model: a total capacity measured by an item's configured size plus a
// flat list of stock. See ShopInventory.js (lockers) and PlayerState.js (go-backs).
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

export class InventoryPool {
  constructor({ capacity, stock, capacityUnit = "slots", singleItem = false } = {}) {
    this.capacity = capacity;
    this.stock = stock || []; // [{ itemId, quantity }]
    this.capacityUnit = capacityUnit;
    this.singleItem = singleItem;
  }

  findStockEntry(itemId) {
    return this.stock.find((entry) => entry.itemId === itemId) || null;
  }

  getAvailableUnitsFor(itemId) {
    return this.findStockEntry(itemId)?.quantity ?? 0;
  }

  usedCapacity() {
    return this.stock.reduce((sum, entry) => {
      const item = database.getItem(entry.itemId);
      return sum + entry.quantity * (item?.[this.capacityUnit] || 1);
    }, 0);
  }

  getRemainingCapacity() {
    return this.capacity - this.usedCapacity();
  }

  getRemainingUnitsFor(itemId) {
    const item = database.getItem(itemId);
    const itemSize = item?.[this.capacityUnit];
    if (!itemSize || !Number.isFinite(itemSize)) return 0;
    const stocked = this.stock.find((entry) => entry.quantity > 0);
    if (this.singleItem && stocked && stocked.itemId !== itemId) return 0;
    return Math.floor(this.getRemainingCapacity() / itemSize);
  }

  // First stock entry with quantity left, or null if the pool is empty.
  findAvailableSlot() {
    return this.stock.find((entry) => entry.quantity > 0) || null;
  }

  // Every stock entry with quantity left (used to pick varied items for a cart).
  getAvailableSlots() {
    return this.stock.filter((entry) => entry.quantity > 0);
  }

  /**
   * @param {{itemId: string, quantity: number}} entry
   * @returns {string | null} the itemId taken, or null if the entry is empty
   */
  takeItem(entry) {
    if (!entry || entry.quantity <= 0) return null;
    entry.quantity -= 1;
    if (this.singleItem && entry.quantity === 0) {
      this.stock = this.stock.filter((candidate) => candidate !== entry);
    }
    return entry.itemId;
  }

  /**
   * Add up to `quantity` units, capped by remaining capacity. Creates the stock entry if needed.
   * @param {string} itemId
   * @param {number} quantity
   * @returns {number} units actually accepted
   */
  add(itemId, quantity) {
    if (this.singleItem) {
      this.stock = this.stock.filter((entry) => entry.quantity > 0);
    }
    const accepted = Math.min(this.getRemainingUnitsFor(itemId), quantity);
    if (accepted <= 0) return 0;

    let entry = this.findStockEntry(itemId);
    if (!entry) {
      entry = { itemId, quantity: 0 };
      this.stock.push(entry);
    }
    entry.quantity += accepted;
    return accepted;
  }

  /**
   * @param {string} itemId
   * @param {number} quantity
   * @returns {number} units actually removed (capped by what's stocked)
   */
  remove(itemId, quantity) {
    const entry = this.findStockEntry(itemId);
    if (!entry) return 0;

    const removed = Math.min(entry.quantity, quantity);
    entry.quantity -= removed;
    if (this.singleItem && entry.quantity === 0) {
      this.stock = this.stock.filter((candidate) => candidate !== entry);
    }
    return removed;
  }
}
