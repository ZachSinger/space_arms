// ==========================================
// FILE: ShopInventory.js
// ==========================================
// Backroom lockers each hold one item type, measured in box-size units, plus their map
// footprint. Sales shelves use a different model (see ShelfFixture.js).
import { InventoryPool } from "./InventoryPool.js";

export class StorageFixture extends InventoryPool {
  constructor(data) {
    super({ capacity: data.capacity, stock: data.stock, capacityUnit: "boxSize", singleItem: true });
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

