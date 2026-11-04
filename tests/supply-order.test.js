import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSupplyOrder, MAX_CRATES_PER_ORDER, DELIVERY_FEE } from "../js/logic/SupplyOrder.js";

const context = (overrides = {}) => ({
  getCrateCost: (itemId) => ({ ammo: 40, rations: 10 })[itemId],
  credits: 1000,
  freePadSpots: 9,
  ...overrides,
});

test("an order charges its crates plus one flat delivery fee", () => {
  const summary = summarizeSupplyOrder(new Map([["ammo", 2], ["rations", 3]]), context());
  assert.equal(summary.crates, 5);
  assert.equal(summary.stockCost, 110);
  assert.equal(summary.deliveryFee, DELIVERY_FEE);
  assert.equal(summary.total, 110 + DELIVERY_FEE);
  assert.equal(summary.canPlace, true);
  assert.equal(summary.problem, null);
});

test("an empty order cannot be placed and costs nothing", () => {
  const summary = summarizeSupplyOrder(new Map(), context());
  assert.equal(summary.total, 0);
  assert.equal(summary.canPlace, false);
  assert.equal(summary.problem, null);
});

test("an order is capped by the per-order limit and by free loading pad spots", () => {
  assert.equal(summarizeSupplyOrder(new Map(), context()).maxCrates, MAX_CRATES_PER_ORDER);
  assert.equal(summarizeSupplyOrder(new Map(), context({ freePadSpots: 3 })).maxCrates, 3);

  const tooBig = summarizeSupplyOrder(new Map([["rations", MAX_CRATES_PER_ORDER + 1]]), context());
  assert.equal(tooBig.canPlace, false);
  assert.match(tooBig.problem, new RegExp(`at most ${MAX_CRATES_PER_ORDER} crates`));

  const noRoom = summarizeSupplyOrder(new Map([["rations", 4]]), context({ freePadSpots: 3 }));
  assert.equal(noRoom.canPlace, false);
  assert.match(noRoom.problem, /Only 3 crate spots are free/);
});

test("the summary explains a full loading pad or missing credits in plain words", () => {
  assert.match(summarizeSupplyOrder(new Map(), context({ freePadSpots: 0 })).problem, /loading pad is full/);

  const broke = summarizeSupplyOrder(new Map([["ammo", 1]]), context({ credits: 50 }));
  assert.equal(broke.canPlace, false);
  assert.equal(broke.problem, `Not enough credits. This order costs ${40 + DELIVERY_FEE} credits and you have 50.`);
});
