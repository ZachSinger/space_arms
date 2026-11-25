// ==========================================
// FILE: DebugTools.js
// ==========================================
// Dev-build shortcuts: spawn a customer (Y), Quickstart (K), employee testing (L), and HUD
// buttons that open expansions for free, run Quickstart, skip shifts, or prepare employee testing.
// REAL games never create this.
import { database } from "../scenes/boot.js";
import { getStoreDoorCell, EXPANSION_ORDER, BACKROOM_UPGRADE_ORDER } from "../logic/RoomLayout.js";
import { getFixtureType, validateFixtureLayout } from "../logic/FixtureLayout.js";
import { DELIVERY_FEE, MAX_CRATES_PER_ORDER, getCrateOrderQuantity } from "../logic/SupplyOrder.js";
import { sinkItems, sourceItems } from "../logic/InventoryTransfer.js";
import { rollCustomerTraits } from "../logic/CustomerTraits.js";
import { gameRandom } from "../core/Random.js";

const DEBUG_BUTTON_IDS = ["hud-debug-info-btn", "hud-debug-shop-upgrade-btn",
  "hud-debug-backroom-upgrade-btn", "hud-debug-quickstart-btn", "hud-debug-skip-shifts-btn",
  "hud-debug-employee-testing-btn"];
const SHELF_TYPES = ["shelf_budget_2x2", "shelf_budget_2x3", "shelf_budget_2x4",
  "shelf_budget_3x2", "shelf_budget_3x3", "shelf_budget_3x4"];
const EMPLOYEE_TEST_LEVEL = 5;
const DEBUG_EMPLOYEE_FUNDS_LABEL = "Employee testing";

export class DebugTools {
  // REAL games hide every debug HUD button; dev builds show them.
  static showButtons(visible) {
    for (const id of DEBUG_BUTTON_IDS) document.getElementById(id)?.classList.toggle("hidden", !visible);
  }

  constructor(scene) {
    this.scene = scene;
    this.buttons = [];
  }

  install() {
    const { scene } = this;
    scene.controls.bindKey("keydown-Y", "debug", () => scene.customerFlow.spawn(null));
    scene.controls.bindKey("keydown-K", "debug", () => this.quickstart());
    scene.controls.bindKey("keydown-L", "debug", () => this.prepareEmployeeTesting());

    this.buttons = [
      ["hud-debug-shop-upgrade-btn", () => this.unlockNextZone(EXPANSION_ORDER, "sales floor")],
      ["hud-debug-backroom-upgrade-btn", () => this.unlockNextZone(BACKROOM_UPGRADE_ORDER, "backroom")],
      ["hud-debug-quickstart-btn", () => this.quickstart({ shelfCount: 2, itemCount: 6 })],
      ["hud-debug-skip-shifts-btn", () => this.skipShifts(4)],
      ["hud-debug-employee-testing-btn", () => this.prepareEmployeeTesting()],
    ].map(([id, handler]) => ({ element: document.getElementById(id), handler }))
      .filter(({ element }) => element);
    for (const { element, handler } of this.buttons) element.addEventListener("click", handler);
  }

  destroy() {
    for (const { element, handler } of this.buttons) element.removeEventListener("click", handler);
    this.buttons = [];
  }

  // L key / Employee Test button: plays shifts the way Skip Shifts does until the shop earns
  // Level 5, restocks every shelf for the next shift, and tops money up to one hire if short.
  prepareEmployeeTesting() {
    const { scene } = this;
    const { gameState } = scene;
    if (scene.shiftClock.started || scene.shift.starting || gameState.calendar.awaitingEndDay ||
      scene.fixturePlacement?.active) {
      scene.messages.show("Employee Test only works before a shift starts. End the day first if needed.");
      return false;
    }

    const startDay = gameState.calendar.day;
    for (let shift = 0; shift < 12 && gameState.reputation.shopLevel < EMPLOYEE_TEST_LEVEL; shift += 1) {
      this.signNextContract();
      this.stockEveryItem();
      this.simulateShift();
      gameState.endDay();
    }
    // Earned honestly when possible; forced only if the simulated shifts fell short.
    gameState.reputation.setShopLevel(Math.max(gameState.reputation.shopLevel, EMPLOYEE_TEST_LEVEL));
    this.signNextContract();
    this.stockEveryItem();
    for (const shelf of scene.fixtures.shelves()) scene.fixtureViews.refreshStockDisplay(shelf);
    scene.catalogSystem.recalculateActiveFactions();

    const hireCost = gameState.staff.profile("tavi_stock_clerk").hireCost;
    const fundsNeeded = Math.max(0, hireCost - gameState.economy.credits);
    if (fundsNeeded > 0) {
      gameState.economy.add(fundsNeeded, {
        category: "debug",
        label: DEBUG_EMPLOYEE_FUNDS_LABEL,
      });
    }
    gameState.shop.changed();
    scene.saves.requestAutosave();
    const played = gameState.calendar.day - startDay;
    scene.messages.show(
      `Employee Test: played ${played} shift${played === 1 ? "" : "s"}. Shop Level ${gameState.reputation.shopLevel}, ` +
      `money ${Math.round(gameState.economy.credits)}, shelves stocked. You can hire your first employee.`,
      "#10b981",
    );
    return true;
  }

  // HUD debug buttons: opens the next sales-floor expansion or backroom upgrade for free,
  // ignoring Shop Level, cost, and whether the store is open.
  unlockNextZone(order, areaName) {
    const { scene } = this;
    const zone = order.map((id) => scene.room.zones.find((candidate) => candidate.id === id))
      .find((candidate) => candidate?.locked);
    if (!zone) {
      scene.messages.show(`Every ${areaName} upgrade is already open.`);
      return false;
    }
    scene.fixtureSystem.openZone(zone.id);
    scene.saves.requestAutosave();
    scene.messages.show(`Debug: ${zone.name} is open.`);
    return true;
  }

  // K key / Quickstart button: skips the opening setup for testing. Signs whatever contracts
  // the cheapest one-spot items need, then places Budget Shelves near the door and fills
  // one spot per item, paying for everything.
  quickstart({ shelfCount = 1, itemCount = 4 } = {}) {
    const { scene } = this;
    const { gameState } = scene;
    if (scene.fixtures.shelves().some((shelf) => shelf.placements.length > 0)) {
      scene.messages.show("Quickstart only works before any shelf has items on it.");
      return false;
    }
    const shelfType = "shelf_budget_2x2";
    const shelfSpec = getFixtureType(shelfType);
    // Empty starter shelves are stocked first; new shelves are bought only for the rest.
    const shelves = scene.fixtures.shelves().filter((shelf) => shelf.type === shelfType).slice(0, shelfCount);
    const items = database.getAllItems()
      .filter((item) => {
        if (item.hidden) return false;
        const license = database.getLicense(item.license);
        return gameState.catalog.owns(item.license) || license?.isUnlocked(gameState);
      })
      .sort((a, b) => a.baseCost - b.baseCost ||
        (database.getLicense(a.license)?.baseCost ?? 0) - (database.getLicense(b.license)?.baseCost ?? 0))
      .slice(0, Math.min(itemCount, shelfCount * 4));

    const door = getStoreDoorCell();
    if (shelves.length < shelfCount && !scene.fixtureSystem.findNearestCell(shelfType, door)) {
      scene.messages.show("Quickstart couldn't find room for the shelf.");
      return false;
    }

    for (const licenseId of new Set(items.map((item) => item.license))) {
      if (gameState.catalog.owns(licenseId)) continue;
      const license = database.getLicense(licenseId);
      gameState.economy.spend(license.baseCost, { category: "licenses", label: license.name });
      gameState.catalog.sign(licenseId);
    }
    scene.catalogSystem.recalculateActiveFactions();

    for (let count = shelves.length; count < shelfCount; count += 1) {
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

    for (const shelf of shelves) scene.fixtureViews.refreshStockDisplay(shelf);
    gameState.shop.changed();
    scene.messages.show(shelves.length > 1 ? "Quickstart: shelves stocked." : "Quickstart: shelf stocked.");
    return true;
  }

  // Skip Shifts button: plays whole shifts instantly, as a good player would. Each shift it
  // signs the next contract, gives every item a full Budget Shelf spot, then serves every
  // customer the shift would bring (nobody turned away, no trash or mistakes).
  skipShifts(count = 4) {
    const { scene } = this;
    const { gameState } = scene;
    if (scene.shiftClock.started || scene.shift.starting || gameState.calendar.awaitingEndDay ||
      scene.fixturePlacement.active) {
      scene.messages.show("Skip Shifts only works before a shift starts. End the day first if needed.");
      return false;
    }
    const startDay = gameState.calendar.day;
    let unplaced = 0;
    for (let shift = 0; shift < count; shift += 1) {
      this.signNextContract();
      unplaced = this.stockEveryItem();
      this.simulateShift();
      gameState.endDay();
    }
    for (const shelf of scene.fixtures.shelves()) scene.fixtureViews.refreshStockDisplay(shelf);
    gameState.shop.changed();
    scene.catalogSystem.recalculateActiveFactions();
    scene.saves.requestAutosave();
    const roomNote = unplaced > 0 ? ` ${unplaced} owned item${unplaced === 1 ? "" : "s"} had no shelf room.` : "";
    scene.messages.show(
      `Skipped days ${startDay}-${gameState.calendar.day - 1}. Shop Level ${gameState.reputation.shopLevel}, ` +
      `money ${Math.round(gameState.economy.credits)}.${roomNote}`,
      "#10b981",
    );
    return true;
  }

  // The cheapest-level item contract you can sign and afford.
  signNextContract() {
    const { scene } = this;
    const { gameState } = scene;
    const itemLicenseIds = new Set(database.getAllItems().map((item) => item.license));
    const next = database.getAllLicenses()
      .filter((license) => itemLicenseIds.has(license.id) && !gameState.catalog.owns(license.id))
      .filter((license) => license.isUnlocked(gameState) && license.canAfford(gameState))
      .sort((a, b) => a.requiredShopLevel - b.requiredShopLevel || a.baseCost - b.baseCost)[0];
    if (!next) return;
    gameState.economy.spend(next.baseCost, { category: "licenses", label: next.name });
    gameState.catalog.sign(next.id);
    scene.catalogSystem.recalculateActiveFactions();
  }

  // Every owned item gets a shelf spot, buying the biggest Budget Shelf that fits when the
  // shelves are full. Then every spot is filled: Go-Backs first, then whole crates, one
  // delivery fee per load of crates. Returns how many owned items didn't fit anywhere.
  stockEveryItem() {
    const { scene } = this;
    const { gameState } = scene;
    const shelved = new Set(scene.fixtures.shelves().flatMap((shelf) => shelf.placements.map((placement) => placement.itemId)));
    const missing = database.getAllItems()
      .filter((item) => !item.hidden && gameState.catalog.owns(item.license) && !shelved.has(item.id))
      .sort((a, b) => a.baseCost - b.baseCost);
    const shelfTypes = SHELF_TYPES.map(getFixtureType)
      .sort((a, b) => b.shelfRows * b.shelfColumns - a.shelfRows * a.shelfColumns);
    let unplaced = 0;
    let laidOut = false;
    for (const item of missing) {
      if (scene.fixtures.shelves().some((shelf) => this.placeOnShelf(shelf, item.id))) continue;
      const shelfSpec = shelfTypes.find((spec) => gameState.economy.canAfford(spec.price) &&
        scene.fixtureSystem.findNearestCell(spec.id, getStoreDoorCell()));
      if (!shelfSpec) {
        unplaced += 1;
        continue;
      }
      const cell = scene.fixtureSystem.findNearestCell(shelfSpec.id, getStoreDoorCell());
      gameState.economy.spend(shelfSpec.price, { category: "fixtures", label: shelfSpec.name });
      const shelf = scene.fixtureSystem.spawn({ id: scene.fixtures.nextId(shelfSpec.id), type: shelfSpec.id, ...cell });
      scene.fixtureSystem.applyLayout(scene.fixtures.layout(),
        validateFixtureLayout(scene.fixtures.layout(), scene.fixtureSystem.layoutOptions()));
      laidOut = true;
      if (!this.placeOnShelf(shelf, item.id)) unplaced += 1;
    }
    if (laidOut) gameState.shop.changed();

    let crateCount = 0;
    for (const shelf of scene.fixtures.shelves()) {
      for (const placement of shelf.placements) crateCount += this.fillSpot(shelf, placement);
    }
    this.payDeliveryFees(crateCount);
    return unplaced;
  }

  // Puts an empty spot for the item in the first free place on this shelf, either way round.
  placeOnShelf(shelf, itemId) {
    for (let gy = 0; gy < shelf.displayGrid.h; gy += 1) {
      for (let gx = 0; gx < shelf.displayGrid.w; gx += 1) {
        if (shelf.placeItem(itemId, gx, gy, false, 0) || shelf.placeItem(itemId, gx, gy, true, 0)) return true;
      }
    }
    return false;
  }

  // Tops one shelf spot up to full: Go-Backs first, then whole crates, extras to Go-Backs.
  // Returns how many crates it bought.
  fillSpot(shelf, placement) {
    const { scene } = this;
    const { gameState } = scene;
    const item = database.getItem(placement.itemId);
    const needed = shelf.getPlacementCapacity(placement) - placement.quantity;
    const fromStorage = Math.min(needed, gameState.goBacks.available(item.id));
    const fromGoBacks = fromStorage > 0 ? gameState.goBacks.remove(item.id, fromStorage) : 0;
    const perCrate = getCrateOrderQuantity(item);
    const crateCost = scene.supply.crateCost(item);
    const crates = Math.max(0, Math.min(Math.ceil((needed - fromGoBacks) / perCrate),
      Math.floor(Math.max(0, gameState.economy.credits - DELIVERY_FEE) / crateCost)));
    if (crates > 0) {
      gameState.economy.spend(crateCost * crates, { category: "stock_orders", label: item.name, quantity: crates });
    }
    const arrived = fromGoBacks + crates * perCrate;
    const toShelf = Math.min(needed, arrived);
    if (toShelf > 0) {
      sourceItems(shelf, item.id, toShelf, {
        sourceId: `skip-shifts-${gameState.calendar.day}-${placement.id}`,
        sourceLocation: { kind: "debug-skip-shifts", day: gameState.calendar.day },
        destinationEntry: placement,
        eventBus: scene.eventBus,
        sourceName: "skip-shifts",
        destinationName: "shelf",
      });
    }
    gameState.goBacks.add(item.id, arrived - toShelf);
    gameState.catalog.priceIfUnset(item.id, gameState.market.getPrice(item.id));
    return crates;
  }

  payDeliveryFees(crateCount) {
    const deliveries = Math.ceil(crateCount / MAX_CRATES_PER_ORDER);
    for (let delivery = 0; delivery < deliveries; delivery += 1) {
      this.scene.gameState.economy.spend(DELIVERY_FEE, { category: "delivery_fees", label: "Delivery fee" });
    }
  }

  // One whole shift, instantly: every customer in the pool shops and pays. A spot that can't
  // cover what a customer wants is restocked first, the way a busy player would keep up.
  simulateShift() {
    const { scene } = this;
    const { gameState, customerFlow } = scene;
    scene.staffSystem.payWages();
    gameState.reputation.startShift();
    const pool = customerFlow.calculatePool();
    let served = 0;
    let restockCrates = 0;
    for (const factionId of pool.customerFactionIds) {
      const traits = rollCustomerTraits(factionId, gameRandom, customerFlow.traitConditions());
      const plan = customerFlow.shoppingPlan(factionId, traits);
      const bought = new Set();
      const buy = (itemId) => {
        if (bought.has(itemId)) return;
        let wanted = plan.itemQuantities[itemId] ?? 1;
        for (const shelf of scene.fixtures.shelves()) {
          for (const placement of shelf.placements) {
            if (wanted <= 0 || placement.itemId !== itemId) continue;
            if (placement.quantity < wanted) restockCrates += this.fillSpot(shelf, placement);
            if (placement.quantity <= 0) continue;
            const result = sinkItems(shelf, itemId, Math.min(wanted, placement.quantity), {
              sinkId: `skip-shifts-sale-${gameState.calendar.day}-${served}`,
              sinkLocation: { kind: "sales", customerId: "skip-shifts" },
              sourceEntry: placement,
              eventBus: scene.eventBus,
              sourceName: "shelf",
              sinkName: "sales",
            });
            if (result.moved <= 0) continue;
            wanted -= result.moved;
            bought.add(itemId);
            gameState.economy.add(scene.catalogSystem.getStorePrice(itemId) * result.moved, {
              category: "sales", label: database.getItem(itemId).name, quantity: result.moved,
            });
          }
        }
      };
      plan.primaryItemIds.forEach(buy);
      if (bought.size === 0) {
        if (plan.primaryItemIds.length > 0) gameState.reputation.lose(1, factionId);
        continue;
      }
      plan.bonusItemIds.forEach(buy);
      for (const [firearmId, ammoIds] of Object.entries(plan.matchingAmmoIdsByFirearm)) {
        if (bought.has(firearmId)) ammoIds.forEach(buy);
      }
      gameState.reputation.gain(1, factionId);
      served += 1;
    }
    this.payDeliveryFees(restockCrates);
    gameState.finishShift({ customersServed: served, customersTurnedAway: 0 });
  }
}
