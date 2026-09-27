import { Debugger } from "./Debugger.js";

export class PlayerState {
  constructor() {
    this.credits = 1500;
    this.globalReputation = 2;

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
    Debugger.log(`Earned ${amount}c. New Balance: ${this.credits}c`, "#10b981");
    this.notifyListeners();
  }

  spendCredits(amount) {
    this.credits -= amount;

    if (this.credits < 0) {
      Debugger.log(
        `Spent ${amount}c. WARNING: Account in deficit! Balance: ${this.credits}c`,
        "#ef4444",
      );
    } else {
      Debugger.log(
        `Spent ${amount}c. New Balance: ${this.credits}c`,
        "#ef4444",
      );
    }

    this.notifyListeners();
    return true;
  }

  addReputation(amount, factionId = null) {
    this.globalReputation += amount;
    Debugger.log(
      `Global Reputation increased by +${amount} (Total: ${this.globalReputation})`,
      "#38bdf8",
    );

    if (factionId && this.factionReputation[factionId] !== undefined) {
      this.factionReputation[factionId] += amount;
      Debugger.log(
        `[${factionId.toUpperCase()}] Standing increased to ${this.factionReputation[factionId]}`,
        "#fbbf24",
      );
    }

    this.notifyListeners();
  }

  subReputation(amount, factionId = null) {
    this.globalReputation -= amount;
    Debugger.log(
      `Global Reputation decreased by -${amount} (Total: ${this.globalReputation})`,
      "#ef4444",
    );

    if (factionId && this.factionReputation[factionId] !== undefined) {
      this.factionReputation[factionId] -= amount;
      Debugger.log(
        `[${factionId.toUpperCase()}] Standing dropped to ${this.factionReputation[factionId]}`,
        "#ef4444",
      );
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
}
