// Customer Experience: every customer quietly rates their visit, and about one in eight writes
// a review the player can read on the Manager's Tablet. Ratings are flavor and feedback only.
import { GAME_EVENTS } from "../../core/Events.js";
import { gameRandom } from "../../core/Random.js";
import {
  EXPERIENCE_TUNING, getStoreRating, getVisitNotes, getVisitStars, pickUsername, reviewsUnlocked, writeReview,
} from "./ExperienceRules.js";

export class CustomerExperienceSystem {
  /**
   * @param {object} shop - the game scene
   * @param {() => number} [random]
   */
  constructor(shop, random = gameRandom) {
    this.id = "customerExperience";
    this.shop = shop;
    this.random = random;
    /** @type {WeakMap<object, { bought: boolean, leftAngry: boolean, hitByCrate: boolean, missingItemNames: string[] }>} */
    this.visits = new WeakMap();
    this.subscriptions = shop.eventBus.group();
    this.subscriptions.on(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, ({ customer }) => { this.visit(customer).bought = true; });
    this.subscriptions.on(GAME_EVENTS.CUSTOMER_LEFT_ANGRY, ({ customer }) => { this.visit(customer).leftAngry = true; });
    this.subscriptions.on(GAME_EVENTS.CUSTOMER_HIT_BY_CRATE, ({ customer }) => { this.visit(customer).hitByCrate = true; });
    this.subscriptions.on(GAME_EVENTS.CUSTOMER_MISSING_PRIMARY, ({ customer, itemNames }) => {
      this.visit(customer).missingItemNames = [...itemNames];
    });
    this.subscriptions.on(GAME_EVENTS.CUSTOMER_EXITED, ({ customer }) => this.handleExit(customer));
  }

  visit(customer) {
    let visit = this.visits.get(customer);
    if (!visit) {
      visit = { bought: false, leftAngry: false, hitByCrate: false, missingItemNames: [] };
      this.visits.set(customer, visit);
    }
    return visit;
  }

  get unlocked() {
    return reviewsUnlocked(this.shop.gameState.calendar.day);
  }

  /** @returns {number | null} the store's star rating, or null before the first review */
  get rating() {
    return getStoreRating(this.shop.gameState.customerReviews.reviews);
  }

  /** @returns {import("./ExperienceRules.js").VisitFacts} */
  collectFacts(customer) {
    const visit = this.visit(customer);
    const presentation = this.shop.gameModules?.get("presentation") ?? null;
    return {
      factionId: customer.factionId ?? null,
      bought: visit.bought,
      leftAngry: visit.leftAngry,
      gaveUpInLine: Boolean(customer.gaveUpInLine),
      queueWaitMs: customer.queueWaitMs ?? 0,
      maxPatienceMs: customer.maxPatienceMs ?? 0,
      firstQueuePosition: customer.firstQueuePosition ?? null,
      missingItemNames: visit.missingItemNames,
      shelvesNeeded: customer.shoppingPlan?.shelfStops?.length ?? 0,
      priceReactions: [...(customer.priceReactionKinds ?? [])],
      cleanlinessVerdict: customer.cleanlinessVerdict ?? null,
      presentationPercent: presentation && customer.presentationExpectation != null
        ? presentation.getPresentationPercent() : null,
      presentationExpectation: customer.presentationExpectation ?? null,
      hitByCrate: visit.hitByCrate,
      gotStuck: Boolean(customer.gotStuck),
      checkoutMistakes: customer.checkoutMistakes ?? 0,
    };
  }

  handleExit(customer) {
    const { gameState } = this.shop;
    const facts = this.collectFacts(customer);
    this.visits.delete(customer);
    if (this.shop.sandbox || !this.unlocked || this.random() >= EXPERIENCE_TUNING.reviewChance) return null;
    const notes = getVisitNotes(facts);
    const stars = getVisitStars(notes);
    const reviews = gameState.customerReviews.reviews;
    return gameState.customerReviews.add({
      day: gameState.calendar.day,
      stars,
      factionId: facts.factionId,
      username: pickUsername(reviews.map((review) => review.username), this.random),
      text: writeReview(notes, stars, facts.factionId, this.random),
    }, EXPERIENCE_TUNING.maxSavedReviews);
  }

  destroy() {
    this.subscriptions.off();
  }
}
