// ==========================================
// FILE: InventoryPool.js
// ==========================================
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

// Shared capacity-pool model: a flat total `capacity` (in abstract "slots" -- see each
// item's own `slots` value in Items.json, 1-5 depending on physical size/bulk), and a flat
// list of whatever's currently stocked. Any item can be added as long as there's room;
// nothing needs to be pre-assigned/configured first.
//
// Used by both physical StorageFixtures (ShopInventory.js, drawn on the map) and the player's
// Hovercart (PlayerState.js) -- conceptually the exact same pool, just one is a place on
// the map and one is "whatever the character is currently carrying" (bible: "an abstract
// character/employee inventory size, not a physical moving entity").
export class InventoryPool {
  constructor({ capacity, stock } = {}) {
    this.capacity = capacity;
    this.stock = stock || []; // [{ itemId, quantity }]
  }

  findStockEntry(itemId) {
    return this.stock.find((entry) => entry.itemId === itemId) || null;
  }

  // Total capacity currently consumed across every stocked item (each unit costs that
  // item's own `slots` value, not a flat 1).
  usedCapacity() {
    return this.stock.reduce((sum, entry) => {
      const item = database.getItem(entry.itemId);
      return sum + entry.quantity * (item?.slots || 1);
    }, 0);
  }

  getRemainingCapacity() {
    return this.capacity - this.usedCapacity();
  }

  // How many more whole units of this item could still fit in whatever capacity remains.
  getRemainingUnitsFor(itemId) {
    const item = database.getItem(itemId);
    if (!item || !item.slots) return 0;
    return Math.floor(this.getRemainingCapacity() / item.slots);
  }

  // Returns the first stock entry still holding stock, or null if the pool is empty.
  findAvailableSlot() {
    return this.stock.find((entry) => entry.quantity > 0) || null;
  }

  // Returns every stock entry still holding stock (used to pick varied items for a cart).
  getAvailableSlots() {
    return this.stock.filter((entry) => entry.quantity > 0);
  }

  // Decrements a stock entry's quantity by one and returns the itemId taken, or null if
  // it's already empty.
  takeItem(entry) {
    if (!entry || entry.quantity <= 0) return null;
    entry.quantity -= 1;
    return entry.itemId;
  }

  // Adds up to `quantity` units of itemId, capped by however much capacity is actually
  // left. Creates a new stock entry on the fly if this item has never been stocked here
  // before. Returns how many units it actually accepted.
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

  // Removes up to `quantity` units of itemId (capped by however much is actually there).
  // Returns how many units it actually removed.
  remove(itemId, quantity) {
    const entry = this.findStockEntry(itemId);
    if (!entry) return 0;

    const removed = Math.min(entry.quantity, quantity);
    entry.quantity -= removed;
    return removed;
  }
}
