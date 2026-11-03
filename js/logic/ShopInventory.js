import { InventoryPool } from "./InventoryPool.js";

// A StorageFixture is an InventoryPool (shared capacity-pool model, see
// InventoryPool.js) that also has a physical presence on the map -- a position, a
// footprint, and a display type. The storage/capacity logic itself (capacity/stock/
// usedCapacity/add/remove/etc.) all lives in the base class; this just adds "where is it
// and how big does it look." Used for backroom Storage Fixtures specifically -- the sales
// shelf uses a completely different model (manual grid placement + independent
// per-placement depth, see ShelfFixture.js), since "any item fits anywhere there's a
// shared pool of room" is correct for a storage locker but not for a real store shelf.
export class StorageFixture extends InventoryPool {
  constructor(data) {
    super({ capacity: data.capacity, stock: data.stock });
    this.id = data.id;
    this.displayType = data.displayType;
    this.x = data.x;
    this.y = data.y;
    this.gridDimensions = data.gridDimensions; // physical footprint on the map -- unrelated to storage capacity
  }

  // Alias for InventoryPool.add() -- reads better at call sites (see
  // GameScene.tryDeliverCarriedCrate), where "restocking a fixture" is the natural way to
  // describe it. Same "how many units did it actually accept" return value.
  restock(itemId, quantity) {
    return this.add(itemId, quantity);
  }
}

