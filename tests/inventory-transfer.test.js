import assert from "node:assert/strict";
import { test } from "node:test";
import { Crate } from "../js/logic/Crate.js";
import { Events } from "../js/core/Events.js";
import { sinkItems, sourceItems, transferItems } from "../js/logic/InventoryTransfer.js";

let nextContainerId = 1;

function container(quantity, capacity, addLimit = Infinity) {
  return {
    id: `test-container-${nextContainerId++}`,
    quantity,
    capacity,
    addLimit,
    getContainerId() {
      return this.id;
    },
    getLocation() {
      return { kind: "test-container", containerId: this.id };
    },
    getAvailableUnitsFor() {
      return this.quantity;
    },
    getRemainingUnitsFor() {
      return this.capacity - this.quantity;
    },
    canTake() {
      return true;
    },
    canPut() {
      return true;
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
  const eventBus = new Events();
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
    sourceId: source.id,
    destinationId: destination.id,
    sourceLocation: { kind: "test-container", containerId: source.id },
    destinationLocation: { kind: "test-container", containerId: destination.id },
  }]);
});

test("sources and sinks record external inventory changes", () => {
  const source = container(5, 10);
  const destination = container(0, 3);
  const eventBus = new Events();
  const events = [];
  eventBus.on("inventory-transferred", (event) => events.push(event));

  assert.deepEqual(sourceItems(destination, "ammo", 4, {
    sourceId: "delivery-1",
    sourceLocation: { kind: "supply-delivery", deliveryId: "delivery-1" },
    eventBus,
  }), { moved: 3, remaining: 1, reason: "destination-full" });
  assert.equal(destination.quantity, 3);

  assert.deepEqual(sinkItems(source, "ammo", 3, {
    sinkId: "sale-1",
    sinkLocation: { kind: "sales", saleId: "sale-1" },
    eventBus,
  }), { moved: 3, remaining: 0, reason: null });
  assert.equal(source.quantity, 2);
  assert.deepEqual(events.map(({ sourceId, destinationId, quantity }) => ({
    sourceId,
    destinationId,
    quantity,
  })), [
    { sourceId: "delivery-1", destinationId: destination.id, quantity: 3 },
    { sourceId: source.id, destinationId: "sale-1", quantity: 3 },
  ]);
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

test("enforces source and destination permissions with the transfer context", () => {
  const context = { operation: "drone-reset" };
  const source = container(5, 10);
  const destination = container(0, 10);
  let sourceContext;
  let destinationContext;
  source.canTake = (_itemId, receivedContext) => {
    sourceContext = receivedContext;
    return false;
  };
  destination.canPut = (_itemId, receivedContext) => {
    destinationContext = receivedContext;
    return false;
  };

  assert.deepEqual(transferItems(source, destination, "ammo", 2, { context }), {
    moved: 0,
    remaining: 2,
    reason: "source-locked",
  });
  assert.equal(sourceContext, context);
  assert.equal(source.quantity, 5);
  assert.equal(destination.quantity, 0);

  source.canTake = () => true;
  assert.deepEqual(transferItems(source, destination, "ammo", 2, { context }), {
    moved: 0,
    remaining: 2,
    reason: "destination-locked",
  });
  assert.equal(destinationContext, context);
  assert.equal(source.quantity, 5);
  assert.equal(destination.quantity, 0);
});

test("locked Loading Pad crates cannot be transfer sources", () => {
  const crate = Object.assign(Object.create(Crate.prototype), {
    id: "crate-locked",
    kind: "item",
    itemId: "ammo",
    quantity: 5,
    locationState: { kind: "loading-pad", padId: "loading-pad" },
  });
  const destination = container(0, 10);

  assert.deepEqual(transferItems(crate, destination, "ammo", 2), {
    moved: 0,
    remaining: 2,
    reason: "source-locked",
  });
  assert.equal(crate.quantity, 5);
  assert.equal(destination.quantity, 0);
});

test("crate locations distinguish the floor, player, holder stack, and Loading Pad", () => {
  const crate = Object.assign(Object.create(Crate.prototype), {
    id: "crate-location-test",
    kind: "item",
    itemId: "ammo",
    quantity: 1,
    locationState: { kind: "world" },
    isPushed: false,
    sprite: { x: 120, y: 80 },
  });
  crate.stopThrowAcceleration = () => {};
  crate.sprite.body = { stop() {}, setImmovable() {} };

  assert.deepEqual(crate.getLocation(), { kind: "world", x: 120, y: 80 });
  crate.setCarriedBy("employee-1");
  assert.deepEqual(crate.getLocation(), { kind: "carried", holderId: "employee-1" });
  crate.setStackedOn("crate-base");
  assert.deepEqual(crate.getLocation(), { kind: "crate-stack", baseCrateId: "crate-base" });
  crate.lockToPad();
  assert.deepEqual(crate.getLocation(), { kind: "loading-pad", padId: "loading-pad" });
  assert.equal(crate.isCarried, false);
  assert.equal(crate.locationState.kind, "loading-pad");
});

test("item crates can transfer stock without losing the units the destination cannot hold", () => {
  const crate = Object.assign(Object.create(Crate.prototype), {
    id: "crate-source",
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

test("rejects duplicate IDs and containers without a location", () => {
  const source = container(1, 2);
  const destination = container(0, 2);
  destination.id = source.id;
  assert.throws(() => transferItems(source, destination, "ammo", 1), /stable IDs/);

  destination.id = "different-container";
  destination.getLocation = () => null;
  assert.throws(() => transferItems(source, destination, "ammo", 1), /valid location/);
});

test("thousands of transfers, sources, and sinks preserve the inventory ledger", () => {
  const containers = Array.from({ length: 8 }, (_, index) => container(index * 2, 40));
  const events = [];
  const eventBus = { emit: (_event, payload) => events.push(payload) };
  let seed = 0x5eed1234;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const total = () => containers.reduce((sum, entry) => sum + entry.quantity, 0);
  const initialTotal = total();
  let sourced = 0;
  let sunk = 0;

  for (let step = 0; step < 5000; step += 1) {
    const operation = random();
    const index = Math.floor(random() * containers.length);
    const amount = 1 + Math.floor(random() * 6);
    if (operation < 0.6) {
      const destinationIndex = (index + 1 + Math.floor(random() * (containers.length - 1))) % containers.length;
      transferItems(containers[index], containers[destinationIndex], "ammo", amount, { eventBus });
    } else if (operation < 0.8) {
      const result = sourceItems(containers[index], "ammo", amount, {
        sourceId: `source-${step}`,
        sourceLocation: { kind: "random-source", operation: step },
        eventBus,
      });
      sourced += result.moved;
    } else {
      const result = sinkItems(containers[index], "ammo", amount, {
        sinkId: `sink-${step}`,
        sinkLocation: { kind: "random-sink", operation: step },
        eventBus,
      });
      sunk += result.moved;
    }
    assert.equal(total(), initialTotal + sourced - sunk, `inventory ledger diverged at operation ${step}`);
  }

  assert.ok(events.length > 1000, "the randomized run should exercise successful inventory changes");
  assert.ok(events.every((event) => Number.isInteger(event.quantity) && event.quantity > 0));
});
