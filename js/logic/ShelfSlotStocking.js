// ==========================================
// FILE: ShelfSlotStocking.js
// ==========================================
// Rules for hands-on shelf stocking (prototype on the DEV screen). Each shelf space holds one
// kind of item and fills one item at a time. The player and customers always take the item
// placed last. A crate also holds one kind; once emptied it can take any kind.

export const BOX_SIZES = Object.freeze([1, 2, 3, 4, 6, 8, 10, 14, 20]);
export const SLOT_CAPACITY = 20;
export const CRATE_CAPACITY_UNITS = 20;

export function createSlots(count) {
  return Array.from({ length: count }, () =>   ({ category: null, size: null, itemId: null, count: 0 }));
}

  export function createCrate(category = null, count = 0, size = 1, itemId = null) {
    const filled = count > 0;
    return {
      category: filled ? category : null, size: filled ? size : null, itemId: filled ? itemId : null, count,
    };
  }

  function sameKind(a, b) {
    return a.category === b.category && a.size === b.size && a.itemId === b.itemId;
}

export function getSlotItemLimit(size) {
  return BOX_SIZES.includes(size) ? Math.floor(SLOT_CAPACITY / size) : 0;
}

export function getCrateItemLimit(size) {
  return BOX_SIZES.includes(size) ? Math.floor(CRATE_CAPACITY_UNITS / size) : 0;
}

export function canStock(slot, crate) {
  return crate.count > 0 && BOX_SIZES.includes(crate.size)
    && (slot.category === null
      || sameKind(slot, crate))
    && (slot.count * (slot.size ?? crate.size)) + crate.size <= SLOT_CAPACITY;
}

/** Moves one item from the crate onto the space. */
export function stockOne(slot, crate) {
  if (!canStock(slot, crate)) return false;
  slot.category = crate.category;
  slot.size = crate.size;
  slot.itemId = crate.itemId;
  slot.count += 1;
  crate.count -= 1;
  if (crate.count === 0) {
    crate.category = null;
    crate.size = null;
    crate.itemId = null;
  }
  return true;
}

export function canUnstock(slot, crate) {
  const crateLimit = getCrateItemLimit(crate.size ?? slot.size);
  return slot.count > 0 && crate.count < crateLimit
    && (crate.category === null
      || sameKind(crate, slot));
}

/** Moves the last-placed item on the space back into the crate. */
export function unstockOne(slot, crate) {
  if (!canUnstock(slot, crate)) return false;
  crate.category = slot.category;
  crate.size = slot.size;
  crate.itemId = slot.itemId;
  crate.count += 1;
  return takeOne(slot);
}

/** A customer takes the last-placed item off the space. */
export function takeOne(slot) {
  if (slot.count === 0) return false;
  slot.count -= 1;
  if (slot.count === 0) {
    slot.category = null;
    slot.size = null;
    slot.itemId = null;
  }
  return true;
}
