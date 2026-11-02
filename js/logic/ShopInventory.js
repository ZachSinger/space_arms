export class Fixture {
  constructor(data) {
    this.id = data.id;
    this.displayType = data.displayType;
    this.x = data.x;
    this.y = data.y;
    this.gridDimensions = data.gridDimensions;
    this.slots = data.slots || []; // { itemId, quantity, x, y, isRotated }
  }

  // Returns the first slot still holding stock, or null if the fixture is empty.
  findAvailableSlot() {
    return this.slots.find((slot) => slot.quantity > 0) || null;
  }

  // Returns every slot still holding stock (used to pick varied items for a cart).
  getAvailableSlots() {
    return this.slots.filter((slot) => slot.quantity > 0);
  }

  // Decrements a slot's quantity by one and returns the itemId taken, or null if the slot is empty.
  takeItem(slot) {
    if (!slot || slot.quantity <= 0) return null;
    slot.quantity -= 1;
    return slot.itemId;
  }

  // Increments the matching itemId slot's quantity (used when a hauled-in restock crate is
  // delivered -- see GameScene.deliverCarriedCrate). No cap/stackDepth enforcement yet (the
  // bible's Step 5 slot-capacity model isn't implemented anywhere else on Fixture either).
  // Returns false (no-op) if this fixture doesn't stock that item at all -- restocking an
  // item type the shelf was never set up to sell isn't a thing yet (that's Build Mode/
  // fixture reconfiguration, a separate later feature).
  restock(itemId, quantity) {
    const slot = this.slots.find((candidate) => candidate.itemId === itemId);
    if (!slot) return false;
    slot.quantity += quantity;
    return true;
  }
}
