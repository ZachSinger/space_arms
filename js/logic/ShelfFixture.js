// ==========================================
// FILE: ShelfFixture.js
// ==========================================
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton
import { getShelfSlotCapacity } from "./FixtureLayout.js";

// The sales shelf's stock grid is two visual cells per floor tile in each direction.
// The player manually picks which cells each item occupies (Tarkov-style packing, using
// the item's own `dimensions` w/h, optionally rotated 90 degrees). Depth/"stack" capacity
// is NOT a shared pool like a Storage Fixture
// (see InventoryPool.js) -- each individual placement gets its own capacity, independently:
// the item's own `stackSize` (units per slot), capped by this fixture's `stackDepth`.
// Placements of different items on the same shelf don't share or compete for it.
export class ShelfFixture {
  constructor(data) {
    this.id = data.id;
    this.displayType = data.displayType;
    this.x = data.x;
    this.y = data.y;
    this.gridDimensions = data.gridDimensions; // physical footprint on the map (tiles) -- unrelated to the item grid below
    this.displayGrid = data.displayGrid; // two item-placement cells per floor tile
    this.stackDepth = data.stackDepth; // uniform depth capacity, applied independently per placement
    // [{ itemId, gx, gy, w, h, rotated, quantity }] -- gx/gy is the top-left anchor cell;
    // w/h is the item's own dimensions (swapped if rotated), not the fixture's grid size.
    this.placements = data.placements || [];
  }

  // Duck-types the same small API InventoryPool exposes (stock/findStockEntry/add/
  // remove/etc.) so GameScene's crate-delivery and FixtureWindow's hovercart-transfer
  // code can treat a ShelfFixture exactly like a Storage Fixture's pool, without needing
  // to know the underlying capacity model is completely different.
  get stock() {
    return this.placements;
  }

  findStockEntry(itemId) {
    return this.placements.find((p) => p.itemId === itemId) || null;
  }

  // How many units ONE specific placement can hold, independent of every other
  // placement on the same fixture.
  getPlacementCapacity(placement) {
    return getShelfSlotCapacity(this.stackDepth, database.getItem(placement.itemId));
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

  // Whether a w x h footprint (already adjusted for rotation by the caller) would fit at
  // (gx, gy) -- within the fixture's own display grid bounds, and not overlapping any
  // existing placement.
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

  // Places a new instance of itemId at the given anchor cell, already holding 1 unit (the
  // caller is responsible for having taken that unit from somewhere, e.g. the hovercart)
  // -- a new placement never starts at 0 stock. Returns the new placement, or null if it
  // doesn't fit there or can't hold even a single unit.
  placeItem(itemId, gx, gy, rotated = false) {
    const item = database.getItem(itemId);
    if (!item) return null;

    const w = rotated ? item.dimensions.h : item.dimensions.w;
    const h = rotated ? item.dimensions.w : item.dimensions.h;
    if (!this.canPlaceAt(gx, gy, w, h)) return null;

    const placement = { itemId, gx, gy, w, h, rotated, quantity: 1 };
    if (this.getPlacementCapacity(placement) < 1) return null;
    this.placements.push(placement);
    return placement;
  }

  // Lifts an existing placement (with its whole stack) off the grid so its cells are free
  // while the player picks a new spot for it. It stays out of placements -- so customers
  // and deliveries can't touch it -- until attachPlacement() puts it back somewhere.
  detachPlacement(placement) {
    this.placements = this.placements.filter((p) => p !== placement);
  }

  // Puts a detached placement back at (gx, gy). Returns false (leaving it detached) if it
  // doesn't fit there.
  attachPlacement(placement, gx, gy, rotated) {
    const item = database.getItem(placement.itemId);
    const w = rotated ? item.dimensions.h : item.dimensions.w;
    const h = rotated ? item.dimensions.w : item.dimensions.h;
    if (!this.canPlaceAt(gx, gy, w, h)) return false;

    Object.assign(placement, { gx, gy, w, h, rotated });
    this.placements.push(placement);
    return true;
  }

  // A sold-out slot keeps its spot (and its item assignment) until the player deliberately
  // removes it. Only an empty slot can be removed. Returns whether it was.
  removeEmptyPlacement(placement) {
    if (!placement || placement.quantity > 0 || !this.placements.includes(placement)) return false;
    this.placements = this.placements.filter((p) => p !== placement);
    return true;
  }

  // --- The rest of this mirrors InventoryPool's own public API exactly (see its own
  // comments), just backed by per-placement capacity instead of one shared pool. ---

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

  // Every placement already holding this itemId that still has room for more.
  getOpenPlacementsFor(itemId) {
    return this.placements.filter(
      (p) => p.itemId === itemId && p.quantity < this.getPlacementCapacity(p),
    );
  }

  getRemainingUnitsFor(itemId) {
    return this.getOpenPlacementsFor(itemId).reduce(
      (sum, p) => sum + (this.getPlacementCapacity(p) - p.quantity),
      0,
    );
  }

  // Adds up to `quantity` units of itemId, filling whichever existing placements for it
  // have room (there's no "introduce a new item on the fly" here the way a Storage
  // Fixture's pool allows -- an item has to actually be placed on the grid, taking up
  // real physical space, before any stock can go into it). Returns how many units it
  // actually accepted.
  add(itemId, quantity) {
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

  // Alias for add() -- reads better at crate-delivery call sites (see
  // GameScene.tryDeliverCarriedCrate).
  restock(itemId, quantity) {
    return this.add(itemId, quantity);
  }

  remove(itemId, quantity) {
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

  // Not a real shared ceiling the way InventoryPool.usedCapacity() is -- just "how many
  // units are physically sitting on this fixture right now", for display purposes.
  usedCapacity() {
    return this.placements.reduce((sum, p) => sum + p.quantity, 0);
  }
}
