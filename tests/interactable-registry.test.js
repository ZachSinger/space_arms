import assert from "node:assert/strict";
import { test } from "node:test";
import { InteractableRegistry } from "../js/logic/InteractableRegistry.js";

function candidate({ id, action = "interact", distance, range = 10, priority = 0, available = true }) {
  return {
    id,
    actions: [action],
    distanceFrom: () => distance,
    range,
    priority,
    isAvailable: () => available,
  };
}

test("chooses the highest-priority nearby target and then the nearest within that priority", () => {
  const registry = new InteractableRegistry();
  registry.registerProvider("fixtures", () => [
    candidate({ id: "shelf", distance: 4, priority: 2 }),
    candidate({ id: "nearer-register", distance: 1, priority: 1 }),
    candidate({ id: "other-shelf", distance: 3, priority: 2 }),
  ]);

  assert.equal(registry.findTarget("interact", { x: 0, y: 0 }).id, "other-shelf");
});

test("ignores unavailable and out-of-range candidates", () => {
  const registry = new InteractableRegistry();
  registry.registerProvider("crates", () => [
    candidate({ id: "moving", action: "pickup", distance: 1, available: false }),
    candidate({ id: "too-far", action: "pickup", distance: 11 }),
    candidate({ id: "resting", action: "pickup", distance: 5 }),
  ]);

  assert.equal(registry.findTarget("pickup", { x: 0, y: 0 }).id, "resting");
  assert.equal(registry.findTarget("deliver", { x: 0, y: 0 }), null);
});

test("can focus a clicked target and unregister a provider", () => {
  const registry = new InteractableRegistry();
  const clickedTarget = {};
  const remove = registry.registerProvider("fixtures", () => [
    { ...candidate({ id: "fixture", distance: 1 }), target: clickedTarget },
  ]);

  assert.equal(registry.findTarget("interact", { x: 0, y: 0 }, clickedTarget).target, clickedTarget);
  assert.equal(registry.findTarget("interact", { x: 0, y: 0 }, {}), null);
  remove();
  assert.equal(registry.findTarget("interact", { x: 0, y: 0 }), null);
  assert.throws(() => registry.registerProvider("fixtures", null), /must return candidates/);
});
