import Phaser from "phaser";
import { DatabaseManager } from "../logic/DatabaseManager.js";

export const database = new DatabaseManager();

export class BootScene extends Phaser.Scene {
  constructor() {
    super("scene-boot");
  }

  preload() {
    this.load.json("items", "data/Items.json");
    this.load.json("iconset", "data/IconSet.json");
    this.load.json("licenses", "data/Licenses.json");
    this.load.atlas(
      "item-icons",
      "img/IconSet.png",
      "data/IconSet.json",
    );
  }

  create() {
    const rawItems = this.cache.json.get("items");
    const rawIconset = this.cache.json.get("iconset");
    const rawLicenses = this.cache.json.get("licenses");

    database.loadItemsJSON(rawItems);
    database.loadLicensesJSON(rawLicenses);
    this.scene.start("scene-title");
  }
}
