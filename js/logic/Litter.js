// ==========================================
// FILE: Litter.js
// ==========================================
// Store cleanliness (documentation/modules/Cleaning.md): how clean the store can be, how
// clean it is, and how each customer judges it.

export const CLEANLINESS_BASE = 20;
export const CLEANLINESS_PER_EXPANSION = 20;
export const CLEANLINESS_PER_LEVEL = 2;
export const CLEANLINESS_LEVEL_FLOOR = 5;
export const TRASH_PENALTY = 1;
export const DIRT_PENALTY = 2;

// Unpaused ms after entering before a customer decides how clean the store is.
export const CLEANLINESS_JUDGE_MS = 3000;
// Chance each customer drops one piece of trash during their visit.
export const TRASH_DROP_CHANCE = 0.4;
// Range (ms of walking, including the walk out) for when that trash falls.
export const TRASH_DROP_WALK_MS = Object.freeze([1000, 6000]);
export const TRASH_KINDS = Object.freeze(["can", "paper", "box"]);
export const UPSET_REPUTATION_LOSS = 1;
export const WALK_OUT_REPUTATION_LOSS = 2;

// Percent of the maximum cleanliness below which a customer is upset / walks out.
export const CLEANLINESS_TOLERANCES = Object.freeze({
  scavengers: Object.freeze({ upset: [40, 60], walkOut: [10, 25] }),
  civilian: Object.freeze({ upset: [55, 75], walkOut: [25, 40] }),
  mercenaries: Object.freeze({ upset: [65, 85], walkOut: [35, 50] }),
  explorers: Object.freeze({ upset: [75, 95], walkOut: [45, 60] }),
});

/**
 * @param {{ salesExpansions: number, shopLevel: number }} store
 * @returns {number}
 */
export function getCleanlinessMax({ salesExpansions, shopLevel }) {
  return CLEANLINESS_BASE + CLEANLINESS_PER_EXPANSION * Math.max(0, salesExpansions) +
    CLEANLINESS_PER_LEVEL * Math.max(0, shopLevel - CLEANLINESS_LEVEL_FLOOR);
}

export function getCleanlinessScore(max, trashCount, dirtCount = 0) {
  return Math.max(0, max - trashCount * TRASH_PENALTY - dirtCount * DIRT_PENALTY);
}

/**
 * @param {string | null} factionId - null for regular customers
 * @param {() => number} [random]
 * @returns {{ upsetBelow: number, walkOutBelow: number }} percents
 */
export function rollCleanlinessTolerance(factionId, random = Math.random) {
  const ranges = CLEANLINESS_TOLERANCES[factionId] ?? CLEANLINESS_TOLERANCES.civilian;
  const roll = ([min, max]) => min + random() * (max - min);
  return { upsetBelow: roll(ranges.upset), walkOutBelow: roll(ranges.walkOut) };
}

/**
 * @param {number} percent - store cleanliness, 0-100
 * @param {{ upsetBelow: number, walkOutBelow: number }} tolerance
 * @returns {"fine" | "upset" | "walk-out"}
 */
export function judgeCleanliness(percent, tolerance) {
  if (percent < tolerance.walkOutBelow) return "walk-out";
  if (percent < tolerance.upsetBelow) return "upset";
  return "fine";
}

/**
 * Whether saved trash is a list of known pieces inside the map.
 * @param {unknown} trash
 * @param {{ width: number, height: number }} world - px
 */
export function isValidTrashList(trash, world) {
  return Array.isArray(trash) && trash.every((piece) => piece && typeof piece === "object" &&
    TRASH_KINDS.includes(piece.kind) &&
    Number.isFinite(piece.x) && piece.x >= 0 && piece.x <= world.width &&
    Number.isFinite(piece.y) && piece.y >= 0 && piece.y <= world.height);
}
