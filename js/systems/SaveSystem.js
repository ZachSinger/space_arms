// ==========================================
// FILE: SaveSystem.js
// ==========================================
// Saving and loading the shop: when saving is allowed, autosaves while the store is closed,
// manual saves, loading a save onto the map, and the save/load error window.
// SaveManager writes this system's snapshot under the save file's "shop" key.
import { database } from "../scenes/boot.js";
import { GameState } from "../state/GameState.js";
import { validateShopSave } from "../logic/ShopSave.js";
import { validateFixtureLayout } from "../logic/FixtureLayout.js";
import { TILE_SIZE } from "../logic/RoomLayout.js";
import { AREA } from "../world/Areas.js";
import { SaveManager } from "../../SaveManager.js";

const SAVED_STATUS = "Saved. Autosaves while the store is closed.";

export class SaveSystem {
  /**
   * @param {object} shop - the game scene
   * @param {object} [storage] - SaveManager storage override, for tests
   */
  constructor(shop, storage) {
    this.shop = shop;
    this.loadFailed = false;
    this.autosaveBlocked = false;
    this.autosaveQueued = false;
    this.inProgress = null;
    this.showingSave = false;
    this.lastSavedSnapshot = null;
    this.status = "Not saved yet";
    this.manager = new SaveManager({ shop: this }, storage);
  }

  // Saving needs a quiet store: no shift running and nobody inside.
  canSaveOffShift() {
    const { shop } = this;
    return !this.loadFailed && (!shop.shiftClock.started || shop.shift.ended) &&
      shop.customers.length === 0;
  }

  // The Shelf Test Room is closed-store time like any other; it just never writes a save.
  canWrite() {
    return !this.shop.sandbox && this.canSaveOffShift();
  }

  serialize() {
    const { shop } = this;
    return validateShopSave({
      ...shop.gameState.toSave(),
      ...shop.crateSystem.serialize(),
      // Trash in hand is saved as lying on the floor where he stands (or by the backroom door).
      ...(shop.cleaningSystem ? { trash: shop.cleaningSystem.serializeTrash() } : {}),
    }, database);
  }

  // Loads a save at scene start. A broken save locks saving so it is never overwritten.
  loadAtStart(saved) {
    try {
      this.applySave(saved);
    } catch (error) {
      this.loadFailed = true;
      this.shop.player.inputEnabled = false;
      this.handleError(error);
    }
  }

  /**
   * Replaces the whole shop with a saved one. Throws if the save is invalid.
   * @param {object} saved - raw save data; validated by validateShopSave
   */
  applySave(saved) {
    const { shop } = this;
    const data = validateShopSave(saved, database);
    // Staged: the whole new game state is built and checked off to the side first.
    const next = GameState.fromSave(data, { items: database.getAllItems(), events: shop.eventBus });
    for (const id of data.unlockedZones) shop.room.unlockZone(id);
    // The map never closes a zone again, so one already open stays open in the loaded shop.
    for (const zone of shop.room.zones) if (!zone.locked) next.shop.unlockedZones.add(zone.id);
    // Saves from before the sales-floor rule still load; the misplaced fixture can then be moved out.
    const result = validateFixtureLayout(data.fixtures, { ...shop.fixtureSystem.layoutOptions(), requireSalesFloor: false });
    if (!result.valid) throw new Error(`Invalid saved layout: ${result.reason}`);
    shop.gameState.replaceWith(next, () => this.rebuildShop(data, result));
    shop.shift.resetStartingTotals();
    shop.cameraRig.reset();
    this.lastSavedSnapshot = JSON.stringify(this.serialize());
    this.setStatus(SAVED_STATUS);
  }

  /**
   * Puts the saved shop back on the map. Runs after the new game state is swapped in and before
   * any screen hears about it.
   * @param {object} data - an upgraded, checked save
   * @param {object} layout - the checked fixture layout
   */
  rebuildShop(data, layout) {
    const { shop } = this;
    shop.fixtureViews.clear();
    for (const fixture of shop.fixtures.all()) shop.fixtureViews.show(fixture);
    shop.fixtureSystem.applyLayout(data.fixtures, layout);
    shop.areas.playerArea = AREA.SHOP;
    shop.player.teleportTo(shop.storeDoor.x, shop.storeDoor.y + TILE_SIZE);
    shop.cameraRig.refresh();
    shop.controls.cratePress = null;
    shop.crateSystem.load(data);
    shop.cleaningSystem?.load(data.trash ?? [], data.dirt ?? []);
    this.moveShelfOverflowToGoBacks();
    shop.fixtureViews.refreshStockDisplays();
    shop.catalogSystem.recalculateActiveFactions();
  }

  // Older saves can hold more in a shelf slot than its cap allows; the excess goes to Go-Backs.
  moveShelfOverflowToGoBacks() {
    const { gameState } = this.shop;
    for (const shelf of this.shop.fixtures.shelves()) {
      for (const placement of shelf.placements) {
        const overflow = placement.quantity - shelf.getPlacementCapacity(placement);
        if (overflow <= 0) continue;
        const moved = gameState.goBacks.takeFrom(shelf, placement.itemId, overflow, {
          sourceEntry: placement, sourceName: "shelf",
        });
        if (moved !== overflow) throw new Error("Could not move saved shelf overflow into Go-Backs.");
        gameState.shop.changed();
      }
    }
  }

  // Coalesces any number of requests in one tick into a single save attempt.
  requestAutosave() {
    if (!this.canWrite() || this.autosaveBlocked || this.autosaveQueued) return;
    this.autosaveQueued = true;
    queueMicrotask(() => {
      this.autosaveQueued = false;
      if (!this.shop.scene.isActive() || !this.canWrite()) return;
      this.saveOffShift().catch((error) => this.handleError(error));
    });
  }

  async saveManually() {
    const { shop } = this;
    if (shop.sandbox) {
      shop.messages.show("Test areas are never saved.");
      return;
    }
    if (this.loadFailed || shop.shift.starting || !this.canSaveOffShift()) {
      shop.messages.show(this.loadFailed
        ? "Cannot save after a load error. Your existing save has not been overwritten."
        : "Finish the shift before saving.");
      return;
    }
    try {
      this.showingSave = true;
      await this.saveOffShift();
      this.autosaveBlocked = false;
      shop.messages.closeSaveError();
      this.setStatus(SAVED_STATUS);
      shop.messages.show("Game saved.");
    } catch (error) {
      this.handleError(error);
    } finally {
      this.showingSave = false;
      this.updateControls();
    }
  }

  // Waits out any save already running, then skips writing if nothing changed since the
  // last successful save.
  async saveOffShift() {
    if (!this.canWrite()) return;
    if (this.inProgress) {
      await this.inProgress;
      return this.saveOffShift();
    }
    const snapshot = JSON.stringify(this.serialize());
    if (snapshot === this.lastSavedSnapshot) return;
    this.inProgress = this.manager.save();
    // Background autosaves stay silent; only a save the player asked for shows progress.
    if (this.showingSave) this.setStatus("Saving...");
    try {
      await this.inProgress;
      this.lastSavedSnapshot = snapshot;
      this.autosaveBlocked = false;
      this.setStatus(SAVED_STATUS);
      this.shop.messages.closeSaveError();
    } finally {
      this.inProgress = null;
      this.updateControls();
    }
  }

  updateControls() {
    const { shop } = this;
    if (!shop.hud) return;
    shop.hud.renderSaveState({
      canSave: !shop.shift.starting && this.canWrite(),
      saving: Boolean(this.inProgress && this.showingSave),
      status: this.status,
      unavailableReason: this.loadFailed
        ? "Saving disabled: your saved game could not be loaded."
        : shop.shift.starting ? "Starting the shift..." : "Finish the shift before saving.",
    });
  }

  setStatus(text) {
    this.status = text;
    this.shop.managerTablet?.updateSaveStatus();
    this.updateControls();
  }

  /**
   * Blocks autosave and shows the save/load error window. After a failed load the only way
   * out is back to the title, so the existing save is never overwritten.
   * @param {Error} error
   */
  handleError(error) {
    const { shop } = this;
    console.error(this.loadFailed ? "Could not load game" : "Could not save game", error);
    this.autosaveBlocked = true;
    this.setStatus(`Not saved: ${error.message}`);
    shop.messages.showSaveError({
      text: `${this.loadFailed ? "Your saved game could not be loaded. It has not been overwritten." : "Your progress could not be saved."} ${error.message}`,
      buttonLabel: this.loadFailed ? "RETURN TO TITLE" : "RETRY SAVE",
      onButton: () => {
        if (this.loadFailed) shop.scene.start("scene-title");
        else {
          this.autosaveBlocked = false;
          this.saveOffShift().catch((failure) => this.handleError(failure));
        }
      },
    });
  }
}
