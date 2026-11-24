// ==========================================
// FILE: ShelfFixture.js
// ==========================================
// A sales shelf with per-placement quantities shared by stocking, customers, and saves.
// Each space holds one item kind, up to 20 box-size units.
// See also: InventoryPool.js (the stock API this class mirrors).
import { database } from "../scenes/boot.js";
import { getShelfSlotCapacity } from "./FixtureLayout.js";

// Every item fills exactly one shelf space.
const FOOTPRINT = Object.freeze({ w: 1, h: 1 });

let nextGeneratedFixtureId = 1;

export class ShelfFixture {
  constructor(data) {
    this.id = data.id ?? `shelf-${nextGeneratedFixtureId++}`;
    this.displayType = data.displayType;
    this.x = data.x;
    this.y = data.y;
    this.gridDimensions = data.gridDimensions; // map footprint in tiles, not the item grid
    this.displayGrid = data.displayGrid;
    this.handsOn = data.handsOn === true;
    this.nextPlacementId = data.nextPlacementId ?? 1;
    if (!Number.isSafeInteger(this.nextPlacementId) || this.nextPlacementId < 1) {
      throw new RangeError("Shelf placement ID counter must be a positive safe integer.");
    }
    // Each placement is a stable stock slot; gx/gy = top-left cell.
    const placementIds = new Set();
    this.placements = (data.placements || []).map((placement) => {
      const slot = { ...placement };
      if (slot.id === undefined) slot.id = this.createPlacementId();
      if (typeof slot.id !== "string" || slot.id.length === 0 || placementIds.has(slot.id)) {
        throw new TypeError("Shelf placements require unique, non-empty IDs.");
      }
      placementIds.add(slot.id);
      this.advancePlacementId(slot.id);
      return slot;
    });
  }

  createPlacementId() {
    const id = `shelf-slot:${this.id}:${this.nextPlacementId}`;
    this.nextPlacementId += 1;
    return id;
  }

  advancePlacementId(id) {
    const prefix = `shelf-slot:${this.id}:`;
    if (!id.startsWith(prefix)) return;
    const sequence = Number(id.slice(prefix.length));
    if (Number.isSafeInteger(sequence) && sequence >= this.nextPlacementId) {
      this.nextPlacementId = sequence + 1;
    }
  }

  // Same shape as InventoryPool.stock for shared inventory displays.
  get stock() {
    return this.placements;
  }

  findStockEntry(itemId) {
    return this.placements.find((p) => p.itemId === itemId) || null;
  }

  getLocation(placement = null) {
    if (placement && !this.placements.includes(placement)) return null;
    return placement
      ? { kind: "shelf-slot", shelfId: this.id, slotId: placement.id }
      : { kind: "shelf", shelfId: this.id };
  }

  getContainerId(placement = null) {
    if (placement && !this.placements.includes(placement)) return null;
    return placement?.id ?? this.id;
  }

  canTake(_itemId, _context, placement = null) {
    return placement === null || this.placements.includes(placement);
  }

  canPut(_itemId, _context, placement = null) {
    return placement === null || this.placements.includes(placement);
  }

  getPlacementCapacity(placement) {
    return getShelfSlotCapacity(database.getItem(placement.itemId));
  }

  occupiedCellsFor(placement) {
    const cells = [];
    for (let dy = 0; dy < placement.h; dy += 1) {
      for (let dx = 0; dx < placement.w; dx += 1) {
        cells.push(`${placement.gx + dx},${placement.gy + dy}`);
      }
    }
    return cells;
  }

  allOccupiedCells() {
    const cells = new Set();
    for (const placement of this.placements) {
      for (const key of this.occupiedCellsFor(placement)) cells.add(key);
    }
    return cells;
  }

  canPlaceAt(gx, gy, w, h) {
    if (gx < 0 || gy < 0 || gx + w > this.displayGrid.w || gy + h > this.displayGrid.h) {
      return false;
    }
    const occupied = this.allOccupiedCells();
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        if (occupied.has(`${gx + dx},${gy + dy}`)) return false;
      }
    }
    return true;
  }

  /**
   * Place a new stack already holding 1 unit the caller took from somewhere (e.g. a
   * carried crate). Returns null if it doesn't fit or can't hold even 1 unit.
   * @param {string} itemId
   * @param {number} gx
   * @param {number} gy
   * @param {boolean} rotated
   */
  placeItem(itemId, gx, gy, rotated = false, quantity = 1) {
    const item = database.getItem(itemId);
    if (!item) return null;
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new RangeError("Shelf placement quantity must be a non-negative integer.");
    }

    const { w, h } = FOOTPRINT;
    if (!this.canPlaceAt(gx, gy, w, h)) return null;

    const placement = { id: this.createPlacementId(), itemId, gx, gy, w, h, rotated, quantity };
    if (this.getPlacementCapacity(placement) < Math.max(quantity, 1)) return null;
    this.placements.push(placement);
    return placement;
  }

  /**
   * Lift a placement off the grid while it's moved; customers and deliveries can't reach it.
   * @param {object} placement
   */
  detachPlacement(placement) {
    this.placements = this.placements.filter((p) => p !== placement);
  }

  /**
   * Put a detached placement back; leaves it detached if it doesn't fit.
   * @param {object} placement
   * @param {number} gx
   * @param {number} gy
   * @param {boolean} rotated
   */
  attachPlacement(placement, gx, gy, rotated) {
    const { w, h } = FOOTPRINT;
    if (!this.canPlaceAt(gx, gy, w, h)) return false;

    Object.assign(placement, { gx, gy, w, h, rotated });
    this.placements.push(placement);
    return true;
  }

  /**
   * Sold-out slots keep their spot and item until the player removes them here.
   * @param {object} placement - must be empty
   */
  removeEmptyPlacement(placement) {
    if (!placement || placement.quantity > 0 || !this.placements.includes(placement)) return false;
    this.placements = this.placements.filter((p) => p !== placement);
    return true;
  }

  findAvailableSlot() {
    return this.placements.find((p) => p.quantity > 0) || null;
  }

  getAvailableSlots() {
    return this.placements.filter((p) => p.quantity > 0);
  }

  takeItem(placement) {
    if (!placement || placement.quantity <= 0) return null;
    placement.quantity -= 1;
    return placement.itemId;
  }

  getOpenPlacementsFor(itemId) {
    return this.placements.filter(
      (p) => p.itemId === itemId && p.quantity < this.getPlacementCapacity(p),
    );
  }

  getAvailableUnitsFor(itemId, placement = null) {
    if (placement) {
      return this.placements.includes(placement) && placement.itemId === itemId
        ? placement.quantity
        : 0;
    }
    return this.placements
      .filter((entry) => entry.itemId === itemId)
      .reduce((sum, entry) => sum + entry.quantity, 0);
  }

  getRemainingUnitsFor(itemId, placement = null) {
    if (placement) {
      if (!this.placements.includes(placement) || placement.itemId !== itemId) return 0;
      return Math.max(0, this.getPlacementCapacity(placement) - placement.quantity);
    }
    return this.getOpenPlacementsFor(itemId).reduce(
      (sum, p) => sum + (this.getPlacementCapacity(p) - p.quantity),
      0,
    );
  }

  /**
   * Fill existing placements of this item; returns units accepted. Unlike off-shelf inventory,
   * a new item can't be added here: it must be placed on the grid first.
   * @param {string} itemId
   * @param {number} quantity
   */
  add(itemId, quantity, placement = null) {
    if (!this.canPut(itemId, null, placement)) return 0;
    if (placement) {
      const accepted = Math.min(this.getRemainingUnitsFor(itemId, placement), quantity);
      placement.quantity += accepted;
      return accepted;
    }
    let remaining = quantity;
    for (const placement of this.getOpenPlacementsFor(itemId)) {
      if (remaining <= 0) break;
      const room = this.getPlacementCapacity(placement) - placement.quantity;
      const added = Math.min(room, remaining);
      placement.quantity += added;
      remaining -= added;
    }
    return quantity - remaining;
  }

  restock(itemId, quantity) {
    return this.add(itemId, quantity);
  }

  remove(itemId, quantity, placement = null) {
    if (!this.canTake(itemId, null, placement)) return 0;
    if (placement) {
      const removed = Math.min(this.getAvailableUnitsFor(itemId, placement), quantity);
      placement.quantity -= removed;
      return removed;
    }
    let remaining = quantity;
    for (const placement of this.placements) {
      if (remaining <= 0) break;
      if (placement.itemId !== itemId) continue;
      const removed = Math.min(placement.quantity, remaining);
      placement.quantity -= removed;
      remaining -= removed;
    }
    return quantity - remaining;
  }

  // Units on the shelf, for display; not a shared ceiling like InventoryPool's.
  usedCapacity() {
    return this.placements.reduce((sum, p) => sum + p.quantity, 0);
  }
}
