// ==========================================
// FILE: game.js
// ==========================================
// The main shop scene: builds the room, fixtures, player, and Loading Pad, then runs the
// shift loop (customers, checkout, crates) and off-shift saving.
// See also: TileRoom.js (map), FixtureRegistry.js (fixtures), Customer.js (shopper AI).
import { WindowManager } from "../logic/WindowManager.js";
import { ManagerTablet } from "../logic/ManagerTablet.js";
import { GameState } from "../state/GameState.js";
import { getStaffLimitReason } from "../logic/ShopProgression.js";
import { HUDController } from "../logic/HUDController.js";
import { DebugInfo } from "../debug/DebugInfo.js";
import { DebugTools } from "../debug/DebugTools.js";
import { Events, GAME_EVENTS } from "../core/Events.js";
import { ControlMode, CONTROL_MODES } from "../logic/ControlMode.js";
import { InteractableRegistry } from "../logic/InteractableRegistry.js";
/** @typedef {import("../logic/ShelfFixture.js").ShelfFixture} ShelfFixture */
import { SPRITE_DISPLAY_WIDTH, SPRITE_DISPLAY_HEIGHT } from "../logic/Customer.js";
import { Employee } from "../logic/Employee.js";
import { getEmployeeTrainingOffer } from "../logic/EmployeeTraining.js";
import { isMoney, roundMoney } from "../logic/Money.js";
import { CUSTOMER_TRAITS } from "../logic/CustomerTraits.js";
import { getLicensedFactionIds } from "../logic/CustomerPooling.js";
import { Player, PLAYER_CRATE_HOLD_OFFSET } from "../logic/Player.js";
import { CRATE_STACK_SPACING } from "../logic/Crate.js";
import {
  FLOOR_STACK_MAX, HOLD_KEY_MS, MAX_CARRIED_CRATES,
} from "../logic/CrateStack.js";
import { CrateFooter } from "../logic/CrateFooter.js";
import { getCrateOrderQuantity } from "../logic/SupplyOrder.js";
import { TileRoom } from "../logic/TileRoom.js";
import { SlidingDoor } from "../logic/SlidingDoor.js";
import {
  TILE_SIZE, getZone, getStoreDoorCell, getStoreDoorCells,
  getLoadingPadBounds, LOADING_PAD_WIDTH, LOADING_PAD_HEIGHT,
} from "../logic/RoomLayout.js";
import { ShiftClock } from "../logic/ShiftClock.js";
import { findFreeWalkPath } from "../logic/Pathfinder.js";
import { FixturePlacement } from "../logic/FixturePlacement.js";
import { setupSandboxRoom } from "../debug/SandboxRoom.js";
import { setupUiLab } from "../debug/UiLab.js";
import { ShelfStockingWindow } from "../logic/ShelfStockingWindow.js";
import { REGISTER_FRONT_OVERLAP, getFixtureType, fixtureFacing, fixtureFacingStep, fixtureInteractionDistance, validateFixtureLayout } from "../logic/FixtureLayout.js";
import { validateShopSave } from "../logic/ShopSave.js";
import { UIWindow } from "../logic/UIWindow.js";
import { Messages, SHOP_MESSAGE_COLOR } from "../world/Messages.js";
import { ShiftSystem } from "../systems/ShiftSystem.js";
import { AREA, Areas } from "../world/Areas.js";
import { CameraRig } from "../world/CameraRig.js";
import { FixtureViews } from "../world/FixtureViews.js";
import { FixtureSystem } from "../systems/FixtureSystem.js";
import { SupplySystem } from "../systems/SupplySystem.js";
import { CustomerFlow } from "../systems/CustomerFlow.js";
import { CheckoutSystem } from "../systems/CheckoutSystem.js";
import { CrateSystem } from "../systems/CrateSystem.js";
import { CrateWorld } from "../world/CrateWorld.js";
import { CleaningSystem } from "../modules/cleaning/CleaningSystem.js";
import { CheckoutWindow } from "../logic/CheckoutWindow.js";
import { GamepadInput, PAD } from "../logic/GamepadInput.js";
import { UINavigator } from "../logic/UINavigator.js";
import { controlLabel, getInputDevice, setInputDevice } from "../logic/InputDevice.js";
import { SaveManager } from "../../SaveManager.js";
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

function segmentIntersectsRectangle(from, to, rectangle) {
  const epsilon = 0.001;
  const left = rectangle.left + epsilon;
  const right = rectangle.right - epsilon;
  const top = rectangle.top + epsilon;
  const bottom = rectangle.bottom - epsilon;
  let minimum = 0;
  let maximum = 1;
  const clip = (origin, delta, low, high) => {
    if (Math.abs(delta) < epsilon) return origin > low && origin < high;
    const first = (low - origin) / delta;
    const last = (high - origin) / delta;
    minimum = Math.max(minimum, Math.min(first, last));
    maximum = Math.min(maximum, Math.max(first, last));
    return minimum < maximum;
  };
  return clip(from.x, to.x - from.x, left, right) &&
    clip(from.y, to.y - from.y, top, bottom);
}

// Reputation lost when a thrown crate hits a customer.
const CRATE_HIT_REPUTATION_PENALTY = 1;
// People sort by feet position above this; the tallest map (about 6,800 pixels) stays below
// the 9,000+ layer used for speech bubbles, prompts, and gauges.
const PEOPLE_DEPTH_BASE = 2000;
// Reputation lost when a customer leaves the queue without a sale.
const ANGRY_REPUTATION_PENALTY = 1;
// Reputation lost once when a customer cannot find any of their primary items.
const MISSING_PRIMARY_REPUTATION_PENALTY = 1;

// Register reach (px): the gap allowed between the player's feet and the register graphic.
const REGISTER_INTERACT_RANGE = 12;
// How far the operating player's feet sit past the register graphic's top edge (px).
const REGISTER_BEHIND_OVERLAP = 10;
// How far (px) the player's feet may be from a shelf's front edge to use it: a few pixels.
const SHELF_INTERACT_RANGE = 12;

/**
 * Grid-cell keys ("gx,gy") overlapped, even partially, by a world-space rectangle. Fixture
 * pixel bounds don't always land on cell boundaries.
 * @param {number} centerX - px
 * @param {number} centerY - px
 * @param {number} width - px
 * @param {number} height - px
 * @returns {string[]}
 */
function getOccupiedCellKeys(centerX, centerY, width, height) {
  const gxMin = Math.floor((centerX - width / 2) / TILE_SIZE);
  const gxMax = Math.floor((centerX + width / 2 - 0.01) / TILE_SIZE);
  const gyMin = Math.floor((centerY - height / 2) / TILE_SIZE);
  const gyMax = Math.floor((centerY + height / 2 - 0.01) / TILE_SIZE);

  const keys = [];
  for (let gy = gyMin; gy <= gyMax; gy += 1) {
    for (let gx = gxMin; gx <= gxMax; gx += 1) {
      keys.push(`${gx},${gy}`);
    }
  }
  return keys;
}

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
    this.debugInfo = null;
    this.debugTools = null;
    this.shift = null;
    this.loadFailed = false;
    this.autosaveBlocked = false;
    this.saveInProgress = null;
    this.autosaveQueued = false;
    this.lastSavedSnapshot = null;
    this.saveStatus = "Not saved yet";
    this.messages = new Messages(this, document.getElementById("game-message"));
    this.events.once("shutdown", () => {
      this.messages.destroy();
      this.shift?.destroy();
    });
    // Sync after Arcade Physics finalizes the player's and crates' positions for this frame.
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, this.syncCarriedCrate, this);
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, this.syncFloorStacks, this);
    this.gameState = new GameState({ items: database.getAllItems(), events: this.eventBus });
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
      () => this.saveManually(),
      () => this.shift.endDay(),
      () => this.customerFlow.toggleTemporaryClosure(),
      () => this.confirmReturnToMainMenu(),
    );

    this.windowManager = new WindowManager();
    this.shift = new ShiftSystem(this);

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
    // The pick-up or put-down button being held, until it's released (tap) or held long enough (hold).
    this.cratePress = null;
    // Points down at the crate the pick-up button would take, or the stack the put-down button adds to.
    this.pickupMarker = this.add.graphics().setDepth(20000).setVisible(false);
    this.pickupMarker.fillStyle(0x22c55e).lineStyle(1, 0x052e16)
      .fillTriangle(-5, -4, 5, -4, 0, 4).strokeTriangle(-5, -4, 5, -4, 0, 4);
    this.crateFooter = new CrateFooter();
    this.events.once("shutdown", () => this.crateFooter.destroy());

    this.crateMotionPaused = false;
    this.shiftClock.subscribe(({ started, isPaused }) => {
      const paused = started && isPaused;
      // Paused time must freeze the register too, or the player could ring up for free.
      this.checkoutWindow.setPaused(paused);
      if (paused) {
        this.cratePress = null;
        this.interactPress = null;
        this.fixtureMovePress = null;
        this.shelfStockingWindow.stopHolding();
      }
      if (paused === this.crateMotionPaused) return;
      this.crateMotionPaused = paused;
      for (const crate of this.restockCrates) crate.setPaused(paused);
    });
    this.customers = [];
    this.employees = [];
    this.cleaningSystem = new CleaningSystem(this);
    for (const property of ["trash", "heldTrash"]) {
      Object.defineProperty(this, property, {
        configurable: true,
        enumerable: true,
        get: () => this.cleaningSystem[property],
        set: (value) => { this.cleaningSystem[property] = value; },
      });
    }
    this.fixtureSystem.applyCurrentLayout();
    this.fixturePlacement = new FixturePlacement(this);
    this.input.mouse.disableContextMenu();
    this.interactables = new InteractableRegistry();
    this.registerInteractableSources();
    this.controlMode = new ControlMode(this);
    this.bindPauseInputGuard();

    // E opens fixtures or delivers/places crates; holding Ctrl facing a fixture picks it up
    // to move. Space picks crates up and Q puts them down (tap: one crate, hold: a stack);
    // Q with empty hands packs the Go-Backs. See bindCrateKeys.
    this.interactPress = null;
    this.fixtureMovePress = null;
    this.input.keyboard.on("keydown-E", (event) => {
      if (!event.repeat) this.handleInteract();
    });
    this.bindCrateKeys();
    // Hold H: every piece of trash on the floor lights up, even behind shelves.
    this.highlightTrashKey = this.input.keyboard.addKey("H", false);

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
    // I or Tab opens the tablet and, while it's open, closes it again.
    this.handleTabletKey = (event) => {
      if (event.code !== "KeyI" && event.code !== "Tab") return;
      if (event.code === "Tab") event.preventDefault();
      if (event.repeat) return;
      const tablet = this.managerTablet;
      if (tablet.uiWindow.isOpen) {
        if (event.code === "KeyI" && event.target?.matches?.("input, textarea")) return;
        tablet.uiWindow.close();
      } else if (this.controlMode.allows("tablet")) {
        tablet.openWindow();
      }
    };
    document.addEventListener("keydown", this.handleTabletKey);
    this.events.once("shutdown", () => document.removeEventListener("keydown", this.handleTabletKey));

    // The shop camera: PageUp zooms in, PageDown zooms out (never past the whole shop).
    this.bindControlKey("keydown-PAGE_UP", "cameraZoom", () => this.cameraRig.zoomBy(1));
    this.bindControlKey("keydown-PAGE_DOWN", "cameraZoom", () => this.cameraRig.zoomBy(-1));

    // Debug tools are keyboard shortcuts plus HUD buttons; REAL games remove them all.
    DebugTools.showButtons(!this.realMode);
    this.debugTools = this.realMode ? null : new DebugTools(this);
    this.debugTools?.install();

    // The shift clock's manual pause: freezes time entirely so the player can think.
    this.bindControlKey("keydown-P", "pause", () => this.shiftClock.togglePause());
    // Esc pauses too, unless it just closed a window. Other screens on top block pausing
    // anyway; the register doesn't, so Esc pauses there like P.
    // A plain window listener rather than Phaser's: some browsers cancel Esc before the page
    // sees it, and Phaser ignores cancelled keys. This runs after WindowManager's document
    // listener, so a press that closed a window is already marked consumed.
    this.handleEscPause = (event) => {
      if (event.key !== "Escape" || event.repeat) return;
      if (this.windowManager.isConsumed(event)) return;
      if (!this.controlMode.allows("pause")) return;
      this.shiftClock.togglePause();
    };
    window.addEventListener("keydown", this.handleEscPause);
    this.events.once("shutdown", () => window.removeEventListener("keydown", this.handleEscPause));

    // Controller: the same actions as the keys above (see handleGamepad), plus a menu cursor
    // for every window.
    this.padInput = new GamepadInput();
    this.uiNavigator = new UINavigator({
      onUnhandled: (button) => this.handleUnusedMenuButton(button),
    });

    this.events.once("shutdown", () => {
      this.uiNavigator.destroy();
      this.eventBus.clear();
      this.debugInfo?.destroy();
      this.debugTools?.destroy();
      this.fixturePlacement.destroy();
      this.managerTablet.uiWindow.onClose = null;
      this.managerTablet.disableInventoryNavigation();
      this.managerTablet.fixtureHighlight.destroy();
      this.autosaveTimer.remove();
      this.storeDoorAnimation.destroy();
      this.areas.destroy();
      this.hud.destroy();
      this.shelfStockingWindow.destroy();
      this.checkoutWindow.destroy();
      this.windowManager.destroy();
    });

    this.saveManager = new SaveManager({ shop: this });
    if (this.savedShopData) {
      try {
        this.applySave(this.savedShopData);
      } catch (error) {
        this.loadFailed = true;
        this.player.inputEnabled = false;
        this.handlePersistenceError(error);
      }
    }
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
      callback: () => this.requestAutosave(),
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
      this.requestAutosave();
      this.refreshShelfStockDisplays();
      this.updateSaveControls();
      this.refreshGoBacksBadge();
    });
    this.shiftClock.subscribe(() => this.updateSaveControls());
  }

  bindControlKey(eventName, action, callback) {
    this.input.keyboard.on(eventName, (...args) => {
      if (this.controlMode.allows(action)) callback(...args);
    });
  }

  bindPauseInputGuard() {
    const events = [
      "keydown", "mousedown", "pointerdown", "click", "dblclick",
      "contextmenu", "wheel", "touchstart", "touchmove", "mousemove", "pointermove",
    ];
    const handler = (event) => this.handlePausedInput(event);
    for (const type of events) window.addEventListener(type, handler, { capture: true, passive: false });
    this.events.once("shutdown", () => {
      for (const type of events) window.removeEventListener(type, handler, true);
    });
  }

  handlePausedInput(event) {
    if (this.controlMode.getMode() !== CONTROL_MODES.PAUSED) return;
    if (event.type !== "keydown" && event.target?.closest?.("#hud-pause-btn")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Handle resume before window-close handlers or Phaser see the key.
    if (event.type === "keydown" && !event.repeat &&
      (event.code === "KeyP" || event.key === "Escape")) {
      this.shiftClock.togglePause();
    }
  }

  /**
   * One frame of controller input. A screen on top gets it through the menu cursor;
   * otherwise each button runs the same action as its keyboard key:
   *   A = E (interact)   X = Space (pick up / throw)   Y = Q (put down; packs the Go-Backs with empty hands)
   *   R3 (right stick click) = Ctrl (green arrow one crate down)   Back = I (tablet)
   *   LB/RB = PageDown/PageUp (zoom)   Start = top bar (pause, start shift, save, ...)
   *   B = leave the register   left stick / D-pad = walk   triggers = dash
   * @param {number} time
   * @param {number} delta
   */
  handleGamepad(time, delta) {
    const pad = this.padInput;
    pad.poll(time);
    if (pad.hadInput) setInputDevice("gamepad");
    const mode = this.controlMode.getMode();
    if (mode === CONTROL_MODES.LOADING && !this.loadFailed) return;
    if (mode === CONTROL_MODES.PAUSED) {
      if (pad.justPressed(PAD.START)) {
        this.shiftClock.togglePause();
        this.uiNavigator.setHudOpen(false);
      }
      return;
    }

    if (pad.justPressed(PAD.START)) this.uiNavigator.toggleHud();
    if (pad.justPressed(PAD.BACK)) {
      if (this.managerTablet.uiWindow.isOpen) this.managerTablet.uiWindow.close();
      else if (this.controlMode.allows("tablet")) this.managerTablet.openWindow();
    }
    if (this.checkoutWindow.usesChitInput()) {
      const chitKeys = [
        [PAD.UP, "up"],
        [PAD.DOWN, "down"],
        [PAD.LEFT, "left"],
        [PAD.RIGHT, "right"],
      ];
      const pressedKey = chitKeys.find(([button]) => pad.justPressed(button));
      if (pressedKey) {
        this.checkoutWindow.enterChitDirection(pressedKey[1]);
        return;
      }
    }
    if (this.uiNavigator.handle(pad, delta)) return;

    if (mode === CONTROL_MODES.PLACING) {
      this.fixturePlacement.handlePad(pad, delta);
    } else {
      if (pad.justPressed(PAD.A)) this.startInteractPress({ button: PAD.A });
      if (pad.justPressed(PAD.X) && !this.checkoutWindow.usesSpaceKey()) {
        this.startCratePress("pickUp", { button: PAD.X });
      }
      if (pad.justPressed(PAD.Y)) this.startCratePress("putDown", { button: PAD.Y });
      if (pad.justPressed(PAD.R3)) this.markNextCrateDown();
      if (pad.justPressed(PAD.B) && this.checkoutSystem.operatingRegister) this.checkoutSystem.endRegisterSession();
    }
    if (pad.justPressed(PAD.LB)) this.handleUnusedMenuButton(PAD.LB);
    if (pad.justPressed(PAD.RB)) this.handleUnusedMenuButton(PAD.RB);
  }

  // Buttons the open screen had no use for, e.g. B or Y while ringing up a customer.
  handleUnusedMenuButton(button) {
    if (button === PAD.B && this.checkoutSystem.operatingRegister) this.checkoutSystem.endRegisterSession();
    if ((button === PAD.LB || button === PAD.RB) && this.controlMode.allows("cameraZoom")) {
      this.cameraRig.zoomBy(button === PAD.RB ? 1 : -1);
    }
  }

  /**
   * Controller walking for Player.update, or null while a screen has the controller.
   * @returns {{x: number, y: number, dash: boolean} | null}
   */
  getPadMovement() {
    if (!this.padInput?.connected || this.uiNavigator?.hasScope()) return null;
    return { ...this.padInput.moveVector(), dash: this.padInput.wantsDash() };
  }

  syncCarriedCrate() {
    this.player.updateCarryPose?.();
    const crates = this.getCarriedCrates();
    crates.forEach((crate, index) => crate.followCarrier?.(this.player.sprite, index, PLAYER_CRATE_HOLD_OFFSET));
    this.syncHeldTrash();
  }

  // Held trash sits at his hand on the side he faces; facing away, his body hides it.
  syncHeldTrash() {
    this.cleaningSystem.syncHeldTrash();
  }

  getCarriedCrates() {
    return this.crateSystem.getCarriedCrates();
  }

  addCarriedCrate(crate) {
    this.crateSystem.addCarriedCrate(crate);
  }

  removeCarriedCrate(crate) {
    return this.crateSystem.removeCarriedCrate(crate);
  }

  createItemCrate(itemId, quantity, x, y) {
    return this.crateSystem.createItemCrate(itemId, quantity, x, y);
  }

  registerInteractableSources() {
    // A shelf only answers when the player stands in front of it and looks at its front.
    this.interactables.registerProvider("stock-holders", () =>
      this.fixtures.shelves().filter((fixture) => this.isPlayerFacingFixture(fixture)).map((fixture) => ({
        id: `fixture:${fixture.id}`,
        kind: "fixture",
        target: fixture,
        actions: ["fixture", "interact"],
        range: SHELF_INTERACT_RANGE,
        priority: 3,
        distanceFrom: ({ feet }) => {
          // The middle of his feet' leading edge, which must be just off the shelf's front.
          const midX = (feet.left + feet.right) / 2;
          const midY = (feet.top + feet.bottom) / 2;
          return fixtureInteractionDistance(fixture, {
            down: { x: midX, y: feet.top }, up: { x: midX, y: feet.bottom },
            left: { x: feet.right, y: midY }, right: { x: feet.left, y: midY },
          }[fixtureFacing(fixture)]);
        },
      })));

    this.interactables.registerProvider("register", () =>
      this.fixtures.registers().filter((fixture) => fixture.sprite).map((fixture) => ({
        id: `register:${fixture.id}`,
        kind: "register",
        target: fixture,
        actions: ["register", "interact"],
        range: REGISTER_INTERACT_RANGE,
        priority: 1,
        hint: `${controlLabel("interact")}: Activate Register`,
        distanceFrom: (origin) => this.feetReachTo(origin, fixture.sprite.getBounds()),
      })));
  }

  // Whether the player looks straight at the fixture's front (it faces back at them).
  isPlayerFacingFixture(fixture) {
    const opposite = { down: "up", up: "down", left: "right", right: "left" };
    const facing = this.player?.currentFacing;
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

  // --- Saving rules and staff ---

  // Saving needs a quiet store: no shift running and nobody inside.
  canSaveOffShift() {
    return !this.loadFailed && (!this.shiftClock.started || this.shift.ended) &&
      this.customers.length === 0;
  }

  // The Shelf Test Room is closed-store time like any other; it just never writes a save.
  canWriteSave() {
    return !this.sandbox && this.canSaveOffShift();
  }

  canHireEmployees() {
    return !this.shift.starting && !this.loadFailed && this.canSaveOffShift();
  }

  hireEmployee(employeeId) {
    const employee = this.gameState.staff.profile(employeeId);
    if (!this.canHireEmployees()) {
      this.showShopMessage("Staff can only be hired between shifts.");
      return false;
    }
    if (this.gameState.staff.hired.includes(employeeId)) return false;
    const staffLimitReason = getStaffLimitReason(
      this.gameState.reputation.shopLevel, this.gameState.staff.hired.length,
    );
    if (staffLimitReason) {
      this.showShopMessage(staffLimitReason);
      return false;
    }
    if (!this.gameState.hireEmployee(employeeId)) {
      this.showShopMessage(`Not enough money. Hiring ${employee.name} costs ${employee.hireCost}.`);
      return false;
    }
    this.showGameMessage(
      `${employee.name} hired and On Shift. Their wage of ${employee.wagePerShift} is due at each shift start.`,
      "#10b981",
    );
    this.requestAutosave();
    return true;
  }

  setEmployeeOnShift(employeeId, onShift) {
    const employee = this.gameState.staff.profile(employeeId);
    if (!this.canHireEmployees()) {
      this.showShopMessage("Staff can only be set On Shift or Off Shift between shifts.");
      return false;
    }
    if (this.gameState.staff.training[employeeId]) {
      this.showShopMessage(`${employee.name} is away training next shift. They're available again once they return.`);
      return false;
    }
    if (!this.gameState.staff.setOnShift(employeeId, onShift)) return false;
    this.showGameMessage(
      onShift
        ? `${employee.name} is On Shift. They'll work and be paid ${employee.wagePerShift} each shift.`
        : `${employee.name} is Off Shift. They'll stay home and won't be paid until you set them On Shift.`,
      "#10b981",
    );
    this.requestAutosave();
    return true;
  }

  getEmployeeTrainingBlockReason(employeeId, jobId) {
    const offer = getEmployeeTrainingOffer(
      employeeId, this.gameState.staff.skills[employeeId], jobId,
    );
    if (!this.canHireEmployees()) return "Book employee training between shifts.";
    if (!this.gameState.staff.hired.includes(employeeId)) return "Hire this employee before booking training.";
    if (this.gameState.staff.training[employeeId]) return "This employee already has training booked.";
    if (!offer) return "This skill is already at Level 5.";
    if (this.gameState.economy.credits < offer.cost) return `Training costs ${offer.cost}. You don't have enough money.`;
    return null;
  }

  trainEmployee(employeeId, jobId) {
    const reason = this.getEmployeeTrainingBlockReason(employeeId, jobId);
    if (reason) {
      this.showShopMessage(reason);
      return false;
    }
    if (!this.gameState.trainEmployee(employeeId, jobId)) {
      this.showShopMessage("Training is no longer available. Check the employee's skill and your money.");
      return false;
    }
    const employee = this.gameState.staff.profile(employeeId);
    this.showGameMessage(
      `${employee.name} will be away training next shift. Their wage of ${employee.wagePerShift} is still due.`,
      "#10b981",
    );
    this.requestAutosave();
    return true;
  }

  moveEmployeeJobPriority(employeeId, jobId, direction) {
    if (!this.canHireEmployees()) {
      this.showShopMessage("Staff job priorities can only be changed between shifts.");
      return false;
    }
    if (!this.gameState.staff.moveJobPriority(employeeId, jobId, direction)) return false;
    this.requestAutosave();
    return true;
  }

  // Wages are paid up front, even into the red (bible Step 32), one receipt line each.
  payEmployeeWages() {
    let total = 0;
    for (const employeeId of this.gameState.staff.paid()) {
      const employee = this.gameState.staff.profile(employeeId);
      if (employee.wagePerShift <= 0) continue;
      this.gameState.economy.spend(employee.wagePerShift, {
        category: "wages",
        label: employee.name,
      });
      total += employee.wagePerShift;
    }
    return total;
  }

  spawnHiredEmployees() {
    this.employees = this.gameState.staff.working()
      .map((employeeId) => new Employee(this, this.gameState.staff.profile(employeeId)));
  }

  clearEmployees() {
    for (const employee of this.employees) employee.destroy();
    this.employees = [];
  }

  // Just past the body box's rear edge, excluding transparent picture margins.
  getBehindRegisterPoint(register = this.checkoutSystem.operatingRegisterFixture ?? this.fixtures.register()) {
    const bounds = register.sprite.body;
    const { dx, dy } = fixtureFacingStep(register, true);
    const player = this.player.sprite;
    const reachX = bounds.width / 2 + player.displayWidth / 2 - REGISTER_BEHIND_OVERLAP;
    const reachY = bounds.height / 2 + player.displayHeight / 2 - REGISTER_BEHIND_OVERLAP;
    return { x: bounds.center.x + dx * reachX, y: bounds.center.y + dy * reachY };
  }

  // --- Saving and loading ---

  serialize() {
    const crates = this.crateSystem.serialize();
    const snapshot = {
      ...this.gameState.toSave(),
      ...crates,
      ...(this.trash ? { trash: this.serializeTrash() } : {}),
    };
    return validateShopSave(snapshot, database);
  }

  // Trash in hand is saved as lying on the shop floor where he stands (or by the backroom door).
  serializeTrash() {
    return this.cleaningSystem.serializeTrash();
  }

  /**
   * Replaces the whole shop with a saved one. Throws if the save is invalid.
   * @param {object} saved - raw save data; validated by validateShopSave
   */
  applySave(saved) {
    const data = validateShopSave(saved, database);
    // Staged: the whole new game state is built and checked off to the side first.
    const next = GameState.fromSave(data, { items: database.getAllItems(), events: this.eventBus });
    for (const id of data.unlockedZones) this.room.unlockZone(id);
    // The map never closes a zone again, so one already open stays open in the loaded shop.
    for (const zone of this.room.zones) if (!zone.locked) next.shop.unlockedZones.add(zone.id);
    // Saves from before the sales-floor rule still load; the misplaced fixture can then be moved out.
    const result = validateFixtureLayout(data.fixtures, { ...this.fixtureSystem.layoutOptions(), requireSalesFloor: false });
    if (!result.valid) throw new Error(`Invalid saved layout: ${result.reason}`);
    this.gameState.replaceWith(next, () => this.rebuildShopFromSave(data, result));
    this.shift.resetStartingTotals();
    this.cameraRig.reset();
    this.lastSavedSnapshot = JSON.stringify(this.serialize());
    this.setSaveStatus("Saved. Autosaves while the store is closed.");
  }

  /**
   * Puts the saved shop back on the map. Runs after the new game state is swapped in and before
   * any screen hears about it.
   * @param {object} data - an upgraded, checked save
   * @param {object} layout - the checked fixture layout
   */
  rebuildShopFromSave(data, layout) {
    this.fixtureViews.clear();
    for (const fixture of this.fixtures.all()) this.fixtureViews.show(fixture);
    this.fixtureSystem.applyLayout(data.fixtures, layout);
    this.areas.playerArea = AREA.SHOP;
    this.player.teleportTo(this.storeDoor.x, this.storeDoor.y + TILE_SIZE);
    this.cameraRig.refresh();
    this.cratePress = null;
    this.crateSystem.load(data);
    this.cleaningSystem.load(data.trash ?? []);
    this.moveShelfOverflowToGoBacks();
    this.refreshShelfStockDisplays();
    this.recalculateActiveFactions();
  }

  // Older saves can hold more in a shelf slot than its cap allows; the excess goes to Go-Backs.
  moveShelfOverflowToGoBacks() {
    for (const shelf of this.fixtures.shelves()) {
      for (const placement of shelf.placements) {
        const overflow = placement.quantity - shelf.getPlacementCapacity(placement);
        if (overflow <= 0) continue;
        const moved = this.gameState.goBacks.takeFrom(shelf, placement.itemId, overflow, {
          sourceEntry: placement, sourceName: "shelf",
        });
        if (moved !== overflow) throw new Error("Could not move saved shelf overflow into Go-Backs.");
        this.gameState.shop.changed();
      }
    }
  }

  refreshShelfStockDisplay(shelf) {
    shelf?.stockDisplay?.sync();
    shelf?.stockItemsDisplay?.sync();
  }

  refreshShelfStockDisplays() {
    for (const shelf of this.fixtures.shelves()) this.refreshShelfStockDisplay(shelf);
  }

  // Coalesces any number of requests in one tick into a single save attempt.
  requestAutosave() {
    if (!this.canWriteSave() || this.autosaveBlocked || this.autosaveQueued) return;
    this.autosaveQueued = true;
    queueMicrotask(() => {
      this.autosaveQueued = false;
      if (!this.scene.isActive() || !this.canWriteSave()) return;
      this.saveOffShift().catch((error) => this.handlePersistenceError(error));
    });
  }

  async saveManually() {
    if (this.sandbox) {
      this.showShopMessage("Test areas are never saved.");
      return;
    }
    if (this.loadFailed || this.shift.starting || !this.canSaveOffShift()) {
      this.showShopMessage(this.loadFailed
        ? "Cannot save after a load error. Your existing save has not been overwritten."
        : "Finish the shift before saving.");
      return;
    }
    try {
      this.showingSave = true;
      await this.saveOffShift();
      this.autosaveBlocked = false;
      this.messages.closeSaveError();
      this.setSaveStatus("Saved. Autosaves while the store is closed.");
      this.showShopMessage("Game saved.");
    } catch (error) {
      this.handlePersistenceError(error);
    } finally {
      this.showingSave = false;
      this.updateSaveControls();
    }
  }

  // Waits out any save already running, then skips writing if nothing changed since the
  // last successful save.
  async saveOffShift() {
    if (!this.canWriteSave()) return;
    if (this.saveInProgress) {
      await this.saveInProgress;
      return this.saveOffShift();
    }
    const snapshot = JSON.stringify(this.serialize());
    if (snapshot === this.lastSavedSnapshot) return;
    this.saveInProgress = this.saveManager.save();
    // Background autosaves stay silent; only a save the player asked for shows progress.
    if (this.showingSave) this.setSaveStatus("Saving...");
    try {
      await this.saveInProgress;
      this.lastSavedSnapshot = snapshot;
      this.autosaveBlocked = false;
      this.setSaveStatus("Saved. Autosaves while the store is closed.");
      this.messages.closeSaveError();
    } finally {
      this.saveInProgress = null;
      this.updateSaveControls();
    }
  }

  updateSaveControls() {
    if (!this.hud) return;
    this.hud.renderSaveState({
      canSave: !this.shift.starting && this.canWriteSave(),
      saving: Boolean(this.saveInProgress && this.showingSave),
      status: this.saveStatus,
      unavailableReason: this.loadFailed
        ? "Saving disabled: your saved game could not be loaded."
        : this.shift.starting ? "Starting the shift..." : "Finish the shift before saving.",
    });
  }

  setSaveStatus(text) {
    this.saveStatus = text;
    this.managerTablet?.updateSaveStatus();
    this.updateSaveControls();
  }

  // --- On-screen messages and save errors ---

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

  /**
   * Blocks autosave and shows the save/load error window. After a failed load the only way
   * out is back to the title, so the existing save is never overwritten.
   * @param {Error} error
   */
  handlePersistenceError(error) {
    console.error(this.loadFailed ? "Could not load game" : "Could not save game", error);
    this.autosaveBlocked = true;
    this.setSaveStatus(`Not saved: ${error.message}`);
    this.messages.showSaveError({
      text: `${this.loadFailed ? "Your saved game could not be loaded. It has not been overwritten." : "Your progress could not be saved."} ${error.message}`,
      buttonLabel: this.loadFailed ? "RETURN TO TITLE" : "RETRY SAVE",
      onButton: () => {
        if (this.loadFailed) this.scene.start("scene-title");
        else {
          this.autosaveBlocked = false;
          this.saveOffShift().catch((failure) => this.handlePersistenceError(failure));
        }
      },
    });
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
    const halfW = bodySize.width / 2;
    const halfH = bodySize.height / 2;
    const solids = [...this.obstacleGroup.getChildren(), ...this.room.wallGroup.getChildren()];
    const storeDoorBlocker = this.storeDoorAnimation?.door.blocker;
    const obstacles = solids.flatMap((solid) => {
      if (!solid.body || (solid === storeDoorBlocker
        ? !bodySize.avoidStoreDoor
        : solid.body.enable === false)) return [];
      const { body } = solid;
      return [{
        left: body.x - halfW,
        right: body.x + body.width + halfW,
        top: body.y - halfH,
        bottom: body.y + body.height + halfH,
      }];
    });
    for (const register of this.fixtures.registers()) {
      const registerBody = register.sprite?.body;
      if (!registerBody) continue;
      const bounds = {
        left: registerBody.x - halfW,
        right: registerBody.x + registerBody.width + halfW,
        top: registerBody.y - halfH,
        bottom: registerBody.y + registerBody.height + halfH,
      };
      switch (fixtureFacing(register)) {
        case "down": bounds.bottom -= REGISTER_FRONT_OVERLAP; break;
        case "up": bounds.top += REGISTER_FRONT_OVERLAP; break;
        case "left": bounds.left += REGISTER_FRONT_OVERLAP; break;
        case "right": bounds.right -= REGISTER_FRONT_OVERLAP; break;
      }
      obstacles.push(bounds);
    }
    return obstacles;
  }

  isNavigationSegmentClear(from, to, obstacles) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.ceil(distance / 8);
    for (let index = 0; index <= steps; index += 1) {
      const ratio = steps ? index / steps : 0;
      const x = from.x + (to.x - from.x) * ratio;
      const y = from.y + (to.y - from.y) * ratio;
      if (!this.room.isWalkable(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE))) return false;
    }
    return obstacles.every((rectangle) => !segmentIntersectsRectangle(from, to, rectangle));
  }

  // Whether a character-sized body can move directly between two world positions.
  isStraightWalkClear(fromX, fromY, toX, toY, bodySize) {
    const obstacles = this.getNavigationObstacles(bodySize);
    return this.isNavigationSegmentClear({ x: fromX, y: fromY }, { x: toX, y: toY }, obstacles);
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
    // The shop and backroom only connect through their door pair: walk to this side's door,
    // step through it, then walk on from the other side's door.
    const crossing = this.areas?.crossing(fromY, toY);
    if (crossing) {
      const { near, far } = crossing;
      const toDoor = this.findAreaPath(fromX, fromY, near.x, near.y, bodySize);
      const fromDoor = toDoor && this.findAreaPath(far.x, far.y, toX, toY, bodySize);
      if (!fromDoor) return null;
      return [...toDoor, { x: near.x, y: near.y, teleportTo: { x: far.x, y: far.y } }, ...fromDoor];
    }
    return this.findAreaPath(fromX, fromY, toX, toY, bodySize);
  }

  findAreaPath(fromX, fromY, toX, toY, bodySize) {
    const obstacles = this.getNavigationObstacles(bodySize);
    return findFreeWalkPath(
      { x: fromX, y: fromY },
      { x: toX, y: toY },
      {
        isWalkable: (x, y) =>
          this.room.isWalkable(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)) &&
          obstacles.every((rectangle) =>
            x <= rectangle.left || x >= rectangle.right || y <= rectangle.top || y >= rectangle.bottom),
        isSegmentClear: (from, to) => this.isNavigationSegmentClear(from, to, obstacles),
      },
    );
  }

  // --- Supply, pricing, and the Loading Pad ---

  // The nearest shelf within SHELF_INTERACT_RANGE, or null. Shared by crate delivery and
  // opening fixtures so "close enough" means the same for both.
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
    const floorCrates = this.getFloorCrates();
    for (const crate of floorCrates) add(crate, "offShelves");
    for (const crate of this.getCarriedCrates()) {
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

  /**
   * The fixture holding Ctrl (or holding A on a controller) would pick up to move: the one
   * you're facing, with empty hands, while the store is closed.
   */
  getHoldToMoveFixture() {
    if (!this.controlMode.allows("interact") || this.getCarriedCrates().length > 0 || this.heldTrash) return null;
    if (this.checkoutSystem.operatingRegister || this.areas.nearbyPortal()) return null;
    const target = this.interactables?.findTarget("interact", this.getInteractionOrigin());
    let fixture = null;
    if (target?.kind === "fixture" && this.isPlayerFacingFixture(target.target)) fixture = target.target;
    // The register is in reach only while you face it, from any side.
    else if (target?.kind === "register") fixture = target.target;
    if (!fixture) {
      const trashcan = this.getNearbyTrashcan();
      if (trashcan && this.isPlayerFacingFixture(trashcan)) fixture = trashcan;
    }
    if (!fixture || !this.fixtureSystem.canRearrange()) return null;
    return this.fixtureSystem.moveAreaBlockReason(fixture) ? null : fixture;
  }

  /**
   * A (on a controller) went down. Facing a fixture you could move, it waits to see whether
   * this is a tap (open it) or a hold (pick it up to move); otherwise it acts right away.
   * @param {{ button?: number }} [options] - the controller button, which is polled for release
   */
  startInteractPress({ button = null } = {}) {
    if (!this.controlMode.allows("interact")) return;
    const fixture = this.getHoldToMoveFixture();
    if (!fixture) {
      this.interactPress = null;
      this.handleInteract();
      return;
    }
    this.interactPress = { fixture, button, startedAt: this.time.now };
  }

  // Releasing before the hold fired is a tap.
  endInteractPress() {
    const press = this.interactPress;
    this.interactPress = null;
    if (press) this.handleInteract();
  }

  updateInteractPress() {
    const press = this.interactPress;
    if (!press) return;
    if (press.button !== null && !this.padInput?.isDown(press.button)) {
      this.endInteractPress();
      return;
    }
    if (this.time.now - press.startedAt < HOLD_KEY_MS) return;
    this.interactPress = null;
    if (this.getHoldToMoveFixture() === press.fixture) this.fixturePlacement.begin(press.fixture.id);
  }

  // Ctrl went down. Facing a fixture with empty hands while the store is closed, keeping it
  // held picks the fixture up to move; releasing sooner leaves it alone.
  startFixtureMovePress() {
    const fixture = this.getHoldToMoveFixture();
    this.fixtureMovePress = fixture ? { fixture, startedAt: this.time.now } : null;
  }

  updateFixtureMovePress() {
    const press = this.fixtureMovePress;
    if (!press || this.time.now - press.startedAt < HOLD_KEY_MS) return;
    this.fixtureMovePress = null;
    if (this.getHoldToMoveFixture() === press.fixture) this.fixturePlacement.begin(press.fixture.id);
  }

  // E delivers/places a carried crate, opens a nearby fixture, or toggles register operation.
  handleInteract() {
    if (!this.controlMode.allows("interact")) return;
    // Pressing E behind the counter always steps away, whatever is in hand.
    if (this.checkoutSystem.operatingRegister) {
      this.checkoutSystem.endRegisterSession();
      return;
    }
    // Doors come first so a carried crate goes through with the player, not onto the floor.
    const portal = this.areas.nearbyPortal();
    if (portal) {
      this.areas.goThrough(portal);
      return;
    }
    if (this.heldTrash) {
      if (this.isNearTrashcan()) this.throwAwayHeldTrash();
      else this.showGameMessage(`Face a trashcan and press ${controlLabel("interact")} to throw the trash away, ` +
        `or press ${controlLabel("putDown")} to drop it.`, "#94a3b8");
      return;
    }
    if (this.getCarriedCrates().length === 0 && this.findTrashInFront()) {
      this.pickUpTrash(this.findTrashInFront());
      return;
    }
    // Full crates alone fall through so E still opens a shelf beside a trashcan.
    if (this.isNearTrashcan() && (this.getCarriedCrates().length === 0 || this.heldEmptyCrates().length > 0)) {
      if (this.getCarriedCrates().length === 0) this.takeEmptyCrateFromTrashcan();
      else this.returnEmptyCratesToTrashcan();
      return;
    }
    if (this.carriedCrate) {
      if (this.carriedCrate.kind === "fixture") {
        const nearby = this.getNearbyFixture();
        this.fixturePlacement.beginFromCrate(this.carriedCrate);
        return;
      }
      const nearby = this.getNearbyFixture();
      if (nearby) {
        this.tryOpenFixtureWindow(nearby);
        return;
      }
      if (this.isNearTrashcan()) {
        this.showGameMessage("Only empty crates go in the trashcan.", "#94a3b8");
        return;
      }
      this.showGameMessage("Too far from a shelf", "#94a3b8");
      return;
    }

    const target = this.interactables.findTarget("interact", this.getInteractionOrigin());
    if (target?.kind === "fixture") {
      this.tryOpenFixtureWindow(target.target);
      return;
    }

    // Pressing E again behind the counter leaves it (handled above before anything else).
    if (target?.kind === "register") {
      this.tryOpenRegister();
      return;
    }

    this.showGameMessage("Nothing nearby to interact with", "#94a3b8");
  }

  isNearTrashcan() {
    return this.cleaningSystem.isNearTrashcan();
  }

  // The trashcan the player faces, with its edge a few steps ahead, or null. Standing
  // beside a trashcan while facing something else never counts.
  getNearbyTrashcan() {
    return this.cleaningSystem.getNearbyTrashcan();
  }

  heldEmptyCrates() {
    return this.getCarriedCrates().filter((crate) => crate.kind === "item" && crate.quantity === 0);
  }

  returnEmptyCratesToTrashcan() {
    if (!this.isNearTrashcan()) {
      this.showGameMessage("Move closer to a trashcan.", "#94a3b8");
      return false;
    }
    const empties = this.heldEmptyCrates();
    if (empties.length === 0) {
      this.showGameMessage("Only empty crates go in the trashcan.", "#94a3b8");
      return false;
    }
    for (const crate of empties) {
      this.removeCarriedCrate(crate);
      crate.destroy();
    }
    this.gameState.crates.changed();
    this.showGameMessage(empties.length === 1
      ? "Empty crate put in the trashcan."
      : `${empties.length} empty crates put in the trashcan.`, "#10b981");
    return true;
  }

  // --- Trash and cleanliness (documentation/modules/Cleaning.md) ---

  // Where loose trash may lie: open sales floor that no wall or fixture covers.
  isOpenTrashSpot(x, y) {
    return this.cleaningSystem.isOpenTrashSpot(x, y);
  }

  /**
   * A customer drops a piece of trash at their feet, if that spot is open shop floor.
   * @returns {boolean} whether it was dropped
   */
  dropTrash(x, y) {
    return this.cleaningSystem.dropTrash(x, y);
  }

  // The trash just ahead of his feet, the way he faces.
  findTrashInFront() {
    return this.cleaningSystem.findTrashInFront();
  }

  pickUpTrash(piece) {
    return this.cleaningSystem.pickUpTrash(piece);
  }

  throwAwayHeldTrash() {
    return this.cleaningSystem.throwAwayHeldTrash();
  }

  // Q with trash in hand: it goes back on the floor just ahead of him, or at his feet.
  dropHeldTrash() {
    return this.cleaningSystem.dropHeldTrash();
  }

  // Trash in hand still counts against the store until it's in a trashcan.
  getCleanliness() {
    return this.cleaningSystem.getCleanliness();
  }

  getCleanlinessPercent() {
    return this.cleaningSystem.getCleanlinessPercent();
  }

  /**
   * A customer found the store too dirty: store reputation only, never their faction's.
   * @param {Customer} customer
   * @param {"upset" | "walk-out"} verdict
   */
  reportCleanlinessVerdict(customer, verdict) {
    this.cleaningSystem.reportCleanlinessVerdict(customer, verdict);
  }

  takeEmptyCrateFromTrashcan() {
    const stack = this.getCarriedCrates();
    if (stack.length > 0) {
      this.showGameMessage("Put your crates down before taking an empty crate.", "#94a3b8");
      return false;
    }

    const crate = this.createItemCrate(null, 0, this.player.sprite.x, this.player.sprite.y);
    if (!crate.pickUp(this.player.sprite)) {
      crate.destroy();
      throw new Error("A newly supplied empty crate could not be picked up.");
    }
    this.addCarriedCrate(crate);
    this.gameState.crates.changed();
    this.showGameMessage("Took a free empty crate.", "#10b981");
    return true;
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

  // Every crate on the floor: loose crates, plus the crates stacked on them.
  getFloorCrates() {
    return this.crateSystem.getFloorCrates();
  }

  /**
   * The closest floor crate within half a floor square of the player, in a wide cone around
   * the way he faces, so distant stacks don't take over the put-down action.
   * @param {{ moving?: boolean }} [options] - moving: find a crate still flying or rolling instead
   * @returns {import("../logic/Crate.js").Crate | null}
   */
  findCrateInFront({ moving = false } = {}) {
    return this.crateSystem.findCrateInFront({ moving });
  }

  // The floor stack in reach (bottom crate first) and the crate its green arrow points at.
  // The arrow starts on the top crate whenever the player reaches a different stack.
  markedFloorStack() {
    return this.crateSystem.markedFloorStack();
  }

  // Ctrl / right stick click: moves the green arrow one crate down the stack, looping back to
  // the top after the bottom.
  markNextCrateDown() {
    this.crateSystem.markNextCrateDown();
  }

  /**
   * What the pick-up (Space / X) and put-down (Q / Y) buttons do right now. Each has a `tap`
   * and, if holding the button does something different, a `hold`. Flags describe the action
   * for the on-screen hints.
   * @returns {{ pickUp?: object, putDown?: object }}
   */
  crateActions() {
    const say = (message, color = "#94a3b8") => () => this.showGameMessage(message, color);
    const holding = this.getCarriedCrates().length;
    const top = this.carriedCrate;
    if (this.checkoutSystem.operatingRegister) {
      return {
        pickUp: { tap: say("Leave the register to pick up a crate") },
        putDown: holding ? { tap: say("Leave the register to put down a crate") } : undefined,
      };
    }
    if (this.heldTrash) {
      const reason = "You can't pick up crates while holding trash";
      return {
        pickUp: { tap: say(reason, "#f59e0b"), blocked: true },
        putDown: { tap: () => this.dropHeldTrash(), trash: true },
      };
    }

    const actions = {};
    const stack = this.markedFloorStack();
    if (stack) {
      const lifted = stack.crates.length - stack.crates.indexOf(stack.marked);
      if (stack.marked.kind === "fixture" && holding > 0) {
        actions.pickUp = { tap: say("Put your crates down before picking up a fixture crate"), blocked: true };
      } else if (top?.kind === "fixture") {
        actions.pickUp = { tap: say("Put the fixture crate down before picking up another crate"), blocked: true };
      } else if (this.combinableUnits(stack.marked) > 0) {
        // Same item as a crate you hold: tapping pours as much as fits into yours instead.
        actions.pickUp = {
          tap: () => this.combineIntoCarried(stack.marked),
          hold: () => this.combineIntoCarried(stack.marked),
          combines: this.combinableUnits(stack.marked),
        };
      } else {
        const tooMany = (count) => say(`You can only carry ${MAX_CARRIED_CRATES} crates. You're holding ` +
          `${holding}, so you can't pick up ${count === 1 ? "another one" : `${count} more`}.`, "#f59e0b");
        actions.pickUp = {
          tap: holding + 1 <= MAX_CARRIED_CRATES ? () => this.pickUpFromStack(stack, false) : tooMany(1),
          hold: holding + lifted <= MAX_CARRIED_CRATES ? () => this.pickUpFromStack(stack, true) : tooMany(lifted),
          lifted,
        };
      }
    } else if (holding === 1) {
      // With no green arrow, the pick-up button throws your crate while you're walking.
      actions.pickUp = { tap: () => this.throwTopCrate(), throws: true };
    } else if (holding > 1) {
      actions.pickUp = { tap: say("You can only throw a crate when you're holding just one.", "#94a3b8") };
    } else {
      actions.pickUp = {
        tap: this.findCrateInFront({ moving: true })
          ? say("Wait for crate to stop", "#f59e0b")
          : say("No crate nearby"),
      };
    }

    if (holding === 0) {
      // Nothing to put down.
    } else if (stack && top.kind !== "fixture") {
      const room = FLOOR_STACK_MAX - stack.crates.length;
      let reason = null;
      if (stack.base.kind === "fixture") reason = "Crates can't be stacked on a fixture crate";
      else if (stack.base.lockedToPad) reason = "Crates can't be stacked on the Loading Pad";
      else if (room <= 0) reason = `You can't stack any higher. Stacks can only be ${FLOOR_STACK_MAX} crates high.`;
      actions.putDown = reason
        ? { tap: say(reason, "#f59e0b"), hold: say(reason, "#f59e0b"), blocked: true, full: room <= 0, reason }
        : {
          tap: () => this.setCratesOnStack(stack, 1),
          hold: () => this.setCratesOnStack(stack, Math.min(room, holding)),
          onStack: true,
        };
    } else {
      actions.putDown = { tap: () => this.dropTopCrate(), hold: () => this.dropWholeStack() };
    }
    return actions;
  }

  // Held crates of the same item as `floorCrate` that still have room, top crate first.
  combineTargets(floorCrate) {
    if (floorCrate.kind !== "item" || floorCrate.quantity <= 0) return [];
    return [...this.getCarriedCrates()].reverse().filter((held) => held.kind === "item" &&
      held.quantity > 0 && held.itemId === floorCrate.itemId && held.getRemainingUnitsFor(held.itemId) > 0);
  }

  // How many items from `floorCrate` would fit into the same-item crates you're holding.
  combinableUnits(floorCrate) {
    const room = this.combineTargets(floorCrate)
      .reduce((total, held) => total + held.getRemainingUnitsFor(held.itemId), 0);
    return Math.min(room, Math.max(0, floorCrate.quantity));
  }

  // Moves as many items as fit from the floor crate into your crates; the floor crate stays put.
  combineIntoCarried(floorCrate) {
    const itemId = floorCrate.itemId;
    const name = database.getItem(itemId)?.name ?? "items";
    let moved = 0;
    for (const held of this.combineTargets(floorCrate)) {
      const taken = floorCrate.remove(itemId, held.getRemainingUnitsFor(itemId));
      held.add(itemId, taken);
      moved += taken;
    }
    if (moved === 0) return 0;
    const left = floorCrate.quantity;
    this.showGameMessage(left > 0
      ? `Moved ${moved} ${name} into your crate. ${left} didn't fit and stay in the crate on the floor.`
      : `Moved ${moved} ${name} into your crate. The crate on the floor is now empty.`, "#22c55e");
    return moved;
  }

  // "a crate of 6 Plasma Pistol", for hints.
  describeCrate(crate) {
    if (crate.kind === "fixture") return `the ${getFixtureType(crate.typeId).name} fixture crate`;
    if (crate.quantity === 0) return "an empty crate";
    return `a crate of ${crate.quantity} ${database.getItem(crate.itemId)?.name ?? "unknown items"}`;
  }

  // Picture, name, and count for the bottom bar and the holding cards.
  describeCrateForFooter(crate) {
    if (crate.kind === "fixture") return { name: `${getFixtureType(crate.typeId).name} fixture`, count: "", image: null };
    if (crate.quantity === 0) return { name: "Empty crate", count: "", image: null };
    const item = database.getItem(crate.itemId);
    return { name: item?.name ?? "Unknown item", count: `x${crate.quantity}`, image: item?.image ?? null };
  }

  // The help lines on the right of the bottom bar: what each button does right now.
  updateCrateHint() {
    const lines = [];
    const mode = this.controlMode.getMode();
    if (this.checkoutWindow?.usesSpaceKey()) {
      lines.push(`${controlLabel("handOverChange")}: Hand over change`);
    } else if (mode === CONTROL_MODES.REGISTER) {
      lines.push(`${controlLabel("interact")}: Leave the register`);
    } else if (mode === CONTROL_MODES.WALKING || mode === CONTROL_MODES.CARRYING) {
      const pickKey = controlLabel("crate");
      const putKey = controlLabel("putDown");
      const interactKey = controlLabel("interact");
      const portal = this.areas.nearbyPortal();
      if (portal) {
        lines.push(portal.to === AREA.SHOP ? `${interactKey}: Go back out to the shop` : `${interactKey}: Go into the backroom`);
      } else if (mode === CONTROL_MODES.WALKING && !this.heldTrash && !this.findTrashInFront()) {
        const register = this.interactables?.findTarget?.("register", this.getInteractionOrigin());
        if (register) lines.push(...register.hint.split("\n"));
      }
      const holding = this.getCarriedCrates().length;
      const handsFull = `Your hands are full (${MAX_CARRIED_CRATES} crates max)`;
      const { pickUp, putDown } = this.crateActions();
      const stack = this.markedFloorStack();
      const nearTrashcan = this.isNearTrashcan();
      if (this.heldTrash) {
        if (nearTrashcan) lines.push(`${interactKey}: Throw the trash in the trashcan`);
        lines.push(`${putKey}: Drop the trash on the floor`);
      } else if (holding === 0 && this.findTrashInFront()) {
        lines.push(`${interactKey}: Pick up the trash`);
      }
      if (nearTrashcan && !this.heldTrash) {
        const empties = this.heldEmptyCrates().length;
        if (holding === 0) {
          if (!this.findTrashInFront()) lines.push(`${interactKey}: Create`);
        } else if (empties > 0) lines.push(`${interactKey}: Put ${empties === 1 ? "your empty crate" : `all ${empties} empty crates`} in the trashcan`);
      }
      if (pickUp?.throws) {
        // Only promised while it can actually happen: throwing needs the player mid-stride.
        const { x: walkX, y: walkY } = this.player.sprite.body.velocity;
        if (walkX !== 0 || walkY !== 0) lines.push(`${pickKey}: Throw your crate`);
      } else if (stack && pickUp?.combines) {
        const name = database.getItem(stack.marked.itemId)?.name ?? "items";
        lines.push(pickUp.combines === stack.marked.quantity
          ? `${pickKey}: Move all ${pickUp.combines} ${name} from this crate into yours`
          : `${pickKey}: Move ${pickUp.combines} of the ${stack.marked.quantity} ${name} from this crate into yours (that's all that fits)`);
      } else if (stack && pickUp && !pickUp.blocked) {
        lines.push(holding >= MAX_CARRIED_CRATES ? handsFull : `Tap ${pickKey}: Pick up ${this.describeCrate(stack.marked)}`);
        if (pickUp.lifted > 1 && holding + pickUp.lifted <= MAX_CARRIED_CRATES) {
          lines.push(`Hold ${pickKey}: Pick up ${pickUp.lifted} crates (this one and the ones above it)`);
        }
      }
      if (putDown?.trash) {
        // Covered by the trash lines above.
      } else if (putDown?.blocked) {
        lines.push(putDown.reason);
      } else if (putDown?.onStack) {
        lines.push(`Tap ${putKey}: Set your top crate on this stack`);
        if (holding > 1) lines.push(`Hold ${putKey}: Set as many of your crates on this stack as fit`);
      } else if (putDown) {
        lines.push(`Tap ${putKey}: Put your top crate down`);
        if (holding > 1) lines.push(`Hold ${putKey}: Set all ${holding} crates down as a stack`);
      }
      if (stack?.crates.length > 1) lines.push(`${controlLabel("nextCrate")}: Move the arrow one crate down`);
      const trashcanTakesE = nearTrashcan && this.heldEmptyCrates().length > 0;
      if (!trashcanTakesE && this.carriedCrate?.kind === "item") {
        const nearby = this.getNearbyFixture();
        if (nearby) lines.push(`${interactKey}: Open this shelf`);
      } else if (!trashcanTakesE && this.carriedCrate?.kind === "fixture") lines.push(`${interactKey}: Place the fixture`);
      const movable = holding === 0 ? this.getHoldToMoveFixture() : null;
      if (movable) {
        // Keyboard moves fixtures with held Ctrl; a controller holds A.
        const moveKey = getInputDevice() === "gamepad" ? interactKey : controlLabel("nextCrate");
        lines.push(getFixtureType(movable.type).kind === "trash"
          ? `Hold ${moveKey}: Move`
          : `Hold ${moveKey}: Move this ${this.fixtures.displayName(movable)}`);
      }
    }
    this.messages.setHint([...new Set(lines)].join("\n"));
  }

  // The green arrow over the marked crate, plus the bottom bar and holding cards.
  updateCrateMarker() {
    const mode = this.controlMode.getMode();
    const stack = mode === CONTROL_MODES.WALKING || mode === CONTROL_MODES.CARRYING
      ? this.markedFloorStack()
      : null;
    this.pickupMarker.setVisible(Boolean(stack));
    if (stack) {
      const bounds = stack.marked.sprite.getBounds();
      // Points down at the top crate; for crates lower in a stack, points in from the left side.
      if (this.markedFromTop === 0) this.pickupMarker.setAngle(0).setPosition(bounds.centerX, bounds.top - 7);
      else this.pickupMarker.setAngle(-90).setPosition(bounds.left - 7, bounds.centerY);
    }
    const stocking = this.shelfStockingWindow?.getStockingCrate();
    this.crateFooter.render({
      marked: stack ? this.describeCrateForFooter(stack.marked) : this.describeHoveredShelfForFooter(),
      carried: [...this.getCarriedCrates()].reverse().map((crate) => crate === stocking
        ? { ...this.describeCrateForFooter(crate), stockingNext: true }
        : this.describeCrateForFooter(crate)),
    });
  }

  // While the shelf window is open, the bar shows the shelf space under the cursor.
  describeHoveredShelfForFooter() {
    const shelf = this.shelfStockingWindow?.getHoveredShelf();
    if (!shelf) return null;
    if (shelf.empty) return { label: "SHELF", name: "Empty shelf space", count: "", image: null };
    const item = database.getItem(shelf.itemId);
    return { label: "SHELF", name: item?.name ?? "Unknown item",
      count: shelf.quantity > 0 ? `x${shelf.quantity}` : "SOLD OUT", image: item?.image ?? null };
  }

  emitCratePickedUp(crate) {
    this.crateSystem.emitCratePickedUp(crate);
  }

  emitCrateDropped(crate, { x, y }, thrown) {
    this.crateSystem.emitCrateDropped(crate, { x, y }, thrown);
  }

  // Adds the marked crate to the top of what you're carrying, and with withAbove every crate
  // above it too. Without withAbove the floor stack closes the gap.
  pickUpFromStack({ base, crates, marked }, withAbove) {
    return this.crateSystem.pickUpFromStack({ base, crates, marked }, withAbove);
  }

  // Moves `count` crates from the top of what you're carrying onto the floor stack, keeping
  // their order; the rest stay in your hands.
  setCratesOnStack({ base }, count) {
    return this.crateSystem.setCratesOnStack({ base }, count);
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

  // Floor crates sort with people by their base: anyone whose feet are behind a crate's bottom
  // edge is drawn behind it. The player is also kept behind his own held crates' worth of
  // depth, so nothing he carries pokes through. Crates sitting on a floor crate are drawn on
  // top of it and move with it.
  syncFloorStacks() {
    const body = this.player?.sprite?.body;
    if (!body) return;
    const inFront = this.player.sprite.depth + 1 + MAX_CARRIED_CRATES;
    for (const crate of this.restockCrates ?? []) {
      if (crate.launch || !crate.sprite.body) continue;
      const bottom = crate.sprite.body.bottom;
      const byBase = PEOPLE_DEPTH_BASE + bottom - 0.5;
      crate.sprite.setDepth(body.bottom < bottom ? Math.max(byBase, inFront) : byBase);
    }
    for (const [base, above] of this.floorStacks ?? []) {
      above.forEach((crate, index) => {
        crate.followCarrier(base.sprite, index, CRATE_STACK_SPACING, CRATE_STACK_SPACING);
        // Just over the crate below, never past someone standing a pixel in front.
        crate.sprite.setDepth(base.sprite.depth + 0.01 * (index + 1));
      });
    }
  }

  // Space picks up and Q puts down. Each waits for release to tell a tap (one crate) from a
  // hold (a stack); a hold fires as soon as the key has been down for HOLD_KEY_MS.
  bindCrateKeys() {
    const keyboard = this.input.keyboard;
    // Cursor keys capture Space by default, which blocks focused UI controls.
    keyboard.removeCapture("SPACE");
    keyboard.on("keydown-SPACE", (event) => {
      if (event.target?.closest?.("#ui-layer")) return;
      event.preventDefault();
      if (event.repeat || this.checkoutWindow?.usesSpaceKey()) return;
      this.startCratePress("pickUp");
    });
    keyboard.on("keydown-Q", (event) => {
      if (!event.repeat) this.startCratePress("putDown");
    });
    keyboard.on("keyup-SPACE", () => this.endCratePress("pickUp"));
    keyboard.on("keyup-Q", () => this.endCratePress("putDown"));
    keyboard.on("keydown-CTRL", (event) => {
      if (!event.repeat) this.startFixtureMovePress();
      this.markNextCrateDown();
    });
    keyboard.on("keyup-CTRL", () => { this.fixtureMovePress = null; });
  }

  allowsCrateAction() {
    return this.controlMode.allows("crate");
  }

  /**
   * A pick-up or put-down button went down. Actions with no hold version (like throwing)
   * happen right away; the rest wait to see whether it's a tap or a hold.
   * @param {"pickUp"|"putDown"} which
   * @param {{ button?: number }} [options] - the controller button, which is polled for release
   */
  startCratePress(which, { button = null } = {}) {
    if (!this.allowsCrateAction(which)) return;
    const action = this.crateActions()[which];
    if (!action) return;
    if (!action.hold) {
      this.cratePress = null;
      action.tap();
      return;
    }
    this.cratePress = { which, button, startedAt: this.time.now, fired: false };
  }

  // Releasing before the hold fired is a tap.
  endCratePress(which) {
    const press = this.cratePress;
    if (press?.which !== which) return;
    this.cratePress = null;
    if (press.fired || !this.allowsCrateAction(which)) return;
    this.crateActions()[which]?.tap();
  }

  // Each frame: ends controller presses on release, and fires a hold once it's long enough.
  updateCratePress() {
    const press = this.cratePress;
    if (!press) return;
    if (press.button !== null && !this.padInput?.isDown(press.button)) {
      this.endCratePress(press.which);
      return;
    }
    if (press.fired || this.time.now - press.startedAt < HOLD_KEY_MS) return;
    press.fired = true;
    if (!this.allowsCrateAction(press.which)) return;
    const action = this.crateActions()[press.which];
    (action?.hold ?? action?.tap)?.();
  }

  // Tap Q: your top crate goes on the floor in front of you. With throwing, it's thrown the
  // way you're walking instead.
  dropTopCrate(throwing = false) {
    return this.crateSystem.dropTopCrate(throwing);
  }

  // The pick-up button with no green arrow: throws your top crate the way you're walking.
  throwTopCrate() {
    const { x, y } = this.player.sprite.body.velocity;
    if (this.crateMotionPaused || (x === 0 && y === 0)) {
      this.showGameMessage(`To throw a crate, walk and press ${controlLabel("crate")}.`, "#94a3b8");
      return false;
    }
    return this.dropTopCrate(true);
  }

  // Hold Q: everything you're carrying goes on the floor in front of you as one stack.
  dropWholeStack() {
    return this.crateSystem.dropWholeStack();
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
    this.handleGamepad(time, delta);
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
      this.syncCarriedCrate();
      this.syncFloorStacks();
    }
    if (movementFrozen || this.fixturePlacement.active) {
      this.customers.forEach((customer) => customer.standStill());
      this.employees.forEach((employee) => employee.standStill());
    } else {
      this.customers.forEach((customer) => customer.update(delta));
      this.employees.forEach((employee) => employee.update(delta));
    }
    this.hud.renderStamina(this.player);
    this.hud.renderCleanliness(this.cleaningSystem.getCleanliness());
    this.cleaningSystem.updateHighlight(time);

    this.shiftClock.update(delta);
    this.positionGoBacksBadge();
    this.updateCratePress();
    this.updateInteractPress();
    this.updateFixtureMovePress();
    this.updateCrateHint();
    this.updateCrateMarker();
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
