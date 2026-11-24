import assert from "node:assert/strict";
import { test } from "node:test";
import { InteractableRegistry } from "../js/interaction/InteractableRegistry.js";

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

test("interactables supply context-aware actions with their own target and behavior", () => {
  const registry = new InteractableRegistry();
  const facingTarget = {};
  const actionTarget = {};
  const player = {};
  const input = { pressed: new Set(["interact"]) };
  let performed = 0;
  let receivedContext;
  registry.registerProvider("fixture", () => [{
    id: "shelf",
    kind: "fixture",
    target: facingTarget,
    range: 10,
    distanceFrom: () => 3,
    getActions: (actionPlayer, actionInput) => {
      receivedContext = [actionPlayer, actionInput];
      return [{
        action: "interact",
        id: "shelf:open",
        target: actionTarget,
        hint: "E: Open this shelf",
        perform: () => { performed += 1; },
      }];
    },
  }]);

  const action = registry.findTarget("interact", { x: 0, y: 0 }, actionTarget, player, input);
  assert.equal(action.id, "shelf:open");
  assert.equal(action.target, actionTarget);
  assert.equal(action.hint, "E: Open this shelf");
  assert.deepEqual(receivedContext, [player, input]);
  action.perform();
  assert.equal(performed, 1);
});

test("target selection can be limited to one interactable kind", () => {
  const registry = new InteractableRegistry();
  registry.registerProvider("fixtures", () => [
    { ...candidate({ id: "shelf", distance: 4, priority: 2 }), kind: "fixture" },
    { ...candidate({ id: "trashcan", distance: 1, priority: 5 }), kind: "trashcan" },
  ]);

  assert.equal(
    registry.findTarget("interact", { x: 0, y: 0 }, null, null, null, "fixture").id,
    "shelf",
  );
});

test("target selection can skip a provider while a provider resolves competing targets", () => {
  const registry = new InteractableRegistry();
  let providerCalls = 0;
  registry.registerProvider("portals", () => {
    providerCalls += 1;
    return [candidate({ id: "door", distance: 0, priority: 10 })];
  });
  registry.registerProvider("fixtures", () => [
    { ...candidate({ id: "shelf", distance: 2, priority: 3 }), kind: "fixture" },
  ]);

  const target = registry.findTarget(
    "interact",
    { x: 0, y: 0 },
    null,
    null,
    null,
    "fixture",
    { excludeProvider: "portals" },
  );

  assert.equal(target.id, "shelf");
  assert.equal(providerCalls, 0);
});
