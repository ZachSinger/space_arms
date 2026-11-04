// ==========================================
// FILE: Licenses.js
// ==========================================
// A Supplier License from Licenses.json: reputation requirements, cost, and fixture unlocks.
export class SupplierLicense {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.description = data.description;
    this.tier = data.tier;
    this.baseCost = data.baseCost;
    this.reqReputation = data.reqReputation;
    this.reqFaction = data.reqFaction || null;
    this.reqFactionRep = data.reqFactionRep || 0;
    this.unlocksFixtures = data.unlocksFixtures || [];
  }

  /**
   * Whether the player meets the global and faction reputation requirements.
   * @param {PlayerState} playerState
   */
  isUnlocked(playerState) {
    const globalMet = playerState.globalReputation >= this.reqReputation;
    const factionMet =
      !this.reqFaction ||
      playerState.factionReputation[this.reqFaction] >= this.reqFactionRep;

    return globalMet && factionMet;
  }

  canAfford(playerState) {
    return playerState.credits >= this.baseCost;
  }
}
