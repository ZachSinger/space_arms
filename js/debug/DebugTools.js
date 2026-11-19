// ==========================================
// FILE: DebugTools.js
// ==========================================
// Dev-build shortcuts: tile grids (G, \), spawn a customer (Y), Quickstart (K), and the HUD
// buttons that open expansions for free or run Quickstart. REAL games never create this.
import { database } from "../scenes/boot.js";
import { TILE_SIZE, getTotalGridSize, getStoreDoorCell, EXPANSION_ORDER, BACKROOM_UPGRADE_ORDER } from "../logic/RoomLayout.js";
import { FixturePlacementGrid } from "../logic/FixturePlacementGrid.js";
import { getFixtureType, validateFixtureLayout } from "../logic/FixtureLayout.js";
import { DELIVERY_FEE, getCrateOrderQuantity } from "../logic/SupplyOrder.js";
import { sourceItems } from "../logic/InventoryTransfer.js";

const DEBUG_BUTTON_IDS = ["hud-debug-info-btn", "hud-debug-shop-upgrade-btn",
  "hud-debug-backroom-upgrade-btn", "hud-debug-quickstart-btn"];

export class DebugTools {
  // REAL games hide every debug HUD button; dev builds show them.
  static showButtons(visible) {
    for (const id of DEBUG_BUTTON_IDS) document.getElementById(id)?.classList.toggle("hidden", !visible);
  }

  constructor(scene) {
    this.scene = scene;
    this.gridOverlays = new Map();
    this.placementGrid = null;
    this.buttons = [];
  }

  install() {
    const { scene } = this;
    scene.bindControlKey("keydown-G", "debug", () => this.toggleGrid());
    scene.bindControlKey("keydown-BACK_SLASH", "debugGrid", (event) => {
      if (!event.repeat) this.toggleGrid(8, 0x00ff00, 1);
    });
    scene.bindControlKey("keydown-Y", "debug", () => scene.customerFlow.spawn(null));
    scene.bindControlKey("keydown-K", "debug", () => this.quickstart());

    this.buttons = [
      ["hud-debug-shop-upgrade-btn", () => this.unlockNextZone(EXPANSION_ORDER, "sales floor")],
      ["hud-debug-backroom-upgrade-btn", () => this.unlockNextZone(BACKROOM_UPGRADE_ORDER, "backroom")],
      ["hud-debug-quickstart-btn", () => this.quickstart({ shelfCount: 2, itemCount: 6 })],
    ].map(([id, handler]) => ({ element: document.getElementById(id), handler }))
      .filter(({ element }) => element);
    for (const { element, handler } of this.buttons) element.addEventListener("click", handler);
  }

  update() {
    this.placementGrid?.update();
  }

  destroy() {
    for (const grid of this.gridOverlays.values()) grid.destroy();
    this.gridOverlays.clear();
    this.placementGrid?.destroy();
    this.placementGrid = null;
    for (const { element, handler } of this.buttons) element.removeEventListener("click", handler);
    this.buttons = [];
  }

  // World-pixel grids over the shop map, locked zones included. Depth 9998 sits
  // just under the player (9999) so it draws over every fixture, making off-grid ones obvious.
  // The 8-pixel grid is the fixture placement grid instead, shown only while placing.
  toggleGrid(spacing = TILE_SIZE, color = 0x00ffff, alpha = 0.5) {
    if (spacing === 8) {
      this.placementGrid ??= new FixturePlacementGrid(this.scene);
      this.placementGrid.toggle();
      return;
    }
    let graphics = this.gridOverlays.get(spacing);
    if (!graphics) {
      const { gridW, gridH } = getTotalGridSize();
      const width = gridW * TILE_SIZE;
      const height = gridH * TILE_SIZE;

      graphics = this.scene.add.graphics().setDepth(9998);
      graphics.lineStyle(1, color, alpha);
      for (let x = 0; x <= width; x += spacing) {
        graphics.lineBetween(x, 0, x, height);
      }
      for (let y = 0; y <= height; y += spacing) {
        graphics.lineBetween(0, y, width, y);
      }
      graphics.setVisible(false);
      this.gridOverlays.set(spacing, graphics);
    }

    graphics.setVisible(!graphics.visible);
  }

  // HUD debug buttons: opens the next sales-floor expansion or backroom upgrade for free,
  // ignoring Shop Level, cost, and whether the store is open.
  unlockNextZone(order, areaName) {
    const { scene } = this;
    const zone = order.map((id) => scene.room.zones.find((candidate) => candidate.id === id))
      .find((candidate) => candidate?.locked);
    if (!zone) {
      scene.showShopMessage(`Every ${areaName} upgrade is already open.`);
      return false;
    }
    scene.fixtureSystem.openZone(zone.id);
    scene.requestAutosave();
    scene.showShopMessage(`Debug: ${zone.name} is open.`);
    return true;
  }

  // K key / Quickstart button: skips the opening setup for testing. Signs whatever contracts
  // the cheapest one-spot items need, then places Budget Shelves near the door and fills
  // one spot per item, paying for everything.
  quickstart({ shelfCount = 1, itemCount = 4 } = {}) {
    const { scene } = this;
    const { gameState } = scene;
    if (scene.fixtures.shelves().length > 0) {
      scene.showShopMessage("Quickstart only works before you place a shelf.");
      return false;
    }
    const shelfType = "shelf_budget_2x2";
    const shelfSpec = getFixtureType(shelfType);
    const items = database.getAllItems()
      .filter((item) => item.dimensions.w === 1 && item.dimensions.h === 1)
      .filter((item) => {
        const license = database.getLicense(item.license);
        return gameState.catalog.owns(item.license) || license?.isUnlocked(gameState);
      })
      .sort((a, b) => a.baseCost - b.baseCost ||
        (database.getLicense(a.license)?.baseCost ?? 0) - (database.getLicense(b.license)?.baseCost ?? 0))
      .slice(0, Math.min(itemCount, shelfCount * 4));

    const door = getStoreDoorCell();
    if (!scene.fixtureSystem.findNearestCell(shelfType, door)) {
      scene.showShopMessage("Quickstart couldn't find room for the shelf.");
      return false;
    }

    for (const licenseId of new Set(items.map((item) => item.license))) {
      if (gameState.catalog.owns(licenseId)) continue;
      const license = database.getLicense(licenseId);
      gameState.economy.spend(license.baseCost, { category: "licenses", label: license.name });
      gameState.catalog.sign(licenseId);
    }
    scene.recalculateActiveFactions();

    const shelves = [];
    for (let count = 0; count < shelfCount; count += 1) {
      const shelfCell = scene.fixtureSystem.findNearestCell(shelfType, door);
      if (!shelfCell) break;
      gameState.economy.spend(shelfSpec.price, { category: "fixtures", label: shelfSpec.name });
      shelves.push(scene.fixtureSystem.spawn({ id: scene.fixtures.nextId(shelfType), type: shelfType, ...shelfCell }));
      const result = validateFixtureLayout(scene.fixtures.layout(), scene.fixtureSystem.layoutOptions());
      scene.fixtureSystem.applyLayout(scene.fixtures.layout(), result);
    }

    // One item per shelf spot, in each 2x2 grid's reading order, filling shelves in turn.
    const spots = [[0, 0], [1, 0], [0, 1], [1, 1]];
    items.slice(0, shelves.length * spots.length).forEach((item, index) => {
      const shelf = shelves[Math.floor(index / spots.length)];
      const [gx, gy] = spots[index % spots.length];
      const placement = shelf.placeItem(item.id, gx, gy, false, 0);
      const capacity = shelf.getPlacementCapacity(placement);
      const crates = Math.ceil(capacity / getCrateOrderQuantity(item));
      gameState.economy.spend(scene.supply.crateCost(item) * crates, {
        category: "stock_orders", label: item.name, quantity: crates,
      });
      const sourceQuantity = capacity - placement.quantity;
      if (sourceQuantity > 0) {
        const result = sourceItems(shelf, item.id, sourceQuantity, {
          sourceId: `quickstart-${gameState.calendar.day}-${index}`,
          sourceLocation: { kind: "debug-quickstart", day: gameState.calendar.day },
          destinationEntry: placement,
          eventBus: scene.eventBus,
          sourceName: "quickstart",
          destinationName: "shelf",
        });
        if (result.moved !== sourceQuantity) {
          throw new Error(`Quickstart could not fill the ${item.name} shelf slot.`);
        }
      }
      gameState.goBacks.add(item.id, crates * getCrateOrderQuantity(item) - capacity);
      gameState.catalog.priceIfUnset(item.id, gameState.market.getPrice(item.id));
    });
    gameState.economy.spend(DELIVERY_FEE, { category: "delivery_fees", label: "Delivery fee" });

    for (const shelf of shelves) scene.refreshShelfStockDisplay(shelf);
    gameState.shop.changed();
    scene.showShopMessage(shelves.length > 1 ? "Quickstart: shelves stocked." : "Quickstart: shelf stocked.");
    return true;
  }
}
