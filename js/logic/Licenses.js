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
  }

  /**
   * Check if the player meets all reputation requirements to buy this license.
   * @param {PlayerState} playerState
   */
  isUnlocked(playerState) {
    const globalMet = playerState.globalReputation >= this.reqReputation;
    const factionMet =
      !this.reqFaction ||
      playerState.factionReputation[this.reqFaction] >= this.reqFactionRep;

    return globalMet && factionMet;
  }

  /**
   * Check if the player has enough credits to buy this license.
   * @param {PlayerState} playerState
   */
  canAfford(playerState) {
    return playerState.credits >= this.baseCost;
  }
}
