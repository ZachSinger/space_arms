export class StoreItem {
  constructor(data) {
    // Core Properties (Shared by 100% of items)
    this.id = data.id;
    this.name = data.name;
    this.flavor = data.flavor;
    this.tags = data.tags; // e.g., ['Firearm', 'Standard', 'Rifle']
    this.dimensions = data.dimensions; // e.g., { w: 2, h: 1 }
    this.stackSize = data.stackSize;
    this.baseCost = data.baseCost;

    // Conditional Properties (Safely default to null/empty if not present)
    this.ammo = data.ammo || null; // String: What a gun shoots, or what an ammo box contains
    this.count = data.count || null; // Number: How many rounds are in an ammo box
    this.fits = data.fits || []; // Array: What tags/weapons an attachment can snap onto
  }

  // Example Helper Method:
  hasTag(tagString) {
    return this.tags.includes(tagString);
  }
}
