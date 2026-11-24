// ==========================================
// FILE: ReviewsTab.js
// ==========================================
// Manager's Tablet Reviews tab: the store's rating on the review app and every review
// customers have written, newest first, filtered by stars and by day.
import { html } from "../core/html.js";
import { EXPERIENCE_TUNING, REVIEW_APP_NAME, getStoreRating, reviewsUnlocked } from "../modules/customerExperience/ExperienceRules.js";

const FACTION_LABELS = Object.freeze({
  scavengers: "Scavenger",
  mercenaries: "Mercenary",
  explorers: "Explorer",
});

/** @param {number} stars - may be fractional; rounds to the nearest whole star for display */
export function starText(stars) {
  const whole = Math.max(0, Math.min(5, Math.round(stars)));
  return "★".repeat(whole) + "☆".repeat(5 - whole);
}

/**
 * @param {{ reviews: object[], day: number, starsFilter: number | null, dayFilter: number | null }} view
 */
export function renderReviewsTab({ reviews, day, starsFilter, dayFilter }) {
  const { unlockAfterShift, ratingWindow } = EXPERIENCE_TUNING;
  if (!reviewsUnlocked(day) && reviews.length === 0) {
    return html`
      <div class="reviews-panel">
        <div class="item-card reviews-rating-card">
          <h2 class="type-h2">Your ${REVIEW_APP_NAME} Rating</h2>
          <p class="type-description">${REVIEW_APP_NAME} is the app customers use to rate and review shops.
            Customers start reviewing your store after you finish your
            ${unlockAfterShift === 1 ? "first shift" : unlockAfterShift === 2 ? "second shift" : `first ${unlockAfterShift} shifts`}.</p>
        </div>
      </div>
    `;
  }
  const rating = getStoreRating(reviews);
  const counted = Math.min(reviews.length, ratingWindow);
  const shown = reviews
    .filter((review) => (starsFilter === null || review.stars === starsFilter) &&
      (dayFilter === null || review.day === dayFilter))
    .reverse();
  const starButtons = [null, 5, 4, 3, 2, 1].map((stars) => html`
    <button type="button" class="retro-tab-btn reviews-filter-btn${stars === starsFilter ? " active" : ""}"
      data-reviews-stars="${stars ?? "all"}">${stars === null ? "All ratings" : `${stars} ★`}</button>
  `);
  const reviewDays = [...new Set(reviews.map((review) => review.day))];
  const dayIndex = dayFilter === null ? reviewDays.length : reviewDays.indexOf(dayFilter);
  const earlierDay = reviewDays[dayIndex - 1] ?? null;
  const laterDay = dayFilter === null ? null : reviewDays[dayIndex + 1] ?? "all";
  return html`
    <div class="reviews-panel">
      <div class="item-card reviews-rating-card">
        <h2 class="type-h2">Your ${REVIEW_APP_NAME} Rating</h2>
        ${rating === null
    ? html`<p class="type-description">No reviews yet. ${REVIEW_APP_NAME} is the app customers use to rate and review shops; about 1 in every ${Math.round(1 / EXPERIENCE_TUNING.reviewChance)} customers writes one when they leave.</p>`
    : html`
          <div class="reviews-rating"><span class="reviews-rating-number">${rating.toFixed(1)}</span>
            <span class="reviews-stars">${starText(rating)}</span></div>
          <p class="type-description">The average of your ${counted === 1 ? "only review" : `${counted} most recent reviews`}.
            Older reviews stop counting, so you can always win customers back.</p>`}
      </div>
      <div class="reviews-filters">
        <div class="reviews-filter-row">${starButtons}</div>
        <div class="reviews-filter-row">
          <button type="button" class="retro-tab-btn reviews-filter-btn" data-reviews-day="${earlierDay ?? ""}"
            ${earlierDay === null ? "disabled" : ""}>◀ Earlier day</button>
          <span class="reviews-day-label">${dayFilter === null ? "All days" : `Day ${dayFilter}`}</span>
          <button type="button" class="retro-tab-btn reviews-filter-btn" data-reviews-day="${laterDay ?? ""}"
            ${laterDay === null ? "disabled" : ""}>${laterDay === "all" ? "All days ▶" : "Later day ▶"}</button>
        </div>
      </div>
      <div class="reviews-list">
        ${shown.length === 0
    ? html`<p class="type-description reviews-empty">${reviews.length === 0 ? "No reviews yet." : "No reviews match these filters."}</p>`
    : shown.map((review) => html`
          <div class="item-card reviews-card">
            <div class="reviews-card-header">
              <span class="reviews-stars">${starText(review.stars)}</span>
              <span class="reviews-username">${review.username}</span>
              <span class="reviews-meta">${FACTION_LABELS[review.factionId] ?? "Customer"} · Day ${review.day}</span>
            </div>
            <p class="type-description reviews-text">${review.text}</p>
          </div>`)}
      </div>
    </div>
  `;
}

export class ReviewsTab {
  constructor(gameState) {
    this.gameState = gameState;
    this.starsFilter = null;
    this.dayFilter = null;
    this.panel = null;
    this.renderPanel = null;
  }

  draw() {
    return String(renderReviewsTab({
      reviews: this.gameState.customerReviews.reviews,
      day: this.gameState.calendar.day,
      starsFilter: this.starsFilter,
      dayFilter: this.dayFilter,
    }));
  }

  /**
   * @param {HTMLElement} panel
   * @param {HTMLElement} eventRoot
   * @param {() => string} renderPanel
   */
  bind(panel, eventRoot, renderPanel) {
    if (!panel) throw new Error("Reviews tab panel is missing");
    this.panel = panel;
    this.renderPanel = renderPanel;
    eventRoot.addEventListener("click", (event) => this.handleClick(event));
  }

  redraw() {
    if (!this.panel) return;
    const scrollTop = this.panel.querySelector(".reviews-list")?.scrollTop ?? 0;
    this.panel.innerHTML = this.renderPanel();
    const list = this.panel.querySelector(".reviews-list");
    if (list) list.scrollTop = scrollTop;
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element) || !this.panel.contains(target)) return;
    const starsButton = target.closest("[data-reviews-stars]");
    const dayButton = target.closest("[data-reviews-day]");
    if (starsButton) {
      const value = starsButton.dataset.reviewsStars;
      this.starsFilter = value === "all" ? null : Number(value);
    } else if (dayButton && !dayButton.disabled && dayButton.dataset.reviewsDay) {
      const value = dayButton.dataset.reviewsDay;
      this.dayFilter = value === "all" ? null : Number(value);
    } else return;
    this.redraw();
    this.panel.querySelector(".reviews-list")?.scrollTo?.(0, 0);
  }
}
