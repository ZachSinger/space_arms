import test from "node:test";
import assert from "node:assert/strict";
import { getShelfStatus, sortSupplyEntries, SupplyRenderer } from "../js/logic/SupplyRenderer.js";

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

test("the Supply tab keeps crate ordering and cost details in its split-panel layout", () => {
  const item = { id: "rations", name: "Basic Rations", image: null, stackSize: 10, boxSize: 1 };
  const scene = {
    getRestockableItems: () => [{
      item, quantity: 0, shelf: { quantity: 0, capacity: 10 }, cost: 25,
    }],
    getSupplyOrderSummary: () => ({
      crates: 2, maxCrates: 9, stockCost: 50, deliveryFee: 25, total: 75,
      canPlace: true, problem: null,
    }),
    getLoadingPadSpawnPositions: () => Array(9),
  };
  const html = SupplyRenderer.generateHTML(scene, new Map([["rations", 2]]));

  assert.match(html, /Available Items/);
  assert.match(html, /Your Order/);
  assert.match(html, /divider-thick supply-divider/);
  assert.match(html, />Order</);
  assert.doesNotMatch(html, /In Shop|Per Crate|credits/);
  assert.match(html, /Sold out on shelves/);
  assert.match(html, /<strong>25<\/strong>/);
  assert.match(html, /20 items/);
  assert.match(html, /data-supply-remove="rations"/);
  assert.match(html, /data-supply-add="rations"/);
  assert.match(html, /Items:<\/span><strong>2\/9/);
  assert.match(html, /Subtotal:<\/span><strong>50/);
  assert.match(html, /Fee:<\/span><strong>25/);
  assert.match(html, /divider-thin/);
  assert.match(html, /Total<\/span><strong>75/);
  assert.match(html, /data-supply-place/);
});
