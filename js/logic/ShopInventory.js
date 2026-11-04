// ==========================================
// FILE: ShopInventory.js
// ==========================================
// Backroom storage fixtures: an InventoryPool with a place and footprint on the map.
// Sales shelves use a different model (see ShelfFixture.js), since "any item fits while
// there's shared room" suits a locker but not a real store shelf.
import { InventoryPool } from "./InventoryPool.js";

export class StorageFixture extends InventoryPool {
  constructor(data) {
    super({ capacity: data.capacity, stock: data.stock });
    this.id = data.id;
    this.displayType = data.displayType;
    this.x = data.x;
    this.y = data.y;
    this.gridDimensions = data.gridDimensions; // map footprint, unrelated to storage capacity
  }

  restock(itemId, quantity) {
    return this.add(itemId, quantity);
  }
}

