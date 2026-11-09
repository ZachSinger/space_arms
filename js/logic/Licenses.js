// ==========================================
// FILE: Licenses.js
// ==========================================
// A Supplier License from Licenses.json: level/reputation requirements, cost, and fixtures.
import { isKnownShopLevel } from "./ShopProgression.js";

export class SupplierLicense {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.description = data.description;
    this.tier = data.tier;
    this.baseCost = data.baseCost;
    this.requiredShopLevel = data.requiredShopLevel ?? 1;
    if (!isKnownShopLevel(this.requiredShopLevel)) {
      throw new Error(`Unknown Shop Level for supplier license ${data.id}.`);
    }
    this.reqReputation = data.reqReputation;
    if (this.reqReputation !== null && !Number.isSafeInteger(this.reqReputation)) {
      throw new TypeError(`Invalid store reputation requirement for supplier license ${data.id}.`);
    }
    this.reqFaction = data.reqFaction || null;
    this.reqFactionRep = data.reqFactionRep || 0;
    this.unlocksFixtures = data.unlocksFixtures || [];
  }

  /**
   * Whether the player meets the shop level, store, and faction reputation requirements.
   * @param {PlayerState} playerState
   */
  isUnlocked(playerState) {
    const levelMet = playerState.shopLevel >= this.requiredShopLevel;
    const globalMet = this.reqReputation === null ||
      playerState.globalReputation >= this.reqReputation;
    const factionMet =
      !this.reqFaction ||
      playerState.factionReputation[this.reqFaction] >= this.reqFactionRep;

    return levelMet && globalMet && factionMet;
  }

  canAfford(playerState) {
    return playerState.credits >= this.baseCost;
  }
}
