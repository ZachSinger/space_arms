// =============================================================================
// FILE: CatalogSystem.js
// =============================================================================
// What the shop sells: the player's prices, the Inventory tab's per-item counts, and which
// customer factions the owned licenses bring in.
// =============================================================================

import { database } from "../scenes/boot.js";
import { isMoney, roundMoney } from "../logic/Money.js";
import { getLicensedFactionIds } from "../logic/CustomerPooling.js";
import { getCrateOrderQuantity } from "../logic/SupplyOrder.js";

export class CatalogSystem {
  constructor(shop) {
    this.shop = shop;
  }

  /**
   * The player's own price, falling back to today's market price if never set.
   * @param {string} itemId
   * @returns {number}
   */
  getStorePrice(itemId) {
    const { catalog, market } = this.shop.gameState;
    return catalog.storePrices[itemId] ?? market.getPrice(itemId);
  }

  /**
   * Accepts prices to the cent and rejects anything below 1.
   * @param {string} itemId
   * @param {number} price
   * @returns {boolean} whether the price was accepted
   */
  setStorePrice(itemId, price) {
    if (!isMoney(price) || price < 1) {
      this.shop.messages.show("Enter a price of at least 1, with no more than two decimal places.");
      return false;
    }
    this.shop.gameState.catalog.setPrice(itemId, price);
    return true;
  }

  /** @param {string} itemId @param {boolean} pinned */
  setMarketPricePinned(itemId, pinned) {
    const { catalog, market } = this.shop.gameState;
    catalog.setMarketPricePinned(itemId, pinned, market.getPrice(itemId));
  }

  // Inventory tab rows: every owned item, including items currently held by customers.
  getInventoryItems() {
    const shop = this.shop;
    const totals = new Map();
    const add = (entry, column) => {
      if (!entry.itemId || entry.quantity <= 0) return;
      if (!totals.has(entry.itemId)) {
        totals.set(entry.itemId, { offShelves: 0, stock: 0, inCustomerCarts: 0 });
      }
      totals.get(entry.itemId)[column] += entry.quantity;
    };

    for (const fixture of shop.fixtures.shelves()) {
      for (const entry of fixture.stock) add(entry, "stock");
    }
    for (const entry of shop.gameState.goBacks.stock) add(entry, "offShelves");
    const floorCrates = shop.crateSystem.getFloorCrates();
    for (const crate of floorCrates) add(crate, "offShelves");
    for (const crate of shop.crateSystem.getCarriedCrates()) {
      if (crate.kind === "item") add(crate, "offShelves");
    }
    for (const employee of shop.employees ?? []) {
      const crate = employee.currentJob?.crate;
      if (crate?.isCarried && !floorCrates.includes(crate)) add(crate, "offShelves");
    }
    for (const customer of shop.customers) {
      if (customer.state === "LEAVING") continue;
      for (const { itemId } of customer.cart) {
        add({ itemId, quantity: 1 }, "inCustomerCarts");
      }
    }
    return database.getAllItems()
      .filter((item) => totals.has(item.id))
      .map((item) => ({
        item,
        ...totals.get(item.id),
        marketPrice: shop.gameState.market.getPrice(item.id),
        unitCost: roundMoney(shop.supply.crateCost(item) / getCrateOrderQuantity(item)),
        storePrice: this.getStorePrice(item.id),
        marketPricePinned: shop.gameState.catalog.marketPricePinnedItems?.has(item.id) ?? false,
      }));
  }

  // Customer factions follow the player's licenses.
  recalculateActiveFactions() {
    const catalog = this.shop.gameState.catalog;
    catalog.setActiveFactions(getLicensedFactionIds(catalog.licenses, database.getAllItems()));
  }
}
