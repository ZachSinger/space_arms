import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

// Default stackDepth given to a slot the moment the player assigns an item to it (bible
// Step 5's own worked example uses 8, so it's a reasonable one-size-fits-most default
// until per-fixture/per-displayType capacity tuning exists).
export const DEFAULT_SLOT_STACK_DEPTH = 8;

export class Fixture {
  constructor(data) {
    this.id = data.id;
    this.displayType = data.displayType;
    this.x = data.x;
    this.y = data.y;
    this.gridDimensions = data.gridDimensions;
    // { x, y, itemId, quantity, stackDepth } -- itemId/stackDepth are null on a slot that
    // hasn't been assigned anything to sell/store yet (see assignItem()).
    this.slots = data.slots || [];
  }

  // How many units of its assigned item a slot can physically hold (bible Step 5: a
  // slot's stackDepth divided by the item's own stack value, rounded down). An unassigned
  // slot has no capacity at all -- it isn't holding any particular item yet.
  getSlotCapacity(slot) {
    if (!slot.itemId || !slot.stackDepth) return 0;
    const item = database.getItem(slot.itemId);
    if (!item || !item.stackSize) return 0;
    return Math.floor(slot.stackDepth / item.stackSize);
  }

  // Assigns a previously-empty slot to a specific item (bible: "determine what can go on
  // the shelf") -- the player-driven step that turns a blank block into something that can
  // actually be stocked/sold. Refuses to overwrite a slot that's already assigned to
  // something else; use unassignItem() first (which itself refuses unless the slot is
  // already empty of actual stock).
  assignItem(slot, itemId, stackDepth = DEFAULT_SLOT_STACK_DEPTH) {
    if (slot.itemId) return false;
    slot.itemId = itemId;
    slot.stackDepth = stackDepth;
    slot.quantity = 0;
    return true;
  }

  // Clears a slot back to blank/assignable. Only allowed while it's already sitting at
  // zero stock -- un-assigning a slot that's still holding physical units would need
  // somewhere for those units to go (the hovercart, per bible Step 63), which doesn't
  // exist yet.
  unassignItem(slot) {
    if (slot.quantity > 0) return false;
    slot.itemId = null;
    slot.stackDepth = null;
    slot.quantity = 0;
    return true;
  }

  // Returns the first slot still holding stock, or null if the fixture is empty.
  findAvailableSlot() {
    return this.slots.find((slot) => slot.quantity > 0) || null;
  }

  // Returns every slot still holding stock (used to pick varied items for a cart).
  getAvailableSlots() {
    return this.slots.filter((slot) => slot.quantity > 0);
  }

  // Every slot assigned to this item that still has room for more (used by restock() and
  // by delivery routing to ask "can this fixture accept any of this item at all?").
  getOpenSlotsFor(itemId) {
    return this.slots.filter(
      (slot) => slot.itemId === itemId && slot.quantity < this.getSlotCapacity(slot),
    );
  }

  // Decrements a slot's quantity by one and returns the itemId taken, or null if the slot is empty.
  takeItem(slot) {
    if (!slot || slot.quantity <= 0) return null;
    slot.quantity -= 1;
    return slot.itemId;
  }

  // Adds up to `quantity` units of itemId into whichever of this fixture's own slots are
  // already assigned to it, filling each slot up to its real stackDepth-derived capacity
  // (bible Step 5) rather than growing a slot without limit. Returns how many units it
  // actually accepted -- the caller (GameScene.tryDeliverCarriedCrate) needs this to know
  // whether the crate was fully emptied or still has leftover units that didn't fit.
  restock(itemId, quantity) {
    let remaining = quantity;

    for (const slot of this.getOpenSlotsFor(itemId)) {
      if (remaining <= 0) break;
      const capacity = this.getSlotCapacity(slot);
      const room = capacity - slot.quantity;
      const added = Math.min(room, remaining);
      slot.quantity += added;
      remaining -= added;
    }

    return quantity - remaining;
  }
}
