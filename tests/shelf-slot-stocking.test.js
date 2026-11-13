import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOX_SIZES, CRATE_CAPACITY_UNITS, SLOT_CAPACITY, canStock, createCrate, createSlots,
  getCrateItemLimit, getSlotItemLimit, stockOne, takeOne, unstockOne,
} from "../js/logic/ShelfSlotStocking.js";

test("the selected box sizes fit the expected number of boxes in a 20-unit space", () => {
  assert.deepEqual(BOX_SIZES, [1, 2, 3, 4, 6, 8, 10, 14, 20]);
  assert.deepEqual(BOX_SIZES.map(getSlotItemLimit), [20, 10, 6, 5, 3, 2, 2, 1, 1]);
  assert.deepEqual(BOX_SIZES.map(getCrateItemLimit), [20, 10, 6, 5, 3, 2, 2, 1, 1]);
  assert.equal(CRATE_CAPACITY_UNITS, SLOT_CAPACITY);
});

test("a space accepts boxes only while the total size stays within 20", () => {
  const [slot] = createSlots(1);
  const crate = createCrate("weapons", getCrateItemLimit(3), 3);
  while (stockOne(slot, crate));
  assert.deepEqual(slot, { category: "weapons", size: 3, itemId: null, count: 6 });
  assert.equal(slot.count * slot.size, 18);
  assert.equal(crate.count, 0);
  assert.equal(canStock(slot, createCrate("weapons", 1, 3)), false);
});

test("a space only takes the same kind and size of item already on it", () => {
  const [slot] = createSlots(1);
  stockOne(slot, createCrate("weapons", 1, 2));
  assert.equal(stockOne(slot, createCrate("armor", 5, 2)), false);
  assert.equal(stockOne(slot, createCrate("weapons", 5, 1)), false);
});

test("a space only takes the same item, and pulling it back keeps the item", () => {
  const [slot] = createSlots(1);
  stockOne(slot, createCrate("weapons", 1, 4, "wpn_rif_01"));
  assert.equal(stockOne(slot, createCrate("weapons", 1, 4, "wpn_rif_02")), false);
  assert.equal(stockOne(slot, createCrate("weapons", 1, 4, "wpn_rif_01")), true);
  const crate = createCrate();
  unstockOne(slot, crate);
  assert.deepEqual(crate, { category: "weapons", size: 4, itemId: "wpn_rif_01", count: 1 });
});

test("an emptied crate can pull any kind off a shelf, then only that kind", () => {
  const slots = createSlots(2);
  stockOne(slots[0], createCrate("armor", 1, 4));
  stockOne(slots[1], createCrate("tools", 1, 3));
  const crate = createCrate("weapons", 1, 1);
  stockOne(createSlots(1)[0], crate);
  assert.equal(unstockOne(slots[0], crate), true);
  assert.deepEqual(crate, { category: "armor", size: 4, itemId: null, count: 1 });
  assert.equal(unstockOne(slots[1], crate), false);
});

test("a customer taking the last item leaves the space free for any kind", () => {
  const [slot] = createSlots(1);
  stockOne(slot, createCrate("weapons", 1, 20));
  assert.equal(takeOne(slot), true);
  assert.equal(takeOne(slot), false);
  assert.deepEqual(slot, { category: null, size: null, itemId: null, count: 0 });
  assert.equal(stockOne(slot, createCrate("armor", 1, 20)), true);
});

test("a size-20 box fills the space by itself", () => {
  const [slot] = createSlots(1);
  assert.equal(stockOne(slot, createCrate("weapons", 1, 20)), true);
  assert.equal(canStock(slot, createCrate("weapons", 1, 1)), false);
  assert.equal(slot.count * slot.size, SLOT_CAPACITY);
});
