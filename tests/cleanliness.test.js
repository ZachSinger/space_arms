import assert from "node:assert/strict";
import test from "node:test";
import {
  getCleanlinessMax, getCleanlinessScore, judgeCleanliness, rollCleanlinessTolerance,
} from "../js/logic/Litter.js";

test("cleanliness maximum grows with sales floor expansions and shop levels past 5", () => {
  assert.equal(getCleanlinessMax({ salesExpansions: 0, shopLevel: 1 }), 20);
  assert.equal(getCleanlinessMax({ salesExpansions: 0, shopLevel: 5 }), 20);
  assert.equal(getCleanlinessMax({ salesExpansions: 2, shopLevel: 8 }), 20 + 40 + 6);
});

test("trash costs 1 point, dirt 2, and the score never drops below 0", () => {
  assert.equal(getCleanlinessScore(20, 3), 17);
  assert.equal(getCleanlinessScore(20, 3, 2), 13);
  assert.equal(getCleanlinessScore(20, 30), 0);
});

test("explorers are the pickiest and scavengers the least, with walk-out always below upset", () => {
  const lowest = (faction) => rollCleanlinessTolerance(faction, () => 0);
  const highest = (faction) => rollCleanlinessTolerance(faction, () => 0.999);
  const order = ["scavengers", null, "mercenaries", "explorers"];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(lowest(order[i]).upsetBelow > lowest(order[i - 1]).upsetBelow);
    assert.ok(lowest(order[i]).walkOutBelow > lowest(order[i - 1]).walkOutBelow);
  }
  for (const faction of order) assert.ok(highest(faction).walkOutBelow < lowest(faction).upsetBelow);
});

test("a customer is fine, upset, or walks out depending on the store's cleanliness percent", () => {
  const tolerance = { upsetBelow: 70, walkOutBelow: 30 };
  assert.equal(judgeCleanliness(70, tolerance), "fine");
  assert.equal(judgeCleanliness(69, tolerance), "upset");
  assert.equal(judgeCleanliness(29, tolerance), "walk-out");
});
