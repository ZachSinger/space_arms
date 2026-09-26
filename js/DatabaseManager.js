// import { StoreItem } from "./Items.js";
// import { Debugger } from "./Debugger.js";

// ==========================================
// FILE: DatabaseManager.js
// ==========================================
export class DatabaseManager {
  constructor() {
    this.items = new Map();
    this.itemList = [];
  }

  // Pass the parsed JSON array directly into here
  loadJSON(jsonArray) {
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

  getAllItems() {
    return this.itemList;
  }

  getItem(id) {
    return this.items.get(id);
  }
}
