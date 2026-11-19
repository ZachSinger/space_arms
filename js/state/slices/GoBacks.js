// ==========================================
// FILE: GoBacks.js
// ==========================================
// The Go-Backs bin: items customers abandoned or that didn't fit anywhere, waiting to be packed
// into crates. It has unlimited room.
import { Slice } from "../Slice.js";
import { InventoryPool } from "../../logic/InventoryPool.js";
import { transferItems } from "../../logic/InventoryTransfer.js";

export class GoBacks extends Slice {
  /** @param {object | null} [events] - announces each transfer */
  constructor(events = null) {
    super();
    this.events = events;
    this.pool = new InventoryPool({ id: "go-backs", capacity: Infinity, stock: [] });
  }

  /** @returns {{ itemId: string, quantity: number }[]} */
  get stock() {
    return this.pool.stock;
  }

  /** @param {string} itemId */
  available(itemId) {
    return this.pool.getAvailableUnitsFor(itemId);
  }

  total() {
    return this.pool.stock.reduce((sum, entry) => sum + entry.quantity, 0);
  }

  /**
   * @param {string} itemId
   * @param {number} quantity
   */
  add(itemId, quantity) {
    this.pool.add(itemId, quantity);
    this.changed();
  }

  /**
   * @param {string} itemId
   * @param {number} quantity
   */
  remove(itemId, quantity) {
    this.pool.remove(itemId, quantity);
    this.changed();
  }

  /** @param {{ itemId: string }[]} cart - one entry per unit, as a customer carries them */
  addCart(cart) {
    const stock = [];
    for (const { itemId } of cart) {
      const entry = stock.find((candidate) => candidate.itemId === itemId);
      if (entry) entry.quantity += 1;
      else stock.push({ itemId, quantity: 1 });
    }
    const customerCart = new InventoryPool({ capacity: Infinity, stock });
    for (const { itemId, quantity } of stock) {
      const result = transferItems(customerCart, this.pool, itemId, quantity, {
        eventBus: this.events, sourceName: "customer-cart", destinationName: "go-backs",
      });
      if (result.moved !== quantity) throw new Error(`Could not return ${itemId} to Go-Backs: ${result.reason}.`);
    }
    this.changed();
  }

  /**
   * Moves items in from somewhere else, such as an overfull shelf slot.
   * @param {object} source - an inventory container
   * @param {string} itemId
   * @param {number} quantity
   * @param {object} [options] - passed on to transferItems
   * @returns {number} how many moved
   */
  takeFrom(source, itemId, quantity, options = {}) {
    const result = transferItems(source, this.pool, itemId, quantity, {
      eventBus: this.events, destinationName: "go-backs", ...options,
    });
    if (result.moved) this.changed();
    return result.moved;
  }

  /**
   * Moves as many of one item as fit into a crate.
   * @param {string} itemId
   * @param {object} crate - an item crate
   * @returns {number} how many moved
   */
  packInto(itemId, crate) {
    const available = this.pool.getAvailableUnitsFor(itemId);
    if (available <= 0) return 0;
    const result = transferItems(this.pool, crate, itemId, available, {
      eventBus: this.events, sourceName: "go-backs", destinationName: "crate",
    });
    this.pool.stock = this.pool.stock.filter((entry) => entry.quantity > 0);
    if (result.moved) this.changed();
    return result.moved;
  }

  toSave() {
    return { goBacks: this.pool.stock.filter((entry) => entry.quantity > 0).map((entry) => ({ ...entry })) };
  }

  /**
   * @param {object} data - the saved player section
   * @param {object | null} events
   */
  static fromSave(data, events) {
    const goBacks = new GoBacks(events);
    goBacks.pool = new InventoryPool({
      id: "go-backs",
      capacity: Infinity,
      stock: (data.goBacks || []).map((entry) => ({ ...entry })),
    });
    return goBacks;
  }
}
