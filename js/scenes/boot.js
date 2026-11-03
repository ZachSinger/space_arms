import Phaser from "phaser";
import { DatabaseManager } from "../logic/DatabaseManager.js";
import tilesetManifest from "../../data/TilesetManifest.json";
import customerSpriteManifest from "../../data/CustomerSpriteManifest.json";

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

    // Bulk-load every extracted floor/wall/fixture tile; see RoomLayout.js /
    // TileRoom.js for how these keys get used to build the shop map.
    tilesetManifest.forEach(({ key, path }) => this.load.image(key, path));
    this.load.image("fixture_crate_01", "img/Generated/fixture_crate_01.png");

    // Bulk-load every extracted customer sprite (4 facings x however many characters
    // passed review); see Customer.js for how these keys get picked/swapped per customer.
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
