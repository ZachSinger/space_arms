import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

export class Fixture {
  constructor(data) {
    this.id = data.id;
    this.displayType = data.displayType;
    this.x = data.x;
    this.y = data.y;
    this.gridDimensions = data.gridDimensions; // physical footprint on the map -- unrelated to storage capacity
    // Total storage capacity, in abstract "slots" (e.g. 20 -- see each item's own
    // `slots` value in Items.json, 1-5 depending on physical size/bulk). Not a grid of
    // individually-assignable blocks -- just one shared pool. Any item can be stocked
    // here as long as there's enough remaining capacity for it; nothing needs to be
    // pre-assigned/configured first.
    this.capacity = data.capacity;
    this.stock = data.stock || []; // [{ itemId, quantity }]
  }

  findStockEntry(itemId) {
    return this.stock.find((entry) => entry.itemId === itemId) || null;
  }

  // Total capacity currently consumed across every stocked item (each unit costs that
  // item's own `slots` value, not a flat 1 -- a bulky suit of armor eats more of the pool
  // per unit than a box of ammo does).
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

  // Returns the first stock entry still holding stock, or null if the fixture is empty.
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

  // Adds up to `quantity` units of itemId, capped by however much of the shared capacity
  // pool is actually left (not a per-item cap -- whatever's already stocked here eats into
  // the exact same pool). Creates a new stock entry on the fly if this item has never been
  // stocked here before; nothing needs to be assigned/configured ahead of time. Returns how
  // many units it actually accepted, so the caller (GameScene.tryDeliverCarriedCrate) knows
  // whether the crate was fully emptied or still has leftover units that didn't fit.
  restock(itemId, quantity) {
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
}
