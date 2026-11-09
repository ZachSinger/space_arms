// Total store reputation required at shift end; tune these values after playtesting.
const SHOP_LEVEL_REPUTATION = [
  0, 15, 35, 60, 90, 125, 165, 210, 260, 315,
  375, 440, 510, 585, 665, 750, 840, 935, 1035, 1140,
  1250, 1365, 1485, 1610, 1740, 1875, 2015, 2160, 2310, 2465,
];

export const IMPLEMENTED_SHOP_REWARD_LEVELS = Object.freeze(
  Array.from({ length: 29 }, (_, index) => index + 2),
);

export function hasUnimplementedShopRewardBetween(previousLevel, currentLevel) {
  return SHOP_LEVEL_TIERS.some(({ level }) =>
    level > previousLevel &&
    level <= currentLevel &&
    level > 1 &&
    !IMPLEMENTED_SHOP_REWARD_LEVELS.includes(level));
}

export const SHOP_LEVEL_TIERS = Object.freeze(
  SHOP_LEVEL_REPUTATION.map((reputation, index) =>
    Object.freeze({ level: index + 1, reputation })),
);

export function isKnownShopLevel(level) {
  return SHOP_LEVEL_TIERS.some((tier) => tier.level === level);
}

export function getShopLevelForReputation(reputation) {
  if (!Number.isSafeInteger(reputation)) {
    throw new TypeError(`Invalid store reputation: ${reputation}.`);
  }
  return SHOP_LEVEL_TIERS.reduce(
    (level, tier) => reputation >= tier.reputation ? tier.level : level,
    SHOP_LEVEL_TIERS[0].level,
  );
}

export function getShopLevelRequirement(level) {
  const tier = SHOP_LEVEL_TIERS.find((candidate) => candidate.level === level);
  if (!tier) throw new Error(`Unknown Shop Level: ${level}.`);
  return tier.reputation;
}

export function getNextShopLevel(level) {
  return SHOP_LEVEL_TIERS.find((tier) => tier.level > level) ?? null;
}
