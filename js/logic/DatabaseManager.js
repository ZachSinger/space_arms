// ==========================================
// FILE: DatabaseManager.js
// ==========================================
// In-memory lookup of static game data (items and supplier licenses) loaded from JSON at boot.
// The shared instance is exported from scenes/boot.js as `database`.
import { StoreItem } from "./Items.js";
import { SupplierLicense } from "./Licenses.js";

export class DatabaseManager {
  constructor() {
    this.items = new Map();
    this.itemList = [];
    this.licenses = new Map();
    this.licenseList = [];
  }

  /**
   * @param {object[]} jsonArray - parsed Items.json
   */
  loadItemsJSON(jsonArray) {
    let loadedCount = 0;
    jsonArray.forEach((data) => {
      const newItem = new StoreItem(data);
      this.items.set(newItem.id, newItem);
      this.itemList.push(newItem);
      loadedCount++;
    });
  }

  /**
   * @param {object[]} jsonArray - parsed Licenses.json
   */
  loadLicensesJSON(jsonArray) {
    let loadedCount = 0;
    jsonArray.forEach((data) => {
      const newLicense = new SupplierLicense(data);
      this.licenses.set(newLicense.id, newLicense);
      this.licenseList.push(newLicense);
      loadedCount++;
    });
  }

  getAllItems() {
    return this.itemList;
  }

  getItem(id) {
    return this.items.get(id);
  }

  getAllLicenses() {
    return this.licenseList;
  }

  getLicense(id) {
    return this.licenses.get(id);
  }
}
