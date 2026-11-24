// Reviews customers have written about the store, oldest first.
import { Slice } from "../Slice.js";

/**
 * @typedef {{ id: number, day: number, stars: number, factionId: string | null,
 *   username: string, text: string }} CustomerReview
 */

export class CustomerReviews extends Slice {
  constructor() {
    super();
    this.nextReviewId = 1;
    /** @type {CustomerReview[]} */
    this.reviews = [];
  }

  /**
   * @param {Omit<CustomerReview, "id">} review
   * @param {number} maxSaved - the oldest reviews past this many are dropped
   * @returns {CustomerReview}
   */
  add(review, maxSaved) {
    const saved = { id: this.nextReviewId, ...review };
    this.nextReviewId += 1;
    this.reviews = [...this.reviews, saved].slice(-maxSaved);
    this.changed();
    return { ...saved };
  }

  adopt(next) {
    this.nextReviewId = next.nextReviewId;
    this.reviews = next.reviews.map((review) => ({ ...review }));
  }

  toSave() {
    // Left out until the first review, so saves without reviews keep their old shape.
    if (this.reviews.length === 0 && this.nextReviewId === 1) return {};
    return {
      customerReviews: {
        nextReviewId: this.nextReviewId,
        reviews: this.reviews.map((review) => ({ ...review })),
      },
    };
  }

  /** @param {object} player - the saved player section */
  static fromSave(player) {
    const state = new CustomerReviews();
    if (player.customerReviews) {
      state.nextReviewId = player.customerReviews.nextReviewId;
      state.reviews = player.customerReviews.reviews.map((review) => ({ ...review }));
    }
    return state;
  }
}
