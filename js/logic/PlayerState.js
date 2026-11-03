import { InventoryPool } from "./InventoryPool.js";

// Hovercart capacity (bible: "an abstract character/employee inventory size, not a
// physical moving entity on the map") -- deliberately smaller than either fixture's own
// capacity (30/20 -- see game.js), since this represents what one character can
// personally carry at a time, not a whole shelf or storage locker.
export const HOVERCART_CAPACITY = 10;

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

    // The player's own retail price per item id (credits per unit).
    this.storePrices = {};

    // The player's own carrying capacity -- same InventoryPool model as a physical
    // StorageFixture (ShopInventory.js), just not drawn anywhere on the map. Lets stock
    // be withdrawn from one fixture and deposited into another (see FixtureWindow).
    this.hovercart = new InventoryPool({ capacity: HOVERCART_CAPACITY, stock: [] });

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

  setStorePrice(itemId, price) {
    this.storePrices[itemId] = price;
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
      storePrices: { ...this.storePrices },
      customersTurnedAway: this.customersTurnedAway,
      hovercart: {
        capacity: this.hovercart.capacity,
        stock: this.hovercart.stock.filter((entry) => entry.quantity > 0).map((entry) => ({ ...entry })),
      },
    };
  }

  static deserialize(data) {
    const state = new PlayerState();
    state.applySave(data);
    return state;
  }

  applySave(data) {
    Object.assign(this, {
      credits: data.credits,
      globalReputation: data.globalReputation,
      factionReputation: { ...data.factionReputation },
      customersTurnedAway: data.customersTurnedAway,
      activeLicenses: new Set(data.activeLicenses),
      storePrices: { ...data.storePrices },
      hovercart: new InventoryPool({
        capacity: data.hovercart?.capacity ?? HOVERCART_CAPACITY,
        stock: (data.hovercart?.stock || []).map((entry) => ({ ...entry })),
      }),
    });
    this.notifyListeners();
  }
}
