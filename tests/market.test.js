import assert from "node:assert/strict";
import test from "node:test";
import { Market, DAILY_SWING, MIN_BASE_RATIO, MAX_BASE_RATIO, MIN_SUPPLY_RATIO, MAX_SUPPLY_RATIO } from "../js/logic/Market.js";

const items = [{ id: "rifle", baseCost: 1000 }];

test("day 1 price is within one swing of the hidden base", () => {
  for (const roll of [0, 0.5, 0.999]) {
    const price = new Market(items, () => roll).getPrice("rifle");
    assert.ok(price >= 1000 * (1 - DAILY_SWING) && price <= 1000 * (1 + DAILY_SWING), `${price}`);
  }
});

test("advanceDay moves relative to the previous price", () => {
  let roll = 1; // +10%
  const market = new Market(items, () => roll);
  assert.equal(market.getPrice("rifle"), 1100);
  market.advanceDay();
  assert.equal(market.getPrice("rifle"), 1210);
  roll = 0; // -10%
  market.advanceDay();
  assert.equal(market.getPrice("rifle"), 1089);
  assert.equal(market.day, 3);
});

test("price stays within the band around the hidden base", () => {
  const up = new Market(items, () => 1);
  const down = new Market(items, () => 0);
  for (let day = 0; day < 50; day += 1) {
    up.advanceDay();
    down.advanceDay();
  }
  assert.equal(up.getPrice("rifle"), 1000 * MAX_BASE_RATIO);
  assert.equal(down.getPrice("rifle"), 1000 * MIN_BASE_RATIO);
});

test("supply cost uses a hidden per-item rate that stays fixed across days", () => {
  const twoItems = [...items, { id: "pistol", baseCost: 1000 }];
  const rolls = [0, 1];
  const market = new Market(twoItems, () => rolls.shift() ?? 0.5);
  assert.equal(market.getSupplyCost("rifle", 5), 1000 * MIN_SUPPLY_RATIO * 5);
  assert.equal(market.getSupplyCost("pistol", 5), 1000 * MAX_SUPPLY_RATIO * 5);
  market.advanceDay();
  assert.equal(market.getSupplyCost("rifle", 5), 1000 * MIN_SUPPLY_RATIO * 5);
});
