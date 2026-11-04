// ==========================================
// FILE: InventoryPool.js
// ==========================================
// Capacity-pool stock model: a total capacity in slots (each unit costs its item's `slots`
// value, not a flat 1) plus a flat list of stock. Any item fits while there's room.
// See also: ShopInventory.js (storage fixtures), PlayerState.js (hovercart, go-backs).
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

export class InventoryPool {
  constructor({ capacity, stock } = {}) {
    this.capacity = capacity;
    this.stock = stock || []; // [{ itemId, quantity }]
  }

  findStockEntry(itemId) {
    return this.stock.find((entry) => entry.itemId === itemId) || null;
  }

  usedCapacity() {
    return this.stock.reduce((sum, entry) => {
      const item = database.getItem(entry.itemId);
      return sum + entry.quantity * (item?.slots || 1);
    }, 0);
  }

  getRemainingCapacity() {
    return this.capacity - this.usedCapacity();
  }

  getRemainingUnitsFor(itemId) {
    const item = database.getItem(itemId);
    if (!item || !item.slots) return 0;
    return Math.floor(this.getRemainingCapacity() / item.slots);
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
    return entry.itemId;
  }

  /**
   * Add up to `quantity` units, capped by remaining capacity. Creates the stock entry if needed.
   * @param {string} itemId
   * @param {number} quantity
   * @returns {number} units actually accepted
   */
  add(itemId, quantity) {
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
    return removed;
  }
}
