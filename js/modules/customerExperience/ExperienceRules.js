// How a customer's visit turns into a star rating and a written review. Pure functions only:
// the system gathers what happened during the visit, these rules decide what it was worth.
import reviewData from "../../../data/CustomerReviews.json" with { type: "json" };
import experienceTuning from "../../../data/tuning/customerExperience.json" with { type: "json" };
import { loadTuning } from "../../core/Tuning.js";

export const EXPERIENCE_TUNING = loadTuning("customerExperience", experienceTuning);
export const REVIEW_APP_NAME = reviewData.appName;
export const REVIEW_USERNAMES = Object.freeze([...reviewData.usernames]);
export const REVIEW_LINES = reviewData.lines;
export const REVIEW_CLOSERS = reviewData.closers;

// Each note's effect on a 5-star visit before the customer type adjusts it.
const NOTE_VALUES = Object.freeze({
  gaveUpInLine: -3,
  longWait: -1.25,
  someWait: -0.5,
  fastCheckout: 0.25,
  crowded: -0.5,
  missingItem: -1.25,
  leftEmptyHanded: -0.75,
  hunting: -0.25,
  priceDisgust: -2,
  tooExpensive: -0.75,
  bargain: 0.5,
  dirtyWalkout: -2.5,
  dirty: -0.75,
  drab: -0.5,
  gorgeous: 0.5,
  crateHit: -1.5,
  stuck: -1,
  changeMistake: -0.75,
  leftAngry: -1.5,
});

const NOTE_CATEGORIES = Object.freeze({
  gaveUpInLine: "wait", longWait: "wait", someWait: "wait", fastCheckout: "wait", crowded: "wait",
  missingItem: "stock", leftEmptyHanded: "stock", hunting: "stock",
  priceDisgust: "price", tooExpensive: "price", bargain: "price",
  dirtyWalkout: "cleanliness", dirty: "cleanliness",
  drab: "presentation", gorgeous: "presentation",
  crateHit: "safety", stuck: "safety",
  changeMistake: "service", leftAngry: "service",
});

// What each kind of customer cares about more (above 1) or less (below 1) than usual.
const FACTION_WEIGHTS = Object.freeze({
  scavengers: { price: 1.5, cleanliness: 0.6, presentation: 0.5 },
  mercenaries: { wait: 1.4, stock: 1.3, price: 0.8, presentation: 0.8, safety: 0.7 },
  explorers: { presentation: 1.4, stock: 1.2, cleanliness: 1.1, wait: 0.8 },
  civilian: { cleanliness: 1.3, safety: 1.5, service: 1.2 },
});

const MISSING_EXTRA_PER_ITEM = 0.25;
const MAX_MISSING_EXTRA = 0.75;
const MAX_CHANGE_MISTAKES_COUNTED = 2;
const CLOSER_CHANCE = 0.3;
const RECENT_USERNAMES_AVOIDED = 20;

/**
 * @typedef {object} VisitFacts
 * @property {string | null} factionId
 * @property {boolean} bought - paid for something
 * @property {boolean} leftAngry
 * @property {boolean} gaveUpInLine - left because waiting in line ran out their patience
 * @property {number} queueWaitMs
 * @property {number} maxPatienceMs
 * @property {number | null} firstQueuePosition - people ahead when they joined a line
 * @property {string[]} missingItemNames - wanted items that were out of stock everywhere
 * @property {number} shelvesNeeded - shelves holding something on their shopping list
 * @property {string[]} priceReactions - "bargain", "skipped", "disgusted"
 * @property {"fine" | "upset" | "walk-out" | null} cleanlinessVerdict
 * @property {number | null} presentationPercent
 * @property {number | null} presentationExpectation
 * @property {boolean} hitByCrate
 * @property {boolean} gotStuck
 * @property {number} checkoutMistakes - wrong change handed over
 */

/** @param {string | null} factionId */
export function reviewerKind(factionId) {
  return factionId && FACTION_WEIGHTS[factionId] ? factionId : "civilian";
}

/**
 * Every notable thing about the visit, with how much it moved the score for this customer.
 * @param {VisitFacts} facts
 * @returns {{ id: string, value: number, vars?: { item: string } }[]}
 */
export function getVisitNotes(facts) {
  const tuning = EXPERIENCE_TUNING;
  const notes = [];
  const add = (id, value = NOTE_VALUES[id], vars = undefined) => notes.push({ id, value, ...(vars ? { vars } : {}) });
  const waitShare = facts.maxPatienceMs > 0 ? facts.queueWaitMs / facts.maxPatienceMs : 0;
  if (facts.gaveUpInLine) add("gaveUpInLine");
  else if (facts.bought && waitShare >= tuning.longWaitFraction) add("longWait");
  else if (facts.bought && waitShare >= tuning.someWaitFraction) add("someWait");
  else if (facts.bought && waitShare < tuning.fastCheckoutFraction) add("fastCheckout");
  if ((facts.firstQueuePosition ?? 0) >= tuning.crowdedLinePosition) add("crowded");

  if (facts.missingItemNames.length > 0) {
    const extra = Math.min(MAX_MISSING_EXTRA, (facts.missingItemNames.length - 1) * MISSING_EXTRA_PER_ITEM);
    add("missingItem", NOTE_VALUES.missingItem - extra, { item: facts.missingItemNames[0] });
  }
  if (!facts.bought && !facts.leftAngry && facts.cleanlinessVerdict !== "walk-out") add("leftEmptyHanded");
  if (facts.shelvesNeeded >= tuning.huntingShelfCount) add("hunting");

  if (facts.priceReactions.includes("disgusted")) add("priceDisgust");
  else if (facts.priceReactions.includes("skipped")) add("tooExpensive");
  if (facts.priceReactions.includes("bargain")) add("bargain");

  if (facts.cleanlinessVerdict === "walk-out") add("dirtyWalkout");
  else if (facts.cleanlinessVerdict === "upset") add("dirty");

  if (facts.presentationPercent != null && facts.presentationExpectation != null) {
    if (facts.presentationPercent < facts.presentationExpectation) add("drab");
    else if (facts.presentationPercent >= facts.presentationExpectation + tuning.gorgeousMargin) add("gorgeous");
  }

  if (facts.hitByCrate) add("crateHit");
  if (facts.gotStuck) add("stuck");
  if (facts.checkoutMistakes > 0) {
    add("changeMistake", NOTE_VALUES.changeMistake * Math.min(facts.checkoutMistakes, MAX_CHANGE_MISTAKES_COUNTED));
  }
  // Storming out for a reason no other note explains (for example, failing a Chit three times).
  const explained = ["gaveUpInLine", "priceDisgust", "stuck", "changeMistake"]
    .some((id) => notes.some((note) => note.id === id));
  if (facts.leftAngry && !explained) add("leftAngry");

  const weights = FACTION_WEIGHTS[reviewerKind(facts.factionId)];
  return notes.map((note) => ({ ...note, value: note.value * (weights[NOTE_CATEGORIES[note.id]] ?? 1) }));
}

/**
 * @param {{ value: number }[]} notes
 * @returns {number} whole stars from 1 to 5
 */
export function getVisitStars(notes) {
  const total = notes.reduce((sum, note) => sum + note.value, 0);
  return Math.max(1, Math.min(5, Math.round(5 + total)));
}

/**
 * @template T
 * @param {readonly T[]} list
 * @param {() => number} random
 * @returns {T}
 */
function pick(list, random) {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/**
 * @param {{ id: string, vars?: { item: string } }} note
 * @param {() => number} random
 */
function noteLine(note, random) {
  const item = note.vars?.item ?? "";
  return pick(REVIEW_LINES[note.id], random)
    .replaceAll("{item}", item)
    .replaceAll("{ITEM}", item.toUpperCase());
}

/**
 * A short, funny review about the things that mattered most on this visit.
 * @param {{ id: string, value: number, vars?: { item: string } }[]} notes
 * @param {number} stars
 * @param {string | null} factionId
 * @param {() => number} random
 */
export function writeReview(notes, stars, factionId, random) {
  const byImpact = notes.filter((note) => REVIEW_LINES[note.id])
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const bad = byImpact.filter((note) => note.value < 0);
  const good = byImpact.filter((note) => note.value > 0);
  // Unhappy reviews pile on the worst parts; middling ones weigh the best against the worst.
  const chosen = stars <= 2 ? bad.slice(0, 2)
    : stars <= 4 ? [...good.slice(0, 1), ...bad.slice(0, 1)]
      : good.slice(0, 1);
  const sentences = chosen.length > 0
    ? chosen.map((note) => noteLine(note, random))
    : [pick(REVIEW_LINES[`generic${stars}`], random)];
  if (random() < CLOSER_CHANCE) sentences.push(pick(REVIEW_CLOSERS[reviewerKind(factionId)], random));
  return sentences.join(" ");
}

/**
 * A username not used by the most recent reviewers, when one is available.
 * @param {string[]} recentUsernames - oldest first
 * @param {() => number} random
 */
export function pickUsername(recentUsernames, random) {
  const recent = new Set(recentUsernames.slice(-RECENT_USERNAMES_AVOIDED));
  const fresh = REVIEW_USERNAMES.filter((name) => !recent.has(name));
  return pick(fresh.length > 0 ? fresh : REVIEW_USERNAMES, random);
}

/**
 * The store's rating: the average of the most recent reviews, to one decimal place.
 * @param {{ stars: number }[]} reviews - oldest first
 * @param {number} [window]
 * @returns {number | null} null before the first review
 */
export function getStoreRating(reviews, window = EXPERIENCE_TUNING.ratingWindow) {
  const recent = reviews.slice(-window);
  if (recent.length === 0) return null;
  return Math.round(recent.reduce((sum, review) => sum + review.stars, 0) / recent.length * 10) / 10;
}

/**
 * Reviews begin once enough shifts are finished. Each day has one shift.
 * @param {number} day - the current day
 */
export function reviewsUnlocked(day) {
  return day - 1 >= EXPERIENCE_TUNING.unlockAfterShift;
}
