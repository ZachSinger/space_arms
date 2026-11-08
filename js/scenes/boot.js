// ==========================================
// FILE: boot.js
// ==========================================
// First scene: loads static data and every image asset, fills the shared item/license
// database, then hands off to the title scene.
import Phaser from "phaser";
import { DatabaseManager } from "../logic/DatabaseManager.js";
import tilesetManifest from "../../data/TilesetManifest.json";
import customerSpriteManifest from "../../data/CustomerSpriteManifest.json";
import { SCIFI_SHEETS, registerShopTiles } from "../logic/ShopTiles.js";

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
    SCIFI_SHEETS.forEach(({ key, path }) => this.load.image(key, path));

    // Every customer sprite (4 facings per character); see CustomerSprites.js.
    customerSpriteManifest.forEach(({ key, path }) => this.load.image(key, path));
  }

  create() {
    const rawItems = this.cache.json.get("items");
    const rawIconset = this.cache.json.get("iconset");
    const rawLicenses = this.cache.json.get("licenses");

    database.loadItemsJSON(rawItems);
    database.loadLicensesJSON(rawLicenses);
    if (!registerShopTiles(this.textures)) console.warn("Sci-fi tileset missing from img/Tilesets/scifi/");

    this.scene.start("scene-title");
  }
}
