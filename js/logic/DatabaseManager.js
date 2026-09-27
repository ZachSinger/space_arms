import { StoreItem } from "./Items.js";
import { SupplierLicense } from "./Licenses.js";
import { Debugger } from "./Debugger.js";

// ==========================================
// FILE: DatabaseManager.js
// ==========================================
export class DatabaseManager {
  constructor() {
    this.items = new Map();
    this.itemList = [];
    this.licenses = new Map();
    this.licenseList = [];
  }

  // Pass the parsed JSON array directly into here
  loadItemsJSON(jsonArray) {
    let loadedCount = 0;
    jsonArray.forEach((data) => {
      const newItem = new StoreItem(data);
      this.items.set(newItem.id, newItem);
      this.itemList.push(newItem);
      loadedCount++;
    });
    Debugger.log(
      `Database loaded ${loadedCount} items successfully.`,
      "#10b981",
    );
  }

  loadLicensesJSON(jsonArray) {
    let loadedCount = 0;
    jsonArray.forEach((data) => {
      const newLicense = new SupplierLicense(data);
      this.licenses.set(newLicense.id, newLicense);
      this.licenseList.push(newLicense);
      loadedCount++;
    });
    Debugger.log(
      `Database loaded ${loadedCount} licenses successfully.`,
      "#10b981",
    );
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
