// ==========================================
// FILE: CustomerTraits.js
// ==========================================
// Traits are small rule sets that together make up a customer's personality. Every
// customer has their group's trait (Scavenger, Mercenary, or Explorer) and may roll extra
// personality traits that change how they shop and wait. A trait with `appearsWhen` only
// enters the pool once the store meets its condition.

export const BASE_PATIENCE_MS = 40000;

export const CUSTOMER_TRAITS = Object.freeze({
  scavengers: Object.freeze({ id: "scavengers", name: "Scavenger", group: true }),
  mercenaries: Object.freeze({ id: "mercenaries", name: "Mercenary", group: true }),
  explorers: Object.freeze({ id: "explorers", name: "Explorer", group: true }),
  // Also browses this share of the other shelves, mixed in with the ones they came for.
  wanderer: Object.freeze({ id: "wanderer", name: "Wanderer", chance: 0.3, browseShare: 0.5 }),
  impatient: Object.freeze({ id: "impatient", name: "Impatient", chance: 0.25, patienceMultiplier: 0.6 }),
  // Only shows up in a well-stocked store; adds extra items from anything on the shelves.
  browser: Object.freeze({
    id: "browser",
    name: "Browser",
    chance: 0.3,
    extraBonusItems: 2,
    appearsWhen: ({ shelfCount = 0, itemVariety = 0 } = {}) => shelfCount >= 4 || itemVariety >= 8,
  }),
});

const PERSONALITY_TRAITS = Object.values(CUSTOMER_TRAITS).filter((trait) => !trait.group);

/**
 * @param {string | null} groupId - the customer's faction id
 * @param {() => number} [random]
 * @param {{ shelfCount?: number, itemVariety?: number }} [store] - for appearance conditions
 * @returns {string[]} trait ids, group first
 */
export function rollCustomerTraits(groupId, random = Math.random, store = {}) {
  const traits = groupId && CUSTOMER_TRAITS[groupId]?.group ? [groupId] : [];
  for (const trait of PERSONALITY_TRAITS) {
    if (trait.appearsWhen && !trait.appearsWhen(store)) continue;
    if (random() < trait.chance) traits.push(trait.id);
  }
  return traits;
}

/**
 * @param {string[]} traitIds
 * @returns {number} ms a customer will wait in line
 */
export function getPatienceMs(traitIds) {
  return Math.round(traitIds.reduce((ms, id) =>
    ms * (CUSTOMER_TRAITS[id]?.patienceMultiplier ?? 1), BASE_PATIENCE_MS));
}

/**
 * The shelves to visit while looking for wanted items. Wanderers add shelves they have no
 * reason to visit, scaling with how many the store has, and walk them in a random order.
 * @param {object[]} wantedStops - shelf stops holding wanted items
 * @param {object[]} allStops - the stocked shelf stops in the store
 * @param {string[]} traitIds
 * @param {() => number} [random]
 * @returns {object[]}
 */
export function planShelfRoute(wantedStops, allStops, traitIds, random = Math.random) {
  const share = traitIds.reduce((total, id) => total + (CUSTOMER_TRAITS[id]?.browseShare ?? 0), 0);
  if (share <= 0) return wantedStops;
  const wanted = new Set(wantedStops.map(({ fixture }) => fixture));
  const others = shuffle(allStops.filter(({ fixture }) => !wanted.has(fixture)), random);
  const browsing = others.slice(0, Math.min(others.length, Math.ceil(others.length * share)));
  return shuffle([...wantedStops, ...browsing], random);
}

/**
 * Optional items plus any extras traits like Browser pick from everything on the shelves,
 * regardless of what the customer's group usually buys.
 * @param {{ primaryItemIds: string[], bonusItemIds: string[] }} buyList
 * @param {string[]} shelfItemIds - every item assigned to a shelf spot
 * @param {string[]} traitIds
 * @param {() => number} [random]
 * @returns {string[]}
 */
export function addTraitBonusItems(buyList, shelfItemIds, traitIds, random = Math.random) {
  const extraCount = traitIds.reduce((total, id) =>
    total + (CUSTOMER_TRAITS[id]?.extraBonusItems ?? 0), 0);
  if (extraCount <= 0) return buyList.bonusItemIds;
  const taken = new Set([...buyList.primaryItemIds, ...buyList.bonusItemIds]);
  const candidates = shuffle([...new Set(shelfItemIds)].filter((id) => !taken.has(id)), random);
  return [...buyList.bonusItemIds, ...candidates.slice(0, extraCount)];
}

function shuffle(list, random) {
  const result = [...list];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}
