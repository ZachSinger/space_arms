// ==========================================
// FILE: Items.js
// ==========================================
// A sellable item definition from Items.json.
export class StoreItem {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.flavor = data.flavor;
    this.tags = data.tags; // e.g. ['Firearm', 'Standard', 'Rifle']
    this.boxSize = data.boxSize;
    this.baseCost = data.baseCost; // credits; hidden base for Market prices
    this.supplyPercent = data.supplyPercent; // supplier charges this % of baseCost per unit

    // Optional fields, absent on most items.
    this.license = data.license || null; // Supplier License id required to order this item
    this.ammo = data.ammo || null; // what a gun shoots, or what an ammo box contains
    this.count = data.count || null; // rounds in an ammo box
    this.fits = data.fits || []; // tags/weapons an attachment can snap onto
    this.image = data.image || null; // detail-view art path (relative to project root)
    // Deleted in the dev tools: kept in the data so old saves still load, but never offered in game.
    this.hidden = data.hidden === true;
  }

  hasTag(tagString) {
    return this.tags.includes(tagString);
  }
}
