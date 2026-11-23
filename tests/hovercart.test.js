import test from "node:test";
import assert from "node:assert/strict";
import {
  HOVERCART_BATTERY,
  getHovercartDrainPerSecond,
  getHovercartMoveSpeed,
  getHovercartTransferCount,
} from "../js/modules/hovercart/Hovercart.js";
import {
  HOVERCART_UPGRADES,
  getHovercartBatteryCapacity,
  getHovercartCapacity,
  isValidHovercartSave,
} from "../js/modules/hovercart/HovercartRules.js";

test("hovercart transfers never exceed available crates or free space", () => {
  assert.equal(getHovercartTransferCount(4, 3), 3);
  assert.equal(getHovercartTransferCount(2, 5), 2);
  assert.equal(getHovercartTransferCount(4, 0), 0);
  assert.equal(getHovercartTransferCount(-1, 3), 0);
});

test("a loaded hovercart follows more slowly, with a minimum speed", () => {
  assert.ok(getHovercartMoveSpeed(3) < getHovercartMoveSpeed(0));
  assert.equal(getHovercartMoveSpeed(5), 60);
  assert.equal(getHovercartMoveSpeed(8), 60);
});

test("hovercart upgrades change speed and capacity by their purchased steps", () => {
  assert.equal(getHovercartMoveSpeed(0, 1), 190);
  assert.equal(getHovercartMoveSpeed(4, 1), 142);
  assert.equal(getHovercartMoveSpeed(5, 2), 205);
  assert.equal(getHovercartMoveSpeed(6, 3), 280);
  assert.equal(getHovercartCapacity({ speed: 2, length: 2, battery: 0 }), 5);
  assert.equal(getHovercartBatteryCapacity({ speed: 3, length: 3, battery: 6 }), 1600);
  assert.equal(HOVERCART_UPGRADES.battery[5].capacity / getHovercartDrainPerSecond(6, true), 100);
});

test("hovercart saves validate upgrade dependencies and upgraded cargo and battery", () => {
  const saved = { owned: true, crates: [], upgrades: { speed: 1, length: 1, battery: 1 }, battery: 450 };
  assert.equal(isValidHovercartSave(saved), true);
  assert.equal(isValidHovercartSave({ ...saved, upgrades: { ...saved.upgrades, speed: 0 } }), false);
  assert.equal(isValidHovercartSave({ ...saved, crates: [{ kind: "item" }, {}, {}, {}, {}] }), false);
  assert.equal(isValidHovercartSave({ ...saved, battery: 451 }), false);
  assert.equal(isValidHovercartSave({
    owned: true,
    crates: [{}, {}, {}, {}, {}, {}],
    upgrades: { speed: 3, length: 3, battery: 6 },
    battery: 1600,
  }), true);
  assert.equal(isValidHovercartSave({ owned: true, crates: [], battery: HOVERCART_BATTERY.capacity }), true);
});

test("hovercart battery drain matches the agreed table", () => {
  assert.deepEqual([0, 1, 2, 3].map((n) => getHovercartDrainPerSecond(n, false)), [1, 2, 3, 4]);
  assert.deepEqual([0, 1, 2, 3].map((n) => getHovercartDrainPerSecond(n, true)), [4, 6, 8, 10]);
  assert.equal(HOVERCART_BATTERY.capacity / getHovercartDrainPerSecond(3, true), 30);
});
