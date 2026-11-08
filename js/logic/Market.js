// ==========================================
// FILE: Market.js
// ==========================================
// Galactic average market price per item. Each item's Items.json baseCost is a hidden base
// price, never shown. The market price random-walks once per day from the previous day's
// price, clamped to a band around the hidden base so it can't drift off forever.
import { roundMoney } from "./Money.js";

// Daily random-walk swing (fraction of price) and the clamp band (multiples of base).
export const DAILY_SWING = 0.1;
export const MIN_BASE_RATIO = 0.5;
export const MAX_BASE_RATIO = 2;
// Supplier cost per unit is a hidden, per-item fraction of base fixed for the whole game.
// A single shared fraction would let the player divide the Supply price back into the base.
export const MIN_SUPPLY_RATIO = 0.4;
export const MAX_SUPPLY_RATIO = 0.6;

export class Market {
  constructor(items, random = Math.random) {
    this.random = random;
    this.day = 1;
    this.basePrices = new Map(items.map((item) => [item.id, item.baseCost]));
    this.supplyRatios = new Map(
      items.map((item) => [
        item.id,
        MIN_SUPPLY_RATIO + random() * (MAX_SUPPLY_RATIO - MIN_SUPPLY_RATIO),
      ]),
    );
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
    this.day += 1;
    for (const [itemId, basePrice] of this.basePrices) {
      this.prices.set(itemId, this.nextPrice(this.prices.get(itemId), basePrice));
    }
  }

  serialize() {
    return {
      day: this.day,
      prices: Object.fromEntries(this.prices),
      supplyRatios: Object.fromEntries(this.supplyRatios),
    };
  }

  applySave(data) {
    this.day = data.day;
    this.prices = new Map(Object.entries(data.prices));
    this.supplyRatios = new Map(Object.entries(data.supplyRatios));
  }
}
