// ==========================================
// FILE: boot.js
// ==========================================
// First scene: loads static data and every image asset, fills the shared item/license
// database, then hands off to the title scene.
import Phaser from "phaser";
import { DatabaseManager } from "../logic/DatabaseManager.js";
import tilesetManifest from "../../data/TilesetManifest.json";
import customerSpriteManifest from "../../data/CustomerSpriteManifest.json";

// The game-wide static data lookup, imported by logic modules as `database`.
export const database = new DatabaseManager();

export class BootScene extends Phaser.Scene {
  constructor() {
    super("scene-boot");
  }

  preload() {
    this.load.json("items", "data/Items.json");
    this.load.json("iconset", "data/IconSet.json");
    this.load.json("licenses", "data/Licenses.json");
    this.load.atlas("item-icons", "img/IconSet.png", "data/IconSet.json");

    // Every floor/wall/fixture tile; RoomLayout.js and TileRoom.js build the map from these keys.
    tilesetManifest.forEach(({ key, path }) => this.load.image(key, path));
    this.load.image("fixture_crate_01", "img/Generated/fixture_crate_01.png");

    // Every customer sprite (4 facings per character); see CustomerSprites.js.
    customerSpriteManifest.forEach(({ key, path }) => this.load.image(key, path));
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
