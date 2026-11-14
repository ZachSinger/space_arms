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
    this.dimensions = data.dimensions; // e.g. { w: 2, h: 1 }
    this.slots = data.slots; // storage/shelf slots per unit (1 = smallest, 5 = largest)
    this.stackSize = data.stackSize;
    this.boxSize = data.boxSize;
    this.baseCost = data.baseCost; // credits; hidden base for Market prices

    // Optional fields, absent on most items.
    this.license = data.license || null; // Supplier License id required to order this item
    this.ammo = data.ammo || null; // what a gun shoots, or what an ammo box contains
    this.count = data.count || null; // rounds in an ammo box
    this.fits = data.fits || []; // tags/weapons an attachment can snap onto
    this.image = data.image || null; // detail-view art path (relative to project root)
  }

  hasTag(tagString) {
    return this.tags.includes(tagString);
  }
}
