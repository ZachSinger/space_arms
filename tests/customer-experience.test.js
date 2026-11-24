import assert from "node:assert/strict";
import test from "node:test";
import {
  REVIEW_CLOSERS, REVIEW_LINES, REVIEW_USERNAMES, getStoreRating, getVisitNotes, getVisitStars,
  pickUsername, reviewsUnlocked, writeReview,
} from "../js/modules/customerExperience/ExperienceRules.js";
import { CustomerReviews } from "../js/state/slices/CustomerReviews.js";
import { renderReviewsTab } from "../js/logic/ReviewsTab.js";

const visit = (facts = {}) => ({
  factionId: null, bought: true, leftAngry: false, gaveUpInLine: false,
  queueWaitMs: 2000, maxPatienceMs: 10000, firstQueuePosition: 0,
  missingItemNames: [], shelvesNeeded: 1, priceReactions: [], cleanlinessVerdict: "fine",
  presentationPercent: null, presentationExpectation: null,
  hitByCrate: false, gotStuck: false, checkoutMistakes: 0, ...facts,
});
const starsFor = (facts) => getVisitStars(getVisitNotes(visit(facts)));
const ids = (facts) => getVisitNotes(visit(facts)).map((note) => note.id);

test("a smooth visit is 5 stars and problems pull the rating down", () => {
  assert.equal(starsFor({}), 5);
  assert.equal(starsFor({ queueWaitMs: 7000 }), 4);
  assert.equal(starsFor({ gaveUpInLine: true, leftAngry: true, bought: false }), 2);
  assert.equal(starsFor({
    gaveUpInLine: true, leftAngry: true, bought: false, hitByCrate: true, cleanlinessVerdict: "upset",
  }), 1);
});

test("leaving angry only counts on its own when nothing else explains it", () => {
  assert.deepEqual(ids({ leftAngry: true, bought: false }), ["leftAngry"]);
  assert.ok(!ids({ leftAngry: true, bought: false, gaveUpInLine: true }).includes("leftAngry"));
  assert.ok(!ids({ leftAngry: true, checkoutMistakes: 3 }).includes("leftAngry"));
});

test("each kind of customer cares about different things", () => {
  const priceHit = (factionId) => getVisitNotes(visit({ factionId, priceReactions: ["disgusted"] }))[0].value;
  assert.ok(priceHit("scavengers") < priceHit(null));
  assert.ok(priceHit("mercenaries") > priceHit(null));
  const looks = { presentationPercent: 10, presentationExpectation: 50 };
  const drab = (factionId) => getVisitNotes(visit({ factionId, ...looks })).find((note) => note.id === "drab").value;
  assert.ok(drab("explorers") < drab("scavengers"));
});

test("an out-of-stock review names the missing item", () => {
  const notes = getVisitNotes(visit({ missingItemNames: ["Plasma Rifle"], bought: false }));
  const text = writeReview(notes, getVisitStars(notes), null, () => 0);
  assert.match(text, /plasma rifle/i);
  assert.doesNotMatch(text, /\{item\}|\{ITEM\}/);
});

test("a visit with nothing notable gets a general line for its star level", () => {
  const text = writeReview([], 3, "mercenaries", () => 0.99);
  assert.ok(REVIEW_LINES.generic3.includes(text));
});

test("the store rating averages only the most recent reviews", () => {
  assert.equal(getStoreRating([]), null);
  const reviews = [...Array(10).fill({ stars: 1 }), ...Array(20).fill({ stars: 5 })];
  assert.equal(getStoreRating(reviews, 20), 5);
  assert.equal(getStoreRating([{ stars: 4 }, { stars: 5 }, { stars: 5 }], 20), 4.7);
});

test("reviews start after the second shift", () => {
  assert.equal(reviewsUnlocked(2), false);
  assert.equal(reviewsUnlocked(3), true);
});

test("usernames avoid the latest reviewers", () => {
  const recent = REVIEW_USERNAMES.slice(0, 20);
  for (const roll of [0, 0.5, 0.999]) assert.ok(!recent.includes(pickUsername(recent, () => roll)));
});

test("every review line and username is written out", () => {
  const all = [...Object.values(REVIEW_LINES).flat(), ...Object.values(REVIEW_CLOSERS).flat(), ...REVIEW_USERNAMES];
  assert.ok(all.every((line) => typeof line === "string" && line.trim().length > 0));
  for (let stars = 1; stars <= 5; stars += 1) assert.ok(REVIEW_LINES[`generic${stars}`].length > 0);
});

test("saved reviews keep only the newest ones and reload exactly", () => {
  const reviews = new CustomerReviews();
  assert.deepEqual(reviews.toSave(), {});
  for (let day = 3; day <= 5; day += 1) {
    reviews.add({ day, stars: 4, factionId: null, username: "A", text: "Fine." }, 2);
  }
  assert.deepEqual(reviews.reviews.map((review) => review.id), [2, 3]);
  const saved = JSON.parse(JSON.stringify(reviews.toSave()));
  assert.deepEqual(CustomerReviews.fromSave(saved).toSave(), saved);
});

test("the Reviews tab filters reviews and never lets review text become markup", () => {
  const reviews = [
    { id: 1, day: 3, stars: 2, factionId: null, username: "<b>Bad</b>", text: "<script>x</script>" },
    { id: 2, day: 4, stars: 5, factionId: "explorers", username: "Happy", text: "Lovely." },
  ];
  const all = String(renderReviewsTab({ reviews, day: 4, starsFilter: null, dayFilter: null }));
  assert.match(all, /&lt;b&gt;Bad&lt;\/b&gt;/);
  assert.doesNotMatch(all, /<script>/);
  assert.ok(all.indexOf("Happy") < all.indexOf("&lt;b&gt;"), "newest first");
  const fives = String(renderReviewsTab({ reviews, day: 4, starsFilter: 5, dayFilter: null }));
  assert.ok(fives.includes("Happy") && !fives.includes("Bad"));
  const dayThree = String(renderReviewsTab({ reviews, day: 4, starsFilter: null, dayFilter: 3 }));
  assert.ok(dayThree.includes("Bad") && !dayThree.includes("Happy"));
  assert.match(String(renderReviewsTab({ reviews: [], day: 1, starsFilter: null, dayFilter: null })), /second shift/);
});
