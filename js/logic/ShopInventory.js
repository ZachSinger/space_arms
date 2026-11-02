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
}
