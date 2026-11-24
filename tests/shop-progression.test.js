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

test("all 50 shop levels are reachable at their cumulative reputation thresholds", () => {
  assert.equal(SHOP_LEVEL_TIERS.length, 50);
  for (const { level, reputation: threshold } of SHOP_LEVEL_TIERS) {
    assert.equal(isKnownShopLevel(level), true);
    assert.equal(getShopLevelRequirement(level), threshold);
    assert.equal(getShopLevelForReputation(threshold), level);
    if (level > 1) assert.equal(getShopLevelForReputation(threshold - 1), level - 1);
    assert.equal(getNextShopLevel(level)?.level ?? null, level < 50 ? level + 1 : null);
  }
  assert.equal(getShopLevelForReputation(-100), 1);
  assert.equal(getShopLevelForReputation(Number.MAX_SAFE_INTEGER), 50);
  assert.equal(isKnownShopLevel(0), false);
  assert.equal(isKnownShopLevel(51), false);
  assert.throws(() => getShopLevelRequirement(51), /Unknown Shop Level/);
});

test("the implemented reward levels and intervening planned rewards are reported accurately", () => {
  assert.deepEqual(IMPLEMENTED_SHOP_REWARD_LEVELS, Array.from({ length: 49 }, (_, index) => index + 2));
  assert.equal(hasUnimplementedShopRewardBetween(4, 5), false);
  assert.equal(hasUnimplementedShopRewardBetween(5, 6), false);
  assert.equal(hasUnimplementedShopRewardBetween(4, 9), false);
  assert.equal(hasUnimplementedShopRewardBetween(8, 9), false);
  assert.equal(hasUnimplementedShopRewardBetween(29, 30), false);
  assert.equal(hasUnimplementedShopRewardBetween(30, 40), false);
});

test("the store-level roadmap lists the same cumulative thresholds used by the game", async () => {
  const roadmap = await readFile(new URL("../documentation/StoreLevel.md", import.meta.url), "utf8");
  for (const { level, reputation } of SHOP_LEVEL_TIERS) {
    assert.match(roadmap, new RegExp(`\\| ${level} \\| ${reputation} \\|`));
  }
});
