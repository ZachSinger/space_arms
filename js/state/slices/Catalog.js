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
    this.storePrices[itemId] = price;
    this.changed();
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
    };
  }

  /** @param {object} data - the saved player section, already upgraded */
  static fromSave(data) {
    const catalog = new Catalog();
    catalog.licenses = new Set([...data.activeLicenses, STARTING_LICENSE]);
    catalog.storePrices = { ...data.storePrices };
    return catalog;
  }
}
