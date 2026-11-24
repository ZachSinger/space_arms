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
// Supplier cost per unit is a hidden, per-item fraction of base, the same in every game.
// A single shared fraction would let the player divide the Supply price back into the base.
export const MIN_SUPPLY_RATIO = 0.4;
export const MAX_SUPPLY_RATIO = 0.6;

/** @param {string} itemId @returns {number} fixed ratio derived from the id (FNV-1a hash) */
export function supplyRatioFor(itemId) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < itemId.length; i++) {
    hash = Math.imul(hash ^ itemId.charCodeAt(i), 0x01000193) >>> 0;
  }
  const fraction = Math.round((hash / 0xffffffff) * 100) / 100;
  return MIN_SUPPLY_RATIO + fraction * (MAX_SUPPLY_RATIO - MIN_SUPPLY_RATIO);
}

// Which day it is lives in the Calendar slice; the market only knows today's prices.
export class Market extends Slice {
  /**
   * @param {object[]} items
   * @param {() => number} [random]
   * @param {{ prices: object, supplyRatios: object } | null} [saved] - restores without new random draws
   */
  constructor(items, random = gameRandom, saved = null) {
    super();
    this.random = random;
    this.basePrices = new Map(items.map((item) => [item.id, item.baseCost]));
    this.supplyRatios = new Map(items.map((item) => [item.id, supplyRatioFor(item.id)]));
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
   * @returns {number} credits (at least 1), from the hidden base and per-item supply ratio
   */
  getSupplyCost(itemId, quantity) {
    const basePrice = this.basePrices.get(itemId) ?? 0;
    const ratio = this.supplyRatios.get(itemId) ?? 0;
    return Math.max(1, Math.round(basePrice * ratio * quantity));
  }

  advanceDay() {
    for (const [itemId, basePrice] of this.basePrices) {
      this.prices.set(itemId, this.nextPrice(this.prices.get(itemId), basePrice));
    }
    this.changed();
  }

  serialize() {
    return {
      prices: Object.fromEntries(this.prices),
      supplyRatios: Object.fromEntries(this.supplyRatios),
    };
  }
}
