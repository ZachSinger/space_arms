// ==========================================
// FILE: game.js
// ==========================================
// The main shop scene: builds the room, fixtures, player, and Loading Pad, then runs the
// shift loop (customers, checkout, crates) and off-shift saving.
// See also: TileRoom.js (map), FixtureRegistry.js (fixtures), Customer.js (shopper AI).
import { WindowManager } from "../logic/WindowManager.js";
import { ManagerTablet } from "../logic/ManagerTablet.js";
import { GameState } from "../state/GameState.js";
import { HUDController } from "../logic/HUDController.js";
import { DebugInfo } from "../debug/DebugInfo.js";
import { DebugTools } from "../debug/DebugTools.js";
import { Events, GAME_EVENTS } from "../core/Events.js";
import { ControlMode, CONTROL_MODES } from "../input/ControlMode.js";
import { InteractableRegistry } from "../interaction/InteractableRegistry.js";
import { InteractionSystem } from "../interaction/InteractionSystem.js";
import { ModuleHost } from "../modules/GameModules.js";
/** @typedef {import("../logic/ShelfFixture.js").ShelfFixture} ShelfFixture */
import { SPRITE_DISPLAY_WIDTH, SPRITE_DISPLAY_HEIGHT } from "../logic/Customer.js";
import { isMoney, roundMoney } from "../logic/Money.js";
import { CUSTOMER_TRAITS } from "../logic/CustomerTraits.js";
import { getLicensedFactionIds } from "../logic/CustomerPooling.js";
import { Player } from "../logic/Player.js";
import { PEOPLE_DEPTH_BASE } from "../world/Depth.js";
import { getCrateOrderQuantity } from "../logic/SupplyOrder.js";
import { TileRoom } from "../logic/TileRoom.js";
import { SlidingDoor } from "../logic/SlidingDoor.js";
import {
  TILE_SIZE, getZone, getStoreDoorCell, getStoreDoorCells,
  getLoadingPadBounds, LOADING_PAD_WIDTH, LOADING_PAD_HEIGHT,
} from "../logic/RoomLayout.js";
import { ShiftClock } from "../logic/ShiftClock.js";
import { FixturePlacement } from "../logic/FixturePlacement.js";
import { setupSandboxRoom } from "../debug/SandboxRoom.js";
import { setupUiLab } from "../debug/UiLab.js";
import { ShelfStockingWindow } from "../logic/ShelfStockingWindow.js";
import { REGISTER_FRONT_OVERLAP, fixtureFacing } from "../logic/FixtureLayout.js";
import { UIWindow } from "../logic/UIWindow.js";
import { Messages, SHOP_MESSAGE_COLOR } from "../world/Messages.js";
import { ShiftSystem } from "../systems/ShiftSystem.js";
import { StaffSystem } from "../systems/StaffSystem.js";
import { SaveSystem } from "../systems/SaveSystem.js";
import { Areas } from "../world/Areas.js";
import { CameraRig } from "../world/CameraRig.js";
import { FixtureViews } from "../world/FixtureViews.js";
import { FixtureSystem } from "../systems/FixtureSystem.js";
import { SupplySystem } from "../systems/SupplySystem.js";
import { CustomerFlow } from "../systems/CustomerFlow.js";
import { createCustomerStore, createEmployeeStore } from "../systems/CharacterStore.js";
import { CheckoutSystem } from "../systems/CheckoutSystem.js";
import { CrateSystem } from "../systems/CrateSystem.js";
import { CrateWorld } from "../world/CrateWorld.js";
import { Navigation } from "../world/Navigation.js";
import { CheckoutWindow } from "../logic/CheckoutWindow.js";
import { PlayerControls } from "../input/PlayerControls.js";
import { database } from "./boot.js"; // the exported DatabaseManager singleton
import { installSceneTextSize } from "../logic/GameTextSize.js";
import { gameRandom, randomSeed } from "../core/Random.js";

// How far below the doorway cell's center a customer's feet must be for their head to stay
// under the top of the door opening (opening top is 24px above center, heads ~42px tall,
// tallest art reaches 50px).
const DOORWAY_FEET_OFFSET = 30;

function reputationPenaltyText(penalty, factionId) {
  const faction = factionId ? CUSTOMER_TRAITS[factionId] : null;
  if (factionId && !faction?.group) throw new Error(`Unknown customer faction: ${factionId}.`);
  return `-${penalty} store reputation${faction ? `\n-${penalty} ${faction.name} reputation` : ""}\nat shift end`;
}

// Reputation lost when a thrown crate hits a customer.
const CRATE_HIT_REPUTATION_PENALTY = 1;
// Reputation lost when a customer leaves the queue without a sale.
const ANGRY_REPUTATION_PENALTY = 1;
// Reputation lost once when a customer cannot find any of their primary items.
const MISSING_PRIMARY_REPUTATION_PENALTY = 1;

/**
 * The playable shop scene ("scene-game"), started from the title scene.
 * Owns every fixture, crate, and customer; all are torn down on scene shutdown.
 */
export class GameScene extends Phaser.Scene {
  // --- Scene setup ---

  constructor() {
    super("scene-game");
  }

  preload() {}

  /**
   * @param {{ savedShopData?: object, sandbox?: boolean, lab?: "ui", real?: boolean, seed?: number }} data -
   *   save to load, or none for a new shop; sandbox starts a DEV test area, which never saves:
   *   the Shelf Test Room, or the UI Lab when lab is "ui"; real starts a fresh game with every
   *   debug tool removed; seed fixes every gameplay dice roll so a session can be replayed
   */
  init(data = {}) {
    this.savedShopData = data.savedShopData ?? null;
    this.sandbox = data.sandbox === true;
    this.lab = this.sandbox && data.lab === "ui" ? "ui" : null;
    this.realMode = data.real === true;
    this.seed = Number.isInteger(data.seed) ? data.seed : randomSeed();
  }

  create() {
    gameRandom.reseed(this.seed);
    installSceneTextSize(this, Phaser);
    this.eventBus = new Events({ strict: true });
    this.controls = new PlayerControls(this);
    this.debugInfo = null;
    this.debugTools = null;
    this.interactables = new InteractableRegistry();
    this.shift = null;
    this.messages = new Messages(this, document.getElementById("game-message"));
    this.events.once("shutdown", () => {
      this.messages.destroy();
      this.shift?.destroy();
    });
    // Sync after Arcade Physics finalizes the player's and crates' positions for this frame.
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, () => this.crateSystem.syncCarriedCrate());
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, () => this.crateSystem.syncFloorStacks());
    this.gameState = new GameState({ items: database.getAllItems(), events: this.eventBus });
    this.saves = new SaveSystem(this);
    this.crateSystem = new CrateSystem(this);
    for (const property of [
      "restockCrates", "carriedCrate", "carriedCrates", "floorStacks", "markedStackBase", "markedFromTop",
    ]) {
      Object.defineProperty(this, property, {
        configurable: true,
        enumerable: true,
        get: () => this.crateSystem[property],
        set: (value) => { this.crateSystem[property] = value; },
      });
    }
    this.recalculateActiveFactions();
    this.shiftClock = new ShiftClock();
    this.customerFlow = new CustomerFlow(this);
    this.hud = new HUDController(
      this.gameState,
      this.shiftClock,
      () => this.shift.start(),
      () => this.saves.saveManually(),
      () => this.shift.endDay(),
      () => this.customerFlow.toggleTemporaryClosure(),
      () => this.confirmReturnToMainMenu(),
    );

    this.windowManager = new WindowManager();
    this.shift = new ShiftSystem(this);
    this.staffSystem = new StaffSystem(this);

    // Shop map: the authored tile room (see RoomLayout.js).
    this.room = new TileRoom(this);
    this.cameraRig = new CameraRig(this);

    // Static obstacles besides the room's own walls (shelves and other fixtures).
    this.obstacleGroup = this.physics.add.staticGroup();

    const salesFloor = getZone("sales_floor");
    const zonePixelX = salesFloor.gridX * TILE_SIZE;
    const zonePixelY = salesFloor.gridY * TILE_SIZE;
    const zonePixelW = salesFloor.gridW * TILE_SIZE;
    const zonePixelH = salesFloor.gridH * TILE_SIZE;

    // The shop's public doorway (see getStoreDoorCell): customers spawn just inside it and
    // leave back out through it. The back wall stays drawn behind the door.
    const { gx: doorGX, gy: doorGY } = getStoreDoorCell();
    for (const { gx, gy } of getStoreDoorCells()) this.room.openDoorway(gx, gy, this.room.wallArtAt(gx, gy));
    this.storeDoor = {
      x: this.room.worldX(doorGX),
      y: this.room.worldY(doorGY),
    };
    // Doors stand on the bottom edge of the back wall, where the floor starts.
    this.storeDoorAnimation = new SlidingDoor(this, {
      x: this.storeDoor.x,
      y: this.storeDoor.y + TILE_SIZE / 2,
      wallGroup: this.room.wallGroup,
    });

    this.areas = new Areas(this);
    this.cameraRig.createBackroomWindow();
    // Every placed fixture lives in the shop's saved state; this is the same registry.
    this.fixtures = this.gameState.shop.fixtures;
    // The register's body is solid to the player and crates only: customers queue almost
    // flush against its front edge, so it can't join obstacleGroup.
    this.registerGroup = this.physics.add.staticGroup();
    this.fixtureViews = new FixtureViews(this);
    this.fixtureSystem = new FixtureSystem(this);
    this.navigation = new Navigation({
      room: this.room,
      areas: this.areas,
      obstacleGroup: this.obstacleGroup,
      fixtures: this.fixtures,
      getStoreDoorBlocker: () => this.storeDoorAnimation?.door.blocker ?? null,
      getRegisterFacing: fixtureFacing,
      registerFrontOverlap: REGISTER_FRONT_OVERLAP,
      defaultBodySize: { width: SPRITE_DISPLAY_WIDTH, height: SPRITE_DISPLAY_HEIGHT },
    });
    for (const fixture of this.fixtures.all()) this.fixtureViews.show(fixture);

    // Customers spawn just inside the front door. The small jitter box keeps several quick
    // arrivals from stacking on one pixel.
    const { doorwayPoint } = this.storeDoorAnimation;
    this.customerSpawnBounds = {
      xMin: doorwayPoint.x - 8,
      xMax: doorwayPoint.x + 8,
      yMin: this.storeDoor.y + DOORWAY_FEET_OFFSET - 4,
      yMax: this.storeDoor.y + DOORWAY_FEET_OFFSET + 4,
    };
    // Customers leave by walking back out through the same door.
    this.exitPoint = { x: doorwayPoint.x, y: this.storeDoor.y + DOORWAY_FEET_OFFSET };

    this.checkoutSystem = new CheckoutSystem(this);
    this.checkoutWindow = new CheckoutWindow(this.windowManager);
    this.checkoutWindow.onFirstScan = () => this.checkoutSystem.operatingLine()[0]?.resetPatience();
    this.checkoutWindow.getRegisterScreenArea = () => this.checkoutSystem.getRegisterScreenArea();
    this.shelfStockingWindow = new ShelfStockingWindow(this);

    // Customers collide with walls and fixtures but not the register (they queue flush
    // against it) and not each other. The pathfinder can't route around moving customers,
    // so a self-collider only caused deadlocks; unique waypoints from the reserve*Slot
    // methods keep them apart instead, at the cost of brief visual overlap.
    this.customerGroup = this.physics.add.group();
    this.physics.add.collider(this.customerGroup, this.room.wallGroup);
    this.physics.add.collider(this.customerGroup, this.obstacleGroup);
    this.employeeGroup = this.physics.add.group();
    this.physics.add.collider(this.employeeGroup, this.room.wallGroup);
    this.physics.add.collider(this.employeeGroup, this.obstacleGroup);

    // The player spawns in open floor clear of the shelf and register. Like customers,
    // the player passes through customers.
    this.player = new Player(this, zonePixelX + zonePixelW * 0.5, zonePixelY + zonePixelH * 0.75);
    this.cameraRig.refresh();
    this.physics.add.collider(this.player.sprite, this.room.wallGroup);
    this.physics.add.collider(this.player.sprite, this.obstacleGroup);
    // The register is its own group so customers (who share obstacleGroup) can queue
    // flush against it; the player still collides with it.
    this.physics.add.collider(this.player.sprite, this.registerGroup);

    // Loading Pad: ordered crates spawn here and must be hauled in by hand. It fills the
    // two floor rows against the backroom's bottom wall.
    const loadingPad = getLoadingPadBounds();
    this.supply = new SupplySystem(this, new Phaser.Geom.Rectangle(
      (loadingPad.left + loadingPad.right) / 2 - LOADING_PAD_WIDTH / 2,
      (loadingPad.top + loadingPad.bottom) / 2 - LOADING_PAD_HEIGHT / 2,
      LOADING_PAD_WIDTH,
      LOADING_PAD_HEIGHT,
    ));
    this.supply.drawPad();
    this.restockCrates = []; // uncarried crates, at the Loading Pad or dropped on the floor
    this.crateWorld = new CrateWorld(this, {
      colliders: [this.room.wallGroup, this.obstacleGroup, this.registerGroup],
      padRect: this.supply.padRect,
      customerGroup: this.customerGroup,
      onCustomerHit: (customer, crate) => this.eventBus.emit(GAME_EVENTS.CUSTOMER_HIT_BY_CRATE, {
        customer,
        itemId: crate.itemId,
      }),
    });
    this.carriedCrate = null; // the uppermost carried crate, used for the next action
    this.carriedCrates = [];
    // Floor stacks: a bottom crate (in restockCrates) -> the crates sitting on it, lowest first.
    this.floorStacks = new Map();
    // Which floor stack the green arrow is on, and how many crates down from the top it points.
    this.markedStackBase = null;
    this.markedFromTop = 0;
    this.crateSystem.createViews();

    this.shiftClock.subscribe(({ started, isPaused }) => {
      const paused = started && isPaused;
      // Paused time must freeze the register too, or the player could ring up for free.
      this.checkoutWindow.setPaused(paused);
      if (paused) {
        this.controls.cancelPresses();
        this.shelfStockingWindow.stopHolding();
      }
      this.crateSystem.setMotionPaused(paused);
    });
    this.customers = [];
    this.employees = [];
    this.gameModules = new ModuleHost(this);
    this.cleaningSystem = this.gameModules.get("cleaning");
    this.hud.setCleanlinessEnabled(Boolean(this.cleaningSystem));
    this.events.once("shutdown", () => this.gameModules.destroy());
    this.customerStore = createCustomerStore(this);
    this.employeeStore = createEmployeeStore(this);
    for (const property of ["trash", "heldTrash"]) {
      Object.defineProperty(this, property, {
        configurable: true,
        enumerable: true,
        get: () => this.cleaningSystem?.[property],
        set: (value) => {
          if (this.cleaningSystem) this.cleaningSystem[property] = value;
        },
      });
    }
    this.fixtureSystem.applyCurrentLayout();
    this.fixturePlacement = new FixturePlacement(this);
    this.input.mouse.disableContextMenu();
    this.controlMode = new ControlMode(this);
    this.interactionSystem = new InteractionSystem(this);
    this.controls.install();

    // Constructed after the fixtures exist: its Supply tab reads their stock immediately
    // on construction (via SupplyRenderer -> supply.restockableItems()).
    this.managerTablet = new ManagerTablet(this.windowManager, this.gameState, this);
    // REAL games run without the debug recorder; every call site uses debugInfo?.
    this.debugInfo = this.realMode ? null : new DebugInfo(this);
    this.eventBus.on(GAME_EVENTS.CUSTOMER_HIT_BY_CRATE, ({ customer }) => {
      const penalty = CRATE_HIT_REPUTATION_PENALTY;
      customer.gameState.reputation.lose(penalty, customer.factionId);
      this.showFloatingText(
        customer.sprite.x,
        customer.sprite.y - 50,
        `Customer hit!\n${reputationPenaltyText(penalty, customer.factionId)}`,
        "#ef4444",
      );
      this.debugInfo?.recordCustomer("customer-hit-by-crate", customer);
    });
    this.eventBus.on(GAME_EVENTS.CUSTOMER_LEFT_ANGRY, ({ customer, cart }) => {
      const penalty = ANGRY_REPUTATION_PENALTY;
      customer.gameState.reputation.lose(penalty, customer.factionId);
      this.showFloatingText(
        customer.sprite.x,
        customer.sprite.y - 50,
        `Left angry!\n${reputationPenaltyText(penalty, customer.factionId)}`,
        "#ef4444",
      );
      this.checkoutSystem.handleAngryLeave(customer, cart);
    });
    this.eventBus.on(GAME_EVENTS.CUSTOMER_MISSING_PRIMARY, ({ customer, itemIds, itemNames }) => {
      const penalty = MISSING_PRIMARY_REPUTATION_PENALTY;
      customer.gameState.reputation.lose(penalty, customer.factionId);
      this.showFloatingText(
        customer.sprite.x,
        customer.sprite.y - 50,
        `Out of stock:\n${itemNames.join("\n")}\n${reputationPenaltyText(penalty, customer.factionId)}`,
        "#ef4444",
      );
      this.debugInfo?.record("customer-missing-primary", {
        customerId: this.debugInfo.identifyCustomer(customer),
        itemIds,
      });
    });
    this.shift.listen(this.eventBus);
    for (const [event, name] of [
      [GAME_EVENTS.CRATE_PICKED_UP, "crate-picked-up"],
      [GAME_EVENTS.CRATE_DROPPED, "crate-dropped"],
      [GAME_EVENTS.FIXTURE_OPENED, "fixture-opened"],
      [GAME_EVENTS.INVENTORY_TRANSFERRED, "inventory-transferred"],
      [GAME_EVENTS.REGISTER_SESSION_ENDED, "register-session-ended"],
      [GAME_EVENTS.REGISTER_SESSION_STARTED, "register-session-started"],
    ]) {
      this.eventBus.on(event, (details) => this.debugInfo?.record(name, details));
    }
    this.eventBus.on(GAME_EVENTS.SHIFT_ENDED, (details) => {
      this.debugInfo?.record("shift-ended", details);
    });
    this.eventBus.on(GAME_EVENTS.SHIFT_STARTED, (details) => {
      this.debugInfo?.record("shift-started", details);
    });
    // Debug tools are keyboard shortcuts plus HUD buttons; REAL games remove them all.
    DebugTools.showButtons(!this.realMode);
    this.debugTools = this.realMode ? null : new DebugTools(this);
    this.debugTools?.install();

    this.events.once("shutdown", () => {
      this.eventBus.clear();
      this.debugInfo?.destroy();
      this.debugTools?.destroy();
      this.fixturePlacement.destroy();
      this.managerTablet.uiWindow.onClose = null;
      this.managerTablet.inventoryTab.destroy();
      this.managerTablet.fixtureHighlight.destroy();
      this.autosaveTimer.remove();
      this.storeDoorAnimation.destroy();
      this.areas.destroy();
      this.hud.destroy();
      this.shelfStockingWindow.destroy();
      this.checkoutWindow.destroy();
      this.windowManager.destroy();
    });

    if (this.savedShopData) this.saves.loadAtStart(this.savedShopData);
    this.sandboxRoom = !this.sandbox ? null
      : this.lab === "ui" ? setupUiLab(this) : setupSandboxRoom(this);
    this.events.once("shutdown", () => {
      this.sandboxRoom?.destroy();
      this.sandboxRoom = null;
    });
    // Autosave check runs every 1000 ms; it only saves while the store is closed.
    this.autosaveTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => this.saves.requestAutosave(),
    });
    // A "!" floats over the player while abandoned items wait in the Go-Backs bin.
    this.goBacksBadge = this.add.text(0, 0, "!", {
      fontFamily: "Courier New, monospace",
      fontSize: "20px",
      fontStyle: "bold",
      color: "#fbbf24",
      stroke: "#111827",
      strokeThickness: 4,
    }).setOrigin(0.5, 1).setDepth(9000).setVisible(false);
    this.gameState.subscribe(() => {
      this.saves.requestAutosave();
      this.refreshShelfStockDisplays();
      this.saves.updateControls();
      this.refreshGoBacksBadge();
    });
    this.shiftClock.subscribe(() => this.saves.updateControls());
  }

  // Whether the player looks straight at the fixture's front (it faces back at them).
  isPlayerFacingFixture(fixture, player = this.player) {
    const opposite = { down: "up", up: "down", left: "right", right: "left" };
    const facing = (player ?? this.player)?.currentFacing;
    return Boolean(facing) && opposite[facing] === fixtureFacing(fixture);
  }

  // Where the player reaches from: his feet, which must be right up against what he uses.
  getInteractionOrigin() {
    const { x, y, body } = this.player.sprite;
    const feet = body?.left !== undefined
      ? { left: body.left, right: body.right, top: body.top, bottom: body.bottom }
      : { left: x, right: x, top: y, bottom: y };
    return { x, y, feet, facing: this.player.currentFacing };
  }

  /**
   * Gap (px) between the edge of the player's feet that faces `rect` and that rect, when he
   * faces it with his feet lined up with it (at least partly); Infinity otherwise.
   * @param {{ feet: object, facing: string }} origin - from getInteractionOrigin()
   * @param {{ left: number, right: number, top: number, bottom: number }} rect - px
   */
  feetReachTo({ feet, facing }, rect) {
    const acrossX = feet.right > rect.left && feet.left < rect.right;
    const acrossY = feet.bottom > rect.top && feet.top < rect.bottom;
    const gap = {
      up: acrossX ? feet.top - rect.bottom : NaN,
      down: acrossX ? rect.top - feet.bottom : NaN,
      left: acrossY ? feet.left - rect.right : NaN,
      right: acrossY ? rect.left - feet.right : NaN,
    }[facing];
    // A small negative gap is fine: his feet may tuck slightly under the art.
    return Number.isFinite(gap) && gap >= -TILE_SIZE / 2 ? Math.max(0, gap) : Infinity;
  }

  refreshShelfStockDisplay(shelf) {
    shelf?.stockDisplay?.sync();
    shelf?.stockItemsDisplay?.sync();
  }

  refreshShelfStockDisplays() {
    for (const shelf of this.fixtures.shelves()) this.refreshShelfStockDisplay(shelf);
  }

  // --- On-screen messages and menus ---

  showShopMessage(message) {
    this.messages.show(message, SHOP_MESSAGE_COLOR);
  }

  showGameMessage(message, color = SHOP_MESSAGE_COLOR) {
    this.messages.show(message, color);
  }

  // Reloading the page (rather than switching scenes) guarantees a completely fresh start
  // and also picks up code changes during development.
  confirmReturnToMainMenu() {
    if (!this.mainMenuWindow) {
      this.mainMenuWindow = new UIWindow({
        id: "main-menu-confirmation", title: "MAIN MENU", width: "400px", height: "auto",
        x: 80, y: 120, shouldCloseOtherWindows: true,
        contentHTML: `
          <p>Go back to the title screen? Anything you haven't saved will be lost.</p>
          <button class="action-btn" data-confirm-main-menu>GO TO TITLE SCREEN</button>
          <button class="action-btn" data-cancel-main-menu>KEEP PLAYING</button>
        `,
      }, this.windowManager);
      this.mainMenuWindow.element.querySelector("[data-confirm-main-menu]")
        .addEventListener("click", () => window.location.reload());
      this.mainMenuWindow.element.querySelector("[data-cancel-main-menu]")
        .addEventListener("click", () => this.mainMenuWindow.close());
    }
    this.mainMenuWindow.openWindow();
  }

  // --- Pathfinding ---

  /**
   * @param {ShelfFixture | null} [excludedShelf] - the customer's next planned stop
   * @returns {ShelfFixture | null} a different currently stocked shelf to browse
   */
  getRandomBrowseShelf(excludedShelf = null) {
    const shelves = this.fixtures.shelves().filter((shelf) =>
      shelf !== excludedShelf && shelf.findAvailableSlot(),
    );
    return shelves.length ? gameRandom.pick(shelves) : null;
  }

  getNavigationObstacles(bodySize = { width: SPRITE_DISPLAY_WIDTH, height: SPRITE_DISPLAY_HEIGHT }) {
    return this.navigation.getNavigationObstacles(bodySize);
  }

  isNavigationSegmentClear(from, to, obstacles) {
    return this.navigation.isNavigationSegmentClear(from, to, obstacles);
  }

  // Whether a character-sized body can move directly between two world positions.
  isStraightWalkClear(fromX, fromY, toX, toY, bodySize) {
    return this.navigation.isStraightWalkClear(fromX, fromY, toX, toY, bodySize);
  }

  /**
   * A smoothed path between two world points, routed around walls and fixtures. Null means
   * no safe route exists and must not be treated as a direct path.
   * @param {number} fromX - px
   * @param {number} fromY - px
   * @param {number} toX - px
   * @param {number} toY - px
   * @param {{width: number, height: number}} [bodySize] - collision size in px; defaults to a customer
   * @returns {Array<{ x: number, y: number }> | null} world-space waypoints
   */
  findPath(fromX, fromY, toX, toY, bodySize) {
    return this.navigation.findPath(fromX, fromY, toX, toY, bodySize);
  }

  findAreaPath(fromX, fromY, toX, toY, bodySize) {
    return this.navigation.findAreaPath(fromX, fromY, toX, toY, bodySize);
  }

  // --- Supply, pricing, and the Loading Pad ---

  // The nearest reachable shelf, shared by crate delivery and fixture opening.
  getNearbyFixture() {
    return this.interactables.findTarget("fixture", this.getInteractionOrigin())?.target ?? null;
  }

  /**
   * Credits for one crate of this item. Shared by the Supply tab's price display and
   * ordering, so both always agree.
   * @param {object} item - catalog item
   * @returns {number} credits
   */
  /**
   * The player's own price, falling back to today's market price if never set.
   * @param {string} itemId
   * @returns {number} credits
   */
  getStorePrice(itemId) {
    return this.gameState.catalog.storePrices[itemId] ?? this.gameState.market.getPrice(itemId);
  }

  /**
   * Accepts prices to the cent and rejects anything below 1 credit.
   * @param {string} itemId
   * @param {number} price - credits
   * @returns {boolean} whether the price was accepted
   */
  setStorePrice(itemId, price) {
    if (!isMoney(price) || price < 1) {
      this.showShopMessage("Enter a price of at least 1 credit, with no more than two decimal places.");
      return false;
    }
    this.gameState.catalog.setPrice(itemId, price);
    return true;
  }

  // Inventory tab rows: every owned item, including items currently held by customers.
  getInventoryItems() {
    const totals = new Map();
    const add = (entry, column) => {
      if (!entry.itemId || entry.quantity <= 0) return;
      if (!totals.has(entry.itemId)) {
        totals.set(entry.itemId, { offShelves: 0, stock: 0, inCustomerCarts: 0 });
      }
      totals.get(entry.itemId)[column] += entry.quantity;
    };

    for (const fixture of this.fixtures.shelves()) {
      for (const entry of fixture.stock) add(entry, "stock");
    }
    for (const entry of this.gameState.goBacks.stock) add(entry, "offShelves");
    const floorCrates = this.crateSystem.getFloorCrates();
    for (const crate of floorCrates) add(crate, "offShelves");
    for (const crate of this.crateSystem.getCarriedCrates()) {
      if (crate.kind === "item") add(crate, "offShelves");
    }
    for (const employee of this.employees ?? []) {
      const crate = employee.currentJob?.crate;
      if (crate?.isCarried && !floorCrates.includes(crate)) add(crate, "offShelves");
    }
    for (const customer of this.customers) {
      if (customer.state === "LEAVING") continue;
      for (const { itemId } of customer.cart) {
        add({ itemId, quantity: 1 }, "inCustomerCarts");
      }
    }
    return database.getAllItems()
      .filter((item) => totals.has(item.id))
      .map((item) => ({
        item,
        ...totals.get(item.id),
        marketPrice: this.gameState.market.getPrice(item.id),
        unitCost: roundMoney(this.supply.crateCost(item) / getCrateOrderQuantity(item)),
        storePrice: this.getStorePrice(item.id),
      }));
  }

  // Customer factions follow the player's licenses.
  recalculateActiveFactions() {
    const activeFactions = getLicensedFactionIds(
      this.gameState.catalog.licenses,
      database.getAllItems(),
    );
    this.gameState.catalog.setActiveFactions(activeFactions);
  }

  // --- Player interaction and crates ---

  getHoldToMoveFixture() {
    return this.fixtureSystem.getHoldToMoveFixture();
  }

  getFixtureMoveAction() {
    return this.interactables.findTarget(
      "moveFixture",
      this.getInteractionOrigin(),
      null,
      this.player,
      this.input,
      "fixture-move",
    );
  }

  // E delivers/places a carried crate, opens a nearby fixture, or toggles register operation.
  handleInteract() {
    return this.interactionSystem.handleInteract();
  }

  getRegisterInteractionAction() {
    return this.interactables.getActions(
      this.player,
      this.input,
      this.getInteractionOrigin(),
    ).find((action) => action.kind === "register" && action.action === "interact");
  }

  getPortalInteractionAction() {
    return this.interactables.findTarget(
      "interact",
      this.getInteractionOrigin(),
      null,
      this.player,
      this.input,
      "portal",
    );
  }

  getCrateControlAction(which) {
    return this.interactables.findTarget(
      which,
      this.getInteractionOrigin(),
      null,
      this.player,
      this.input,
      "crate-control",
    );
  }

  isNearTrashcan() {
    return Boolean(this.fixtureSystem.getNearbyTrashcan());
  }

  // The trashcan the player faces, with its edge a few steps ahead, or null. Standing
  // beside a trashcan while facing something else never counts.
  getNearbyTrashcan() {
    return this.fixtureSystem.getNearbyTrashcan();
  }

  // --- Trash and cleanliness (documentation/modules/Cleaning.md) ---

  // Where loose trash may lie: open sales floor that no wall or fixture covers.
  isOpenTrashSpot(x, y) {
    return this.cleaningSystem?.isOpenTrashSpot(x, y) ?? false;
  }

  /**
   * A customer drops a piece of trash at their feet, if that spot is open shop floor.
   * @returns {boolean} whether it was dropped
   */
  dropTrash(x, y) {
    return this.cleaningSystem?.dropTrash(x, y) ?? false;
  }

  // The trash just ahead of his feet, the way he faces.
  findTrashInFront() {
    return this.cleaningSystem?.findTrashInFront() ?? null;
  }

  pickUpTrash(piece) {
    return this.cleaningSystem?.pickUpTrash(piece) ?? false;
  }

  throwAwayHeldTrash() {
    return this.cleaningSystem?.throwAwayHeldTrash() ?? false;
  }

  // Q with trash in hand: it goes back on the floor just ahead of him, or at his feet.
  dropHeldTrash() {
    return this.cleaningSystem?.dropHeldTrash() ?? false;
  }

  // Trash in hand still counts against the store until it's in a trashcan.
  getCleanliness() {
    return this.cleaningSystem?.getCleanliness() ?? null;
  }

  getCleanlinessPercent() {
    return this.cleaningSystem?.getCleanlinessPercent() ?? null;
  }

  /**
   * A customer found the store too dirty: store reputation only, never their faction's.
   * @param {Customer} customer
   * @param {"upset" | "walk-out"} verdict
   */
  reportCleanlinessVerdict(customer, verdict) {
    this.cleaningSystem?.reportCleanlinessVerdict(customer, verdict);
  }

  /**
   * Opens a shelf's window if the player is in range; silently does nothing if not.
   * @param {object} [fixture] - the clicked fixture; the E key passes none and uses the nearest
   * @returns {boolean} whether a window opened
   */
  tryOpenFixtureWindow(fixture) {
    if (!this.controlMode.allows("interact")) return false;
    const target = this.interactables.findTarget(
      "fixture",
      this.getInteractionOrigin(),
      fixture,
    )?.target;
    if (!target) return false;
    const fixtureWindow = this.shelfStockingWindow;
    const alreadyOpen = fixtureWindow.uiWindow.isOpen && fixtureWindow.fixture === target;
    fixtureWindow.openForFixture(target, this.fixtures.displayName(target));
    if (!alreadyOpen) {
      this.eventBus.emit(GAME_EVENTS.FIXTURE_OPENED, { fixtureId: target.id, type: target.type });
    }
    return true;
  }

  // --- Crate handling ---
  // Space (X) picks crates up and Q (Y) puts them down: a tap moves one crate, a hold moves a
  // stack. A green arrow marks the floor crate those buttons act on; floor crates stack up to
  // FLOOR_STACK_MAX high.

  // The help lines on the right of the bottom bar: what each button does right now.
  updateCrateHint() {
    return this.interactionSystem.updateHint();
  }

  // People (player, customers, staff) are drawn lower-on-screen in front: a customer walking
  // down past someone passes behind them. Everyone stays above shelves and floor crates.
  sortPeopleByFeet() {
    const people = [
      this.player?.sprite,
      ...this.customers.map((customer) => (customer.isDestroyed ? null : customer.sprite)),
      ...this.employees.map((employee) => employee.sprite),
    ];
    for (const sprite of people) {
      if (sprite?.active) sprite.setDepth(PEOPLE_DEPTH_BASE + (sprite.body?.bottom ?? sprite.y));
    }
    // Tucked behind the counter, the register draws just over him and hides his legs.
    if (this.checkoutSystem.registerDepthBeforeTuck != null && this.player?.sprite) {
      this.checkoutSystem.operatingRegisterFixture?.sprite?.setDepth(this.player.sprite.depth + 0.5);
    }
  }

  // Keyboard equivalent of clicking the register: steps behind the counter if close enough,
  // even with no customer waiting. Returns false so handleInteract can show its fallback.
  tryOpenRegister() {
    if (!this.checkoutSystem.isPlayerNearRegister()) return false;
    this.checkoutSystem.openRegisterWindow();
    return true;
  }

  showFloatingText(x, y, text, color) {
    this.messages.floatText(x, y, text, color);
  }

  // --- Go-Backs badge ---

  refreshGoBacksBadge() {
    const count = this.gameState.goBacks.stock.reduce((sum, entry) => sum + entry.quantity, 0);
    this.goBacksBadge.setVisible(count > 0);
    this.positionGoBacksBadge();
  }

  positionGoBacksBadge() {
    if (!this.goBacksBadge?.visible || !this.player?.sprite) return;
    const bounds = this.player.sprite.getBounds();
    this.goBacksBadge.setScale(this.cameraRig.popupScale()).setPosition(bounds.centerX, bounds.top - 2);
  }

  // --- Register ---

  // Clicking the register or pressing E nearby always puts the player behind the counter,
  // customer or not; only the scan window needs someone at the front of the line. A
  // customer who arrives later opens it automatically (see handleJoinQueue).
  getItem(itemId) {
    return database.getItem(itemId);
  }

  // --- Register queue and checkout ---

  /**
   * The customer line for one register, created on first use.
   * @param {object} register - register fixture
   * @returns {Customer[]}
   */
  noteCustomerGaveUp(customer, reason) {
    this.sandboxRoom?.noteGaveUp(customer, reason);
  }

  // --- Frame update and shift flow ---

  update(time, delta) {
    this.controls.handleGamepad(time, delta);
    if (this.controlMode.getMode() !== CONTROL_MODES.PAUSED) this.fixturePlacement.update();
    this.debugTools?.update();
    this.crateWorld.update(delta);
    // The front door opens only for customers: arrivals hold it open themselves, and
    // leaving customers open it on approach. It ignores the player.
    this.storeDoorAnimation.update(delta, [
      ...this.customers.map((customer) =>
        !customer.isDestroyed && customer.state === "LEAVING" ? customer.sprite : null),
    ]);
    this.areas.update(delta);
    // Pausing a started shift freezes time entirely: customers and arrivals included.
    // Before the shift starts the clock also reads as paused, but the player moves freely.
    const mode = this.controlMode.getMode();
    const movementFrozen = (this.shiftClock.isPaused && this.shiftClock.started) ||
      mode === CONTROL_MODES.LOADING;
    this.sortPeopleByFeet();

    if (movementFrozen) {
      // Skipping customer update() also freezes their state-machine timers, not just movement.
      this.player.sprite.body.setVelocity(0, 0);
      this.player.forceFacing(this.player.currentFacing);
      for (const crate of this.restockCrates) if (crate.isPushed) crate.stopPush();
    } else {
      this.player.update(delta);
      this.crateWorld.updateCratePushing(delta);
      this.crateSystem.syncCarriedCrate();
      this.crateSystem.syncFloorStacks();
    }
    if (movementFrozen || this.fixturePlacement.active) {
      this.customers.forEach((customer) => customer.standStill());
      this.employees.forEach((employee) => employee.standStill());
    } else {
      this.customers.forEach((customer) => customer.update(delta));
      this.employees.forEach((employee) => employee.update(delta));
    }
    this.hud.renderStamina(this.player);
    if (this.cleaningSystem) this.hud.renderCleanliness(this.cleaningSystem.getCleanliness());
    this.gameModules.update(time, delta);

    this.shiftClock.update(delta);
    this.positionGoBacksBadge();
    this.controls.updatePresses();
    this.updateCrateHint();
    this.crateSystem.updateCrateMarker();
    for (const fixture of this.fixtures.shelves()) {
      fixture.stockDisplay?.update(time);
      fixture.facingLight?.update(time);
    }
    this.customerFlow.refreshPool(delta);
    this.customerFlow.spawnScheduled();
    if (!movementFrozen && !this.fixturePlacement.active) this.checkoutSystem.autoPackGoBacks(time);
    this.shift.update();
  }
}
