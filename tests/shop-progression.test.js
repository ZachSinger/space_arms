import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  IMPLEMENTED_SHOP_REWARD_LEVELS,
  hasUnimplementedShopRewardBetween,
  getNextShopLevel,
  getShopLevelForReputation,
  getShopLevelRequirement,
  isKnownShopLevel,
  SHOP_LEVEL_TIERS,
} from "../js/logic/ShopProgression.js";

const expectedReputation = [
  0, 15, 35, 60, 90, 125, 165, 210, 260, 315,
  375, 440, 510, 585, 665, 750, 840, 935, 1035, 1140,
  1250, 1365, 1485, 1610, 1740, 1875, 2015, 2160, 2310, 2465,
];

test("all 30 shop levels use the planned cumulative reputation thresholds", () => {
  assert.deepEqual(SHOP_LEVEL_TIERS.map((tier) => tier.reputation), expectedReputation);
  for (const [index, threshold] of expectedReputation.entries()) {
    const level = index + 1;
    assert.equal(isKnownShopLevel(level), true);
    assert.equal(getShopLevelRequirement(level), threshold);
    assert.equal(getShopLevelForReputation(threshold), level);
    if (level > 1) assert.equal(getShopLevelForReputation(threshold - 1), level - 1);
    assert.equal(getNextShopLevel(level)?.level ?? null, level < 30 ? level + 1 : null);
  }
  assert.equal(getShopLevelForReputation(-100), 1);
  assert.equal(getShopLevelForReputation(10000), 30);
  assert.equal(isKnownShopLevel(0), false);
  assert.equal(isKnownShopLevel(31), false);
  assert.throws(() => getShopLevelRequirement(31), /Unknown Shop Level/);
});

test("the implemented reward levels and intervening planned rewards are reported accurately", () => {
  assert.deepEqual(IMPLEMENTED_SHOP_REWARD_LEVELS, Array.from({ length: 29 }, (_, index) => index + 2));
  assert.equal(hasUnimplementedShopRewardBetween(4, 5), false);
  assert.equal(hasUnimplementedShopRewardBetween(5, 6), false);
  assert.equal(hasUnimplementedShopRewardBetween(4, 9), false);
  assert.equal(hasUnimplementedShopRewardBetween(8, 9), false);
  assert.equal(hasUnimplementedShopRewardBetween(29, 30), false);
});

test("the store-level roadmap lists the same cumulative thresholds used by the game", async () => {
  const roadmap = await readFile(new URL("../documentation/StoreLevel.md", import.meta.url), "utf8");
  for (const [index, threshold] of expectedReputation.entries()) {
    assert.match(roadmap, new RegExp(`\\| ${index + 1} \\| ${threshold} \\|`));
  }
});
