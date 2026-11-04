// ==========================================
// FILE: CustomerBuyLists.js
// ==========================================
// Builds each customer's shopping list from what's on the shelves: primary items matching
// their faction, plus faction-flavored bonus (impulse) items.

// Reputation thresholds are intentionally empty until the pace and value of reputation
// changes have been established through playtesting. Counts are items; bonusCount is [min, max].
export const CUSTOMER_BUY_LIST_TUNING = Object.freeze({
  reputationPrimaryThresholds: [],
  primaryCount: {
    default: 1,
    mercenaries: 2,
  },
  bonusCount: {
    default: [0, 2],
    scavengers: [2, 3],
    mercenaries: [0, 1],
  },
});

export const CUSTOMER_FACTION_IDS = Object.freeze([
  "scavengers",
  "mercenaries",
  "explorers",
]);

/**
 * Whether an item's tags suit a faction's primary wants. Unknown factions match anything.
 * @param {object} item
 * @param {string} factionId
 */
export function factionMatches(item, factionId) {
  const has = (tag) => item.tags.includes(tag);
  if (factionId === "scavengers") return has("Surplus") || has("Old");
  if (factionId === "mercenaries") {
    return ["Firearm", "Ammunition", "Armor"].some(has) &&
      ["Standard", "High-Tier", "New"].some(has);
  }
  if (factionId === "explorers") return has("Tool") || has("Survival");
  return true;
}

function randomItem(items, random) {
  if (items.length === 0) return null;
  // Clamp so a random() of exactly 1 can't index past the end.
  const index = Math.floor(Math.max(0, Math.min(1 - Number.EPSILON, random())) * items.length);
  return items[index];
}

function takeRandomItems(candidates, count, random, { uniqueWeaponTypes = false } = {}) {
  const pool = [...candidates];
  const selected = [];
  const weaponTypes = new Set();
  while (pool.length > 0 && selected.length < count) {
    const item = randomItem(pool, random);
    pool.splice(pool.indexOf(item), 1);
    const weaponType = item.tags.find((tag) =>
      ["Pistol", "Rifle", "Heavy"].includes(tag),
    );
    if (uniqueWeaponTypes && weaponType && weaponTypes.has(weaponType)) continue;
    if (weaponType) weaponTypes.add(weaponType);
    selected.push(item);
  }
  return selected;
}

/**
 * Build one customer's buy list from the items currently on shelves.
 * @param {string} factionId
 * @param {string[]} shelfItemIds
 * @param {(id: string) => object | undefined} getItem
 * @param {() => number} [random]
 * @returns {{ primaryItemIds: string[], bonusItemIds: string[], matchingAmmoIdsByFirearm: Object<string, string[]> }}
 */
export function createCustomerBuyList(factionId, shelfItemIds, getItem, random = Math.random) {
  const shelfItems = [...new Set(shelfItemIds)].map(getItem).filter(Boolean);
  const factionItems = shelfItems.filter((item) => factionMatches(item, factionId));
  const primaryCount = CUSTOMER_BUY_LIST_TUNING.primaryCount[factionId] ??
    CUSTOMER_BUY_LIST_TUNING.primaryCount.default;

  const primary = takeRandomItems(factionItems, primaryCount, random, {
    uniqueWeaponTypes: factionId === "mercenaries",
  });
  const primaryIds = new Set(primary.map((item) => item.id));

  const bonusSource = factionId === "mercenaries" ? factionItems : shelfItems;
  let bonusCandidates = bonusSource.filter((item) => !primaryIds.has(item.id));
  // Scavengers impulse-buy survival/apparel; explorers add tools, survival, standard firearms.
  if (factionId === "scavengers") {
    const impulseBuyCandidates = bonusCandidates.filter((item) =>
      item.tags.includes("Survival") || item.tags.includes("Apparel"),
    );
    bonusCandidates = impulseBuyCandidates.length > 0
      ? impulseBuyCandidates
      : factionItems.filter((item) => !primaryIds.has(item.id));
  } else if (factionId === "explorers") {
    bonusCandidates = shelfItems.filter((item) =>
      !primaryIds.has(item.id) &&
      (item.tags.includes("Tool") || item.tags.includes("Survival") ||
        (item.tags.includes("Firearm") && item.tags.includes("Standard"))),
    );
  }

  const [minimumBonus, maximumBonus] =
    CUSTOMER_BUY_LIST_TUNING.bonusCount[factionId] ??
    CUSTOMER_BUY_LIST_TUNING.bonusCount.default;
  const bonusCount = minimumBonus +
    Math.floor(Math.max(0, Math.min(1 - Number.EPSILON, random())) *
      (maximumBonus - minimumBonus + 1));
  const bonus = takeRandomItems(bonusCandidates, bonusCount, random);

  // Mercenaries also want ammo for any firearm they could buy here.
  const matchingAmmoIdsByFirearm = {};
  if (factionId === "mercenaries") {
    for (const firearm of shelfItems.filter((item) => item.tags.includes("Firearm"))) {
      if (!firearm.ammo) continue;
      matchingAmmoIdsByFirearm[firearm.id] = shelfItems
        .filter((item) =>
          item.tags.includes("Ammunition") &&
          (item.ammo === firearm.ammo || item.name.startsWith(`${firearm.ammo}:`)),
        )
        .map((item) => item.id);
    }
  }

  return {
    primaryItemIds: primary.map((item) => item.id),
    bonusItemIds: bonus.map((item) => item.id),
    matchingAmmoIdsByFirearm,
  };
}
