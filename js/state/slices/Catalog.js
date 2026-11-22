// ==========================================
// FILE: Catalog.js
// ==========================================
// What the shop may sell and for how much: signed supplier contracts, the player's own price per
// item, and which customer types the stocked contracts bring in.
import { Slice } from "../Slice.js";
import { isMoney } from "../../logic/Money.js";

// Always owned, so the basic fixtures stay usable and purchasable.
export const STARTING_LICENSE = "lic_fixture_basics";

export class Catalog extends Slice {
  constructor() {
    super();
    /** @type {Set<string>} */
    this.licenses = new Set([STARTING_LICENSE]);
    // The player's own retail price per item id.
    /** @type {Record<string, number>} */
    this.storePrices = {};
    /** @type {Set<string>} */
    this.marketPricePinnedItems = new Set();
    // Worked out from the shop's stock, never saved.
    /** @type {Set<string>} */
    this.activeFactions = new Set();
  }

  /** @param {string} licenseId */
  owns(licenseId) {
    return this.licenses.has(licenseId);
  }

  /** @param {string} licenseId */
  sign(licenseId) {
    this.licenses.add(licenseId);
    this.changed();
  }

  /**
   * @param {string} itemId
   * @param {number} price
   */
  setPrice(itemId, price) {
    if (!isMoney(price) || price < 1) throw new TypeError(`Invalid store price: ${price}.`);
    this.marketPricePinnedItems.delete(itemId);
    this.storePrices[itemId] = price;
    this.changed();
  }

  /**
   * @param {string} itemId
   * @param {boolean} pinned
   * @param {number} marketPrice
   */
  setMarketPricePinned(itemId, pinned, marketPrice) {
    if (typeof pinned !== "boolean") throw new TypeError("Market price pin must be a boolean.");
    if (pinned && (!isMoney(marketPrice) || marketPrice < 1)) {
      throw new TypeError(`Invalid market price: ${marketPrice}.`);
    }
    if (pinned) {
      this.marketPricePinnedItems.add(itemId);
      this.storePrices[itemId] = marketPrice;
    } else {
      this.marketPricePinnedItems.delete(itemId);
    }
    this.changed();
  }

  /** @param {{ getPrice: (itemId: string) => number }} market */
  syncPinnedMarketPrices(market) {
    let updated = false;
    for (const itemId of this.marketPricePinnedItems) {
      const price = market.getPrice(itemId);
      if (!isMoney(price) || price < 1) throw new TypeError(`Invalid market price for ${itemId}.`);
      if (this.storePrices[itemId] === price) continue;
      this.storePrices[itemId] = price;
      updated = true;
    }
    if (updated) this.changed();
  }

  /**
   * Gives a newly stocked item a starting price, unless it already has one.
   * @param {string} itemId
   * @param {number} price
   */
  priceIfUnset(itemId, price) {
    if (this.storePrices[itemId] !== undefined) return;
    this.storePrices[itemId] = price;
    this.changed();
  }

  /** @param {Iterable<string>} factionIds */
  setActiveFactions(factionIds) {
    this.activeFactions = new Set(factionIds);
  }

  toSave() {
    return {
      activeLicenses: [...this.licenses],
      contractsSplit: true,
      storePrices: { ...this.storePrices },
      marketPricePinnedItems: [...this.marketPricePinnedItems],
    };
  }

  /** @param {object} data - the saved player section, already upgraded */
  static fromSave(data) {
    const catalog = new Catalog();
    catalog.licenses = new Set([...data.activeLicenses, STARTING_LICENSE]);
    catalog.storePrices = { ...data.storePrices };
    catalog.marketPricePinnedItems = new Set(data.marketPricePinnedItems ?? []);
    return catalog;
  }
}
