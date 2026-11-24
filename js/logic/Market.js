// ==========================================
// FILE: Market.js
// ==========================================
// Galactic average market price per item. Each item's Items.json baseCost is a hidden base
// price, never shown. The market price random-walks once per day from the previous day's
// price, clamped to a band around the hidden base so it can't drift off forever.
import { roundMoney } from "./Money.js";
import { gameRandom } from "../core/Random.js";
import { Slice } from "../state/Slice.js";

// Daily random-walk swing (fraction of price) and the clamp band (multiples of base).
export const DAILY_SWING = 0.1;
export const MIN_BASE_RATIO = 0.5;
export const MAX_BASE_RATIO = 2;
// Which day it is lives in the Calendar slice; the market only knows today's prices.
export class Market extends Slice {
  /**
   * @param {object[]} items
   * @param {() => number} [random]
   * @param {{ prices: object } | null} [saved] - restores without new random draws
   */
  constructor(items, random = gameRandom, saved = null) {
    super();
    this.random = random;
    this.basePrices = new Map(items.map((item) => [item.id, item.baseCost]));
    // Each item's supplier price per unit is set by hand in Items.json as a % of base (supplyPercent).
    this.supplyCosts = new Map(items.map((item) => [item.id, (item.baseCost * item.supplyPercent) / 100]));
    if (saved) {
      this.prices = new Map(Object.entries(saved.prices));
      return;
    }
    this.prices = new Map();
    // Day 1 is already one swing away from base so the opening price doesn't reveal it.
    for (const [itemId, basePrice] of this.basePrices) {
      this.prices.set(itemId, this.nextPrice(basePrice, basePrice));
    }
  }

  nextPrice(previousPrice, basePrice) {
    const change = 1 + (this.random() * 2 - 1) * DAILY_SWING;
    const clamped = Math.min(
      basePrice * MAX_BASE_RATIO,
      Math.max(basePrice * MIN_BASE_RATIO, previousPrice * change),
    );
    return Math.max(1, roundMoney(clamped));
  }

  getPrice(itemId) {
    return this.prices.get(itemId) ?? 0;
  }

  /**
   * @param {string} itemId
   * @param {number} quantity
   * @returns {number} credits (at least 1), from the item's supplier price
   */
  getSupplyCost(itemId, quantity) {
    return Math.max(1, Math.round((this.supplyCosts.get(itemId) ?? 0) * quantity));
  }

  advanceDay() {
    for (const [itemId, basePrice] of this.basePrices) {
      this.prices.set(itemId, this.nextPrice(this.prices.get(itemId), basePrice));
    }
    this.changed();
  }

  serialize() {
    return { prices: Object.fromEntries(this.prices) };
  }
}
