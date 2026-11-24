// Total store reputation required at shift end. Serving every arriving customer without
// penalties earns Levels 2-5 in four shifts; later steps take several shifts.
const SHOP_LEVEL_REPUTATION = [
  0, 20, 50, 90, 138, 318, 507, 705, 912, 1128,
  1353, 1587, 1830, 2082, 2343, 2613, 2892, 3180, 3477, 3783,
  4098, 4422, 4755, 5097, 5448, 5808, 6177, 6555, 6942, 7338,
  7743, 8157, 8580, 9012, 9453, 9903, 10362, 10830, 11307, 11793,
    12288, 12792, 13305, 13827, 14358, 14898, 15447, 16005, 16572, 17148,
];

// Includes levels intentionally without a reward.
export const IMPLEMENTED_SHOP_REWARD_LEVELS = Object.freeze(
  Array.from({ length: SHOP_LEVEL_REPUTATION.length - 1 }, (_, index) => index + 2),
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

// Each listed Store Level adds one more employee the shop can have hired at once.
export const STAFF_LIMIT_LEVELS = Object.freeze([4, 7, 10, 15, 18, 23]);

export function getStaffLimit(shopLevel) {
  return STAFF_LIMIT_LEVELS.filter((level) => level <= shopLevel).length;
}

export function getNextStaffLimitLevel(shopLevel) {
  return STAFF_LIMIT_LEVELS.find((level) => level > shopLevel) ?? null;
}

/**
 * Player-facing reason no one else can be hired, or null when a staff spot is open.
 * @param {number} shopLevel
 * @param {number} hiredCount
 */
export function getStaffLimitReason(shopLevel, hiredCount) {
  const limit = getStaffLimit(shopLevel);
  if (hiredCount < limit) return null;
  const nextLevel = getNextStaffLimitLevel(shopLevel);
  const howToGrow = nextLevel
    ? `Reach Shop Level ${nextLevel} by finishing a shift with at least ${getShopLevelRequirement(nextLevel)} store reputation to hire ${limit ? "one more" : "your first employee"}.`
    : "Your shop can't hire more staff.";
  const current = limit
    ? `Your shop can have ${limit} employee${limit === 1 ? "" : "s"} hired at once, and you have hired ${hiredCount}.`
    : "Your shop can't have employees yet.";
  return `${current} ${howToGrow}`;
}
