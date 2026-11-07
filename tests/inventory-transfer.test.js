import assert from "node:assert/strict";
import { test } from "node:test";
import { Crate } from "../js/logic/Crate.js";
import { EventBus } from "../js/logic/EventBus.js";
import { transferItems } from "../js/logic/InventoryTransfer.js";

function container(quantity, capacity, addLimit = Infinity) {
  return {
    quantity,
    capacity,
    addLimit,
    getAvailableUnitsFor() {
      return this.quantity;
    },
    getRemainingUnitsFor() {
      return this.capacity - this.quantity;
    },
    remove(_itemId, requested) {
      const removed = Math.min(requested, this.quantity);
      this.quantity -= removed;
      return removed;
    },
    add(_itemId, requested) {
      const added = Math.min(requested, this.capacity - this.quantity, this.addLimit);
      this.quantity += added;
      return added;
    },
  };
}

test("moves only what fits and publishes one inventory-transfer event", () => {
  const source = container(5, 10);
  const destination = container(0, 3);
  const eventBus = new EventBus();
  const events = [];
  eventBus.on("inventory-transferred", (event) => events.push(event));

  const result = transferItems(source, destination, "ammo", 5, {
    eventBus,
    sourceName: "crate",
    destinationName: "shelf",
  });

  assert.deepEqual(result, { moved: 3, remaining: 2, reason: "destination-full" });
  assert.equal(source.quantity, 2);
  assert.equal(destination.quantity, 3);
  assert.deepEqual(events, [{
    itemId: "ammo",
    quantity: 3,
    source: "crate",
    destination: "shelf",
  }]);
});

test("restores unaccepted units and leaves stock unchanged when no transfer is possible", () => {
  const source = container(5, 10);
  const limitedDestination = container(0, 10, 2);
  const partial = transferItems(source, limitedDestination, "ammo", 4);
  assert.equal(partial.moved, 2);
  assert.equal(source.quantity, 3);
  assert.equal(limitedDestination.quantity, 2);

  const fullDestination = container(2, 2);
  const blocked = transferItems(source, fullDestination, "ammo", 1);
  assert.deepEqual(blocked, { moved: 0, remaining: 1, reason: "destination-full" });
  assert.equal(source.quantity, 3);
  assert.equal(fullDestination.quantity, 2);
});

test("item crates can transfer stock without losing the units the destination cannot hold", () => {
  const crate = Object.assign(Object.create(Crate.prototype), {
    kind: "item",
    itemId: "ammo",
    quantity: 5,
  });
  const destination = container(0, 3);

  const result = transferItems(crate, destination, "ammo", 5);

  assert.equal(result.moved, 3);
  assert.equal(result.remaining, 2);
  assert.equal(crate.quantity, 2);
  assert.equal(destination.quantity, 3);
});

test("rejects invalid quantities and incomplete container interfaces", () => {
  const source = container(1, 2);
  const destination = container(0, 2);
  assert.throws(() => transferItems(source, destination, "ammo", 0), /positive integer/);
  assert.throws(() => transferItems(source, {}, "ammo", 1), /missing getRemainingUnitsFor/);
});
