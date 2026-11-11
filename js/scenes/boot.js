// ==========================================
// FILE: boot.js
// ==========================================
// First scene: loads static data and every image asset, fills the shared item/license
// database, then hands off to the title scene.
import Phaser from "phaser";
import { DatabaseManager } from "../logic/DatabaseManager.js";
import tilesetManifest from "../../data/TilesetManifest.json";
import { loadCustomerCharacters, registerCustomerAnimations } from "../logic/CustomerSprites.js";
import { SHOP_ATLAS, registerShopTiles } from "../logic/ShopTiles.js";
import { STORE_DOOR_SPRITE } from "../logic/SlidingDoor.js";
import { PLAYER_SPRITE, registerPlayerAnimations } from "../logic/Player.js";

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
    this.load.spritesheet(PLAYER_SPRITE.key, PLAYER_SPRITE.path, {
      frameWidth: PLAYER_SPRITE.frameWidth,
      frameHeight: PLAYER_SPRITE.frameHeight,
    });

    // Every floor/wall/fixture tile; RoomLayout.js and TileRoom.js build the map from these keys.
    tilesetManifest.forEach(({ key, path }) => this.load.image(key, path));
    this.load.image("fixture_crate_01", "img/Generated/fixture_crate_01.png");
    this.load.image(SHOP_ATLAS.key, SHOP_ATLAS.path);
    this.load.spritesheet(STORE_DOOR_SPRITE.key, STORE_DOOR_SPRITE.path, {
      frameWidth: STORE_DOOR_SPRITE.frameWidth,
      frameHeight: STORE_DOOR_SPRITE.frameHeight,
    });

    // Every customer walk sheet (one character each); see CustomerSprites.js.
    loadCustomerCharacters(this.load);
  }

  create() {
    this.textures.get(PLAYER_SPRITE.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get(STORE_DOOR_SPRITE.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    registerPlayerAnimations(this.anims);
    registerCustomerAnimations(this.textures, this.anims);
    for (const { key } of tilesetManifest) {
      if (key.startsWith("shelf_category_") || key.startsWith("shelf_budget_")) {
        this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }
    const rawItems = this.cache.json.get("items");
    const rawIconset = this.cache.json.get("iconset");
    const rawLicenses = this.cache.json.get("licenses");

    database.loadItemsJSON(rawItems);
    database.loadLicensesJSON(rawLicenses);
    if (!registerShopTiles(this.textures)) console.warn(`Shop tile art missing: ${SHOP_ATLAS.path}`);

    this.scene.start("scene-title");
  }
}
