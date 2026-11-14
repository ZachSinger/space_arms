import assert from "node:assert/strict";
import test from "node:test";
import { FixtureRegistry } from "../js/logic/FixtureRegistry.js";
import { getFixtureType } from "../js/logic/FixtureLayout.js";

function registryWith(...types) {
  const registry = new FixtureRegistry();
  for (const type of types) registry.add({ id: registry.nextId(type), type, gx: 0, gy: 0 });
  return registry;
}

test("registry groups fixtures by kind and names duplicates by number", () => {
  const registry = registryWith("shelf_budget_2x4", "locker_single", "locker_single", "register_basic");
  const [shelf, lockerA, lockerB, register] = registry.all();

  assert.deepEqual(registry.shelves(), [shelf]);
  assert.deepEqual(registry.stockHolders(), [shelf, lockerA, lockerB]);
  assert.equal(registry.register(), register);
  assert.equal(registry.displayName(shelf), getFixtureType("shelf_budget_2x4").name);
  assert.equal(registry.displayName(lockerB), `${getFixtureType("locker_single").name} 2`);
});

test("registry ids stay unique and removal frees the id", () => {
  const registry = registryWith("shelf_budget_2x4", "shelf_budget_2x4");
  assert.deepEqual(registry.all().map((f) => f.id), ["shelf_budget_2x4_1", "shelf_budget_2x4_2"]);
  assert.throws(() => registry.add({ id: "shelf_budget_2x4_1", type: "shelf_budget_2x4" }), /Duplicate/);
  assert.throws(() => registry.add({ id: "x", type: "nope" }), /Unknown fixture type/);

  registry.remove("shelf_budget_2x4_1");
  assert.equal(registry.nextId("shelf_budget_2x4"), "shelf_budget_2x4_1");
  assert.deepEqual(registry.layout(), [{ id: "shelf_budget_2x4_2", type: "shelf_budget_2x4", gx: 0, gy: 0, rotation: 0 }]);
});
