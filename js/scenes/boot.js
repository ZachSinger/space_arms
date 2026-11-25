// ==========================================
// FILE: boot.js
// ==========================================
// First scene: loads static data and every image asset, fills the shared item/license
// database, then hands off to the title scene.
import Phaser from "phaser";
import { DatabaseManager } from "../logic/DatabaseManager.js";
import tilesetManifest from "../../data/TilesetManifest.json";
import { loadCustomerCharacters, registerCustomerAnimations } from "../logic/CustomerSprites.js";
import { loadEmployeeCharacters, registerEmployeeAnimations } from "../logic/EmployeeSprites.js";
import { installSceneTextSize } from "../logic/GameTextSize.js";
import { SHOP_TILE_ASSETS } from "../logic/ShopTiles.js";
import { BACKROOM_TILE_ASSETS } from "../logic/BackroomTiles.js";
import { BACKROOM_DOOR_SPRITE, STORE_DOOR_SPRITE } from "../logic/SlidingDoor.js";
import { PARTNER_CARRY_SPRITE, PARTNER_SPRITE, PLAYER_CARRY_SPRITE, PLAYER_SPRITE, registerPlayerAnimations } from "../logic/Player.js";
import { FIXTURE_CRATE_SPRITE, ITEM_CRATE_SPRITE } from "../logic/Crate.js";
import { FIXTURE_TYPES } from "../logic/FixtureLayout.js";
import { ensureBudgetShelfSideTextures } from "../logic/BudgetShelfArt.js";
import { ensureCleaningTextures } from "../modules/cleaning/CleaningArt.js";

// The game-wide static data lookup, imported by logic modules as `database`.
export const database = new DatabaseManager();

export class BootScene extends Phaser.Scene {
  constructor() {
    super("scene-boot");
  }

  preload() {
    this.load.json("items", "data/Items.json");
    this.load.json("licenses", "data/Licenses.json");
    for (const sheet of [PLAYER_SPRITE, PLAYER_CARRY_SPRITE, PARTNER_SPRITE, PARTNER_CARRY_SPRITE]) {
      this.load.spritesheet(sheet.key, sheet.path, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      });
    }

    // Every floor/wall/fixture tile; RoomLayout.js and TileRoom.js build the map from these keys.
    tilesetManifest.forEach(({ key, path }) => this.load.image(key, path));
    for (const crate of [ITEM_CRATE_SPRITE, FIXTURE_CRATE_SPRITE]) this.load.image(crate.key, crate.path);
    [...SHOP_TILE_ASSETS, ...BACKROOM_TILE_ASSETS].forEach(({ key, path }) => this.load.image(key, path));
    for (const sheet of [STORE_DOOR_SPRITE, BACKROOM_DOOR_SPRITE]) {
      this.load.spritesheet(sheet.key, sheet.path, { frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight });
    }

    // Every customer walk sheet (one character each); see CustomerSprites.js.
    loadCustomerCharacters(this.load);
    loadEmployeeCharacters(this.load);
  }

  create() {
    installSceneTextSize(this, Phaser);
    ensureCleaningTextures(this);
    ensureBudgetShelfSideTextures(this, FIXTURE_TYPES);
    // Pixel art drawn larger or smaller than its sheet stays crisp.
    for (const key of [PLAYER_SPRITE.key, PLAYER_CARRY_SPRITE.key, PARTNER_SPRITE.key, PARTNER_CARRY_SPRITE.key, STORE_DOOR_SPRITE.key, BACKROOM_DOOR_SPRITE.key,
      ITEM_CRATE_SPRITE.key, FIXTURE_CRATE_SPRITE.key,
      ...SHOP_TILE_ASSETS.map((asset) => asset.key), ...BACKROOM_TILE_ASSETS.map((asset) => asset.key)]) {
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    registerPlayerAnimations(this.anims);
    registerCustomerAnimations(this.textures, this.anims);
    registerEmployeeAnimations(this.textures, this.anims);
    for (const { key } of tilesetManifest) {
      if (key.startsWith("shelf_") || key.startsWith("register_basic_")) {
        this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }
    const rawItems = this.cache.json.get("items");
    const rawLicenses = this.cache.json.get("licenses");

    database.loadItemsJSON(rawItems);
    database.loadLicensesJSON(rawLicenses);

    this.scene.start("scene-title");
  }
}
