import test from "node:test";
import assert from "node:assert/strict";
import { getShelfStatus, sortSupplyEntries } from "../js/logic/SupplyRenderer.js";

test("the Supply tab flags items already on a shelf, and how they're doing", () => {
  assert.equal(getShelfStatus(null), null);
  assert.equal(getShelfStatus({ quantity: 0, capacity: 10 }).level, "out");
  assert.equal(getShelfStatus({ quantity: 4, capacity: 10 }).level, "low");
  assert.equal(getShelfStatus({ quantity: 5, capacity: 10 }).level, "ok");
});

test("shelved items sort to the top of the Supply tab, most urgent first", () => {
  const entries = [
    { id: "unshelved", shelf: null },
    { id: "full", shelf: { quantity: 10, capacity: 10 } },
    { id: "low", shelf: { quantity: 1, capacity: 10 } },
    { id: "unshelved2", shelf: null },
    { id: "out", shelf: { quantity: 0, capacity: 5 } },
  ];
  assert.deepEqual(sortSupplyEntries(entries).map(({ id }) => id),
    ["out", "low", "full", "unshelved", "unshelved2"]);
});
