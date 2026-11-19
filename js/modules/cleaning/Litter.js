import cleaningTuning from "../../../data/tuning/cleaning.json" with { type: "json" };
import { gameRandom } from "../../core/Random.js";
import { loadTuning } from "../../core/Tuning.js";
// ==========================================
// FILE: Litter.js
// ==========================================
// Store cleanliness (documentation/modules/Cleaning.md): how clean the store can be, how
// clean it is, and how each customer judges it.

export const CLEANING_TUNING = loadTuning("cleaning", cleaningTuning);
export const CLEANLINESS_BASE = CLEANING_TUNING.cleanlinessBase;
export const CLEANLINESS_PER_EXPANSION = CLEANING_TUNING.cleanlinessPerSalesExpansion;
export const CLEANLINESS_PER_LEVEL = CLEANING_TUNING.cleanlinessPerLevelAboveFloor;
export const CLEANLINESS_LEVEL_FLOOR = CLEANING_TUNING.cleanlinessLevelFloor;
export const TRASH_PENALTY = CLEANING_TUNING.trashPenalty;
export const DIRT_PENALTY = CLEANING_TUNING.dirtPenalty;

// Unpaused ms after entering before a customer decides how clean the store is.
export const CLEANLINESS_JUDGE_MS = CLEANING_TUNING.cleanlinessJudgeMs;
// Chance each customer drops one piece of trash during their visit.
export const TRASH_DROP_CHANCE = CLEANING_TUNING.trashDropChance;
// Range (ms of walking, including the walk out) for when that trash falls.
export const TRASH_DROP_WALK_MS = CLEANING_TUNING.trashDropWalkMs;
export const TRASH_KINDS = Object.freeze(["can", "paper", "box"]);
export const UPSET_REPUTATION_LOSS = CLEANING_TUNING.upsetReputationLoss;
export const WALK_OUT_REPUTATION_LOSS = CLEANING_TUNING.walkOutReputationLoss;

// Percent of the maximum cleanliness below which a customer is upset / walks out.
const tolerance = (faction) => Object.freeze({
  upset: CLEANING_TUNING[`${faction}UpsetPercent`],
  walkOut: CLEANING_TUNING[`${faction}WalkOutPercent`],
});
export const CLEANLINESS_TOLERANCES = Object.freeze({
  scavengers: tolerance("scavengers"),
  civilian: tolerance("civilian"),
  mercenaries: tolerance("mercenaries"),
  explorers: tolerance("explorers"),
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
export function rollCleanlinessTolerance(factionId, random = gameRandom) {
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
