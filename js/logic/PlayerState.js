export class PlayerState {
  constructor() {
    this.credits = 1500;
    this.globalReputation = 2;
    // Customers who never entered the store because it was already at capacity (see
    // GameScene.MAX_CUSTOMERS_IN_STORE) -- lost sales, not merely delayed ones.
    this.customersTurnedAway = 0;

    // Factions strictly adhere to the MVP Tag Taxonomy. No Military.
    this.factionReputation = {
      scavengers: 0,
      mercenaries: 0,
      explorers: 0,
    };

    this.activeLicenses = new Set(); // Stores IDs of signed licenses
    this.listeners = [];
  }

  addCredits(amount) {
    this.credits += amount;
    this.notifyListeners();
  }

  spendCredits(amount) {
    this.credits -= amount;
    this.notifyListeners();
    return true;
  }

  addReputation(amount, factionId = null) {
    this.globalReputation += amount;

    if (factionId && this.factionReputation[factionId] !== undefined) {
      this.factionReputation[factionId] += amount;
    }

    this.notifyListeners();
  }

  subReputation(amount, factionId = null) {
    this.globalReputation -= amount;

    if (factionId && this.factionReputation[factionId] !== undefined) {
      this.factionReputation[factionId] -= amount;
    }

    this.notifyListeners();
  }

  signLicense(licenseId) {
    this.activeLicenses.add(licenseId);
    this.notifyListeners();
  }

  subscribe(callback) {
    this.listeners.push(callback);
    callback(this);
  }

  notifyListeners() {
    this.listeners.forEach((callback) => callback(this));
  }

  serialize() {
    return {
      credits: this.credits,
      globalReputation: this.globalReputation,
      factionReputation: { ...this.factionReputation },
      activeLicenses: [...this.activeLicenses],
      customersTurnedAway: this.customersTurnedAway,
    };
  }

  static deserialize(data) {
    const state = new PlayerState();
    Object.assign(state, data, {
      activeLicenses: new Set(data.activeLicenses),
    });
    return state;
  }
}
