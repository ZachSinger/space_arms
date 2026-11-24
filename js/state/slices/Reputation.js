// ==========================================
// FILE: Reputation.js
// ==========================================
// Store and faction reputation, the shop level it earns, and this shift's tally. Gains and losses
// during a shift wait in `pending` and only count once the shift is over.
import { Slice } from "../Slice.js";
import { getShopLevelForReputation } from "../../logic/ShopProgression.js";
import { CUSTOMER_FACTION_IDS } from "../../logic/CustomerBuyLists.js";
import { DecisionRules } from "../DecisionRules.js";

function emptyFactions() {
  return Object.fromEntries(CUSTOMER_FACTION_IDS.map((id) => [id, 0]));
}

function emptyTally() {
  return { global: 0, factions: emptyFactions() };
}

export class Reputation extends Slice {
  constructor(rules = new DecisionRules()) {
    super();
    this.rules = rules;
    this.global = 0;
    this.factions = emptyFactions();
    this.pending = emptyTally();
    this.shopLevel = 1;
    // Customers lost because the store was at capacity: lost sales, not delayed ones.
    this.customersTurnedAway = 0;
  }

  /**
   * Tally store reputation, and the faction's too when one is given.
   * @param {number} amount
   * @param {string | null} [factionId]
   * @param {{ customer?: object }} [context]
   */
  gain(amount, factionId = null, context = {}) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new TypeError(`Reputation gain must be a non-negative whole number, got ${amount}.`);
    }
    if (!this.rules.permits("reputation.gain", { ...context, amount, factionId })) return false;
    this.#tally(amount, factionId);
    return true;
  }

  lose(amount, factionId = null) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new TypeError(`Reputation loss must be a non-negative whole number, got ${amount}.`);
    }
    this.#tally(-amount, factionId);
  }

  #tally(change, factionId) {
    const global = this.pending.global + change;
    const faction = factionId && this.pending.factions[factionId] !== undefined
      ? this.pending.factions[factionId] + change
      : null;
    if (!Number.isSafeInteger(global) || (faction !== null && !Number.isSafeInteger(faction))) {
      throw new RangeError("Pending reputation exceeds the supported range.");
    }
    this.pending.global = global;
    if (faction !== null) this.pending.factions[factionId] = faction;
    this.changed();
  }

  turnAwayCustomer() {
    this.customersTurnedAway += 1;
    this.changed();
  }

  startShift() {
    this.customersTurnedAway = 0;
    this.changed();
  }

  // Only the test room skips ahead.
  /** @param {number} level */
  setShopLevel(level) {
    this.shopLevel = level;
    this.changed();
  }

  /**
   * What the shift's tally would make the totals, or throws if they're out of range. Nothing changes.
   * @returns {{ global: number, factions: Record<string, number> }}
   */
  totalsAfterShift() {
    const global = this.global + this.pending.global;
    const factions = Object.fromEntries(Object.entries(this.factions)
      .map(([id, reputation]) => [id, reputation + (this.pending.factions[id] ?? 0)]));
    if (!Number.isSafeInteger(global) || !Object.values(factions).every(Number.isSafeInteger)) {
      throw new RangeError("Shift reputation exceeds the supported range.");
    }
    return { global, factions };
  }

  /** @param {{ global: number, factions: Record<string, number> }} totals - from totalsAfterShift */
  applyShift(totals) {
    this.global = totals.global;
    this.factions = totals.factions;
    this.pending = emptyTally();
    this.shopLevel = Math.max(this.shopLevel, getShopLevelForReputation(totals.global));
    this.changed();
  }

  toSave() {
    return {
      globalReputation: this.global,
      shopLevel: this.shopLevel,
      factionReputation: { ...this.factions },
      pendingReputation: { global: this.pending.global, factions: { ...this.pending.factions } },
      customersTurnedAway: this.customersTurnedAway,
    };
  }

  adopt(next) {
    this.global = next.global;
    this.factions = { ...next.factions };
    this.pending = {
      global: next.pending.global,
      factions: { ...next.pending.factions },
    };
    this.shopLevel = next.shopLevel;
    this.customersTurnedAway = next.customersTurnedAway;
  }

  /** @param {object} data - the saved player section */
  static fromSave(data, rules = new DecisionRules()) {
    const reputation = new Reputation(rules);
    reputation.global = data.globalReputation;
    reputation.shopLevel = Math.max(data.shopLevel ?? 1, getShopLevelForReputation(data.globalReputation));
    reputation.factions = { ...data.factionReputation };
    reputation.pending = data.pendingReputation
      ? { global: data.pendingReputation.global, factions: { ...data.pendingReputation.factions } }
      : emptyTally();
    reputation.customersTurnedAway = data.customersTurnedAway;
    return reputation;
  }
}
