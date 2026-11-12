// ==========================================
// FILE: game.js
// ==========================================
// The main shop scene: builds the room, fixtures, player, and Loading Pad, then runs the
// shift loop (customers, checkout, crates) and off-shift saving.
// See also: TileRoom.js (map), FixtureRegistry.js (fixtures), Customer.js (shopper AI).
import { WindowManager } from "../logic/WindowManager.js";
import { ManagerTablet } from "../logic/ManagerTablet.js";
import { PlayerState } from "../logic/PlayerState.js";
import {
  getStaffLimit, getStaffLimitReason, hasUnimplementedShopRewardBetween, STAFF_LIMIT_LEVELS,
} from "../logic/ShopProgression.js";
import { HUDController } from "../logic/HUDController.js";
import { DebugInfo } from "../logic/DebugInfo.js";
import { EventBus, GAME_EVENTS } from "../logic/EventBus.js";
import { ControlMode, CONTROL_MODES } from "../logic/ControlMode.js";
import { InteractableRegistry } from "../logic/InteractableRegistry.js";
import { transferItems } from "../logic/InventoryTransfer.js";
import { StorageFixture } from "../logic/ShopInventory.js";
import { ShelfFixture } from "../logic/ShelfFixture.js";
import { Customer, SPRITE_DISPLAY_WIDTH, SPRITE_DISPLAY_HEIGHT } from "../logic/Customer.js";
import { Employee } from "../logic/Employee.js";
import { getEmployeeTrainingOffer } from "../logic/EmployeeTraining.js";
import {
  addDiscountBonusItem, BARGAIN_PRICE_RATIO, createCustomerBuyList, createCustomerItemQuantities,
} from "../logic/CustomerBuyLists.js";
import { formatMoney, isMoney, sumMoney } from "../logic/Money.js";
import { addTraitBonusItems, CUSTOMER_TRAITS } from "../logic/CustomerTraits.js";
import {
  createCustomerArrivalSchedule,
  growCustomerArrivalSchedule,
  createCustomerPool,
  getLicensedFactionIds,
} from "../logic/CustomerPooling.js";
import { Player, PLAYER_CHARACTER_HEIGHT, PLAYER_CRATE_HOLD_OFFSET } from "../logic/Player.js";
import { Crate, INTERACT_RANGE } from "../logic/Crate.js";
import { getItemCrateTint } from "../logic/CrateCategory.js";
import { MAX_CARRIED_CRATES } from "../logic/CrateStack.js";
import { DELIVERY_FEE, summarizeSupplyOrder } from "../logic/SupplyOrder.js";
import { getEmergencyLoanOffer } from "../logic/EmergencyLoan.js";
import { HOVERCART_UPGRADES } from "../logic/Hovercart.js";
import { solveCratePush } from "../logic/CratePushing.js";
import { separateOverlappingCrates } from "../logic/CrateSeparation.js";
import { CheckoutWindow } from "../logic/CheckoutWindow.js";
import { chooseCustomerPayment } from "../logic/CustomerPayment.js";
import { FixtureWindow } from "../logic/FixtureWindow.js";
import { GoBacksWindow } from "../logic/GoBacksWindow.js";
import { TileRoom } from "../logic/TileRoom.js";
import { AnimatedDoor, BACKROOM_DOOR_SPRITE, SlidingDoor } from "../logic/SlidingDoor.js";
import {
  TILE_SIZE, getZone, getTotalGridSize, getAuthoredGridSize, getStoreDoorCell, getStoreDoorCells, EXPANSION_ORDER,
  BACKROOM_UPGRADE_ORDER, getBackroomDoorCell, getBackroomExitCell, getBackroomLink, isBackroomRow,
  getBackroomInteriorBounds, getLoadingPadBounds, LOADING_PAD_WIDTH, LOADING_PAD_HEIGHT,
} from "../logic/RoomLayout.js";
import { ShiftClock, SHIFT_DURATION_MS } from "../logic/ShiftClock.js";
import { summarizeReceipt } from "../logic/DayLedger.js";
import { Market } from "../logic/Market.js";
import { findGridPath } from "../logic/Pathfinder.js";
import { FixturePlacement } from "../logic/FixturePlacement.js";
import { ShelfIconDisplay } from "../logic/ShelfIconDisplay.js";
import { getFixtureTexture, getSingleLockerSprite, hasFacingTextures, sizeSingleLocker } from "../logic/FixtureTexture.js";
import { STARTING_FIXTURES, FIXTURE_TYPES, getFixtureType, getFixtureResaleValue, getShelfDisplayGrid, fixtureAccessCells, fixtureFacing, fixtureFacingStep, fixtureFootprint, fixtureInteractionDistance, fixtureRotation, fixtureStandingSpot, validateFixtureLayout } from "../logic/FixtureLayout.js";
import { FixtureRegistry } from "../logic/FixtureRegistry.js";
import { SHOP_LAYOUT_VERSION, validateShopSave } from "../logic/ShopSave.js";
import { UIWindow } from "../logic/UIWindow.js";
import { GamepadInput, PAD } from "../logic/GamepadInput.js";
import { UINavigator } from "../logic/UINavigator.js";
import { controlLabel, setInputDevice } from "../logic/InputDevice.js";
import { SaveManager } from "../../SaveManager.js";
import { database } from "./boot.js"; // the exported DatabaseManager singleton

// Most customers inside the store at once. When full, the next arrival is lost for good,
// so a backed-up dealer really does lose that sale.
const MAX_CUSTOMERS_IN_STORE = 6;
// Spread around the doorway's center; kept within the one-cell doorway.
const CUSTOMER_EXIT_SLOT_OFFSETS = Object.freeze([
  [-8, -8],
  [0, -8],
  [8, -8],
  [-8, 8],
  [0, 8],
  [8, 8],
].map(([dx, dy]) => Object.freeze({ dx, dy })));

function reputationPenaltyText(penalty, factionId) {
  const faction = factionId ? CUSTOMER_TRAITS[factionId] : null;
  if (factionId && !faction?.group) throw new Error(`Unknown customer faction: ${factionId}.`);
  return `-${penalty} store reputation${faction ? `\n-${penalty} ${faction.name} reputation` : ""}\nat shift end`;
}

// Screen space kept clear when fitting the map: the top status bar (36px + 2px border)
// and a small margin around the map.
const MAP_SCREEN_TOP = 38;
const MAP_SCREEN_MARGIN = 8;
// Closest zoom-in still shows this many tile rows top to bottom.
const CAMERA_MIN_VISIBLE_ROWS = 8;
const CAMERA_ZOOM_STEP = 1.15;
// The backroom window: at most this share of the screen below the status bar, tiles never
// drawn larger than this zoom, and a title strip above the window's map.
const BACKROOM_WINDOW_SHARE = 0.9;
const BACKROOM_MAX_ZOOM = 1.25;
const BACKROOM_TITLE_HEIGHT = 26;
const BACKROOM_FRAME_BORDER = 3;

// Reputation lost when a thrown crate hits a customer.
const CRATE_HIT_REPUTATION_PENALTY = 1;
// Reputation lost when a customer leaves the queue without a sale.
const ANGRY_REPUTATION_PENALTY = 1;
// Reputation lost once when a customer cannot find any of their primary items.
const MISSING_PRIMARY_REPUTATION_PENALTY = 1;

// Units of stock in one ordered crate. Its cost comes from Market's per-item supplier rate.
export const RESTOCK_QUANTITY = 5;

// Loading Pad: a 3x3 grid of crate spots, each fitting one 32px crate (all px).
const LOADING_PAD_SPOT_SIZE = 32;
const LOADING_PAD_SPOT_SPACING = 40;
// How far (px) a crate may overhang a neighboring spot before that spot counts as taken.
const LOADING_PAD_OVERHANG_ALLOWANCE = 6;

// Register size and reach (px). Reach is measured from the edge of the register graphic.
const REGISTER_INTERACT_RANGE = 64;
const REGISTER_WIDTH = 90;
const REGISTER_HEIGHT = 75;
// On-screen width of the register's front view (true pixel scale, like the characters);
// its other views use the same scale.
const REGISTER_FACING_ART_WIDTH = 72;
// Share of the register art (from its top edge) that is monitor and printer, not counter.
const REGISTER_PASSABLE_TOP_FRACTION = 60 / 169;
// The same share for each facing of the register's per-facing art.
const REGISTER_PASSABLE_TOP_BY_FACING = Object.freeze({ down: 0.14, left: 0.1, up: 0.14, right: 0.1 });
// How far the operating player's feet sit past the register graphic's top edge (px).
const REGISTER_BEHIND_OVERLAP = 10;
// Extra drop (share of the player's height) when standing behind a register from above.
const REGISTER_ABOVE_LOWER_FRACTION = 0.3;
const REGISTER_BELOW_RAISE_FRACTION = 0.65;
// How far (px) the first customer in line may overlap the front of the register art.
const REGISTER_FRONT_OVERLAP = 10;
// Distance between customers waiting in the register line; just over a customer's height.
const REGISTER_QUEUE_SPACING = 52;

// How close (px) the player must be to a fixture's standPoint to open it or deliver a crate.
// Looser than Crate's INTERACT_RANGE because standPoint is a single pixel, so a tight radius
// failed from almost any angle but dead-center.
const SHELF_INTERACT_RANGE = 110;

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
   * @param {{ savedShopData?: object }} data - save to load, or none for a new shop
   */
  init(data = {}) {
    this.savedShopData = data.savedShopData ?? null;
  }

  create() {
    this.eventBus = new EventBus();
    this.debugInfo = null;
    this.startingShift = false;
    this.loadFailed = false;
    this.autosaveBlocked = false;
    this.saveInProgress = null;
    this.saveErrorWindow = null;
    this.autosaveQueued = false;
    this.lastSavedSnapshot = null;
    this.saveStatus = "Not saved yet";
    this.gameMessageElement = document.getElementById("game-message");
    if (!this.gameMessageElement) throw new Error("Missing game message element");
    this.gameMessageTimeout = null;
    this.gameMessageActive = false;
    this.crateHint = "";
    this.events.once("shutdown", () => {
      clearTimeout(this.gameMessageTimeout);
      this.gameMessageTimeout = null;
      this.gameMessageElement.classList.add("hidden");
      this.shiftClosingOverlay?.remove();
      this.shiftClosingOverlay = null;
    });
    // Sync after Arcade Physics finalizes the player's position for this frame.
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, this.syncCarriedCrate, this);
    this.playerState = new PlayerState(this.eventBus);
    this.recalculateActiveFactions();
    this.market = new Market(database.getAllItems());
    this.shiftClock = new ShiftClock();
    this.customerArrivalSchedule = [];
    this.nextScheduledArrival = 0;
    this.customerPool = null;
    this.customerPoolAtShiftStart = null;
    this.poolRefreshCooldownMs = 0;
    this.storeTemporarilyClosed = false;
    this.storeTemporarilyClosedSinceMs = null;
    this.hud = new HUDController(
      this.playerState,
      this.shiftClock,
      () => this.startNextShift(),
      () => this.saveManually(),
      () => this.openFinances(),
      () => this.toggleTemporaryStoreClosure(),
      () => this.confirmReturnToMainMenu(),
    );

    this.windowManager = new WindowManager();
    this.shiftEnded = false; // guards endShift() from firing more than once per shift
    this.customersServedThisShift = 0;
    this.creditsAtShiftStart = this.playerState.credits;
    this.reputationAtShiftStart = this.playerState.globalReputation;

    // Shop map: the authored tile room (see RoomLayout.js).
    this.room = new TileRoom(this);
    this.setupCamera();

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

    // The Sales Floor's door to the backroom, and the backroom's exit back out. Both are
    // solid; pressing E in front of one moves the player to the floor just inside the other.
    this.room.addBackroomDoors();
    const link = getBackroomLink();
    const doorCell = getBackroomDoorCell();
    const exitCell = getBackroomExitCell();
    this.backroomDoor = { x: this.room.worldX(doorCell.gx), y: this.room.worldY(doorCell.gy) };
    // The glass door slides open while the player stands in front of it.
    this.backroomDoorAnimation = new AnimatedDoor(this, {
      x: this.backroomDoor.x,
      y: this.backroomDoor.y + TILE_SIZE / 2,
      sprite: BACKROOM_DOOR_SPRITE,
    });
    this.backroomDoorFront = { x: this.room.worldX(link.shop.gx), y: this.room.worldY(link.shop.gy) };
    this.backroomExit = { x: this.room.worldX(exitCell.gx), y: this.room.worldY(exitCell.gy) };
    // The same glass door on the backroom side, opening while the player is in front of it.
    this.backroomExitAnimation = new AnimatedDoor(this, {
      x: this.backroomExit.x,
      y: this.backroomExit.y + TILE_SIZE / 2,
      sprite: BACKROOM_DOOR_SPRITE,
    });
    this.backroomExitFront = { x: this.room.worldX(link.backroom.gx), y: this.room.worldY(link.backroom.gy) };
    this.playerInBackroom = false;
    this.setupBackroomWindow();

    // Every placed fixture lives in this registry: shelves, shared-capacity lockers, and
    // the register.
    this.fixtures = new FixtureRegistry();
    // The register's body is solid to the player and crates only: customers queue almost
    // flush against its front edge, so it can't join obstacleGroup.
    this.registerGroup = this.physics.add.staticGroup();
    // Each fixture's footprint, blocked for pathfinding (filled by applyFixtureLayout).
    this.blockedCells = new Set();
    for (const entry of STARTING_FIXTURES) this.spawnFixture(entry);
    this.operatingRegister = false;
    this.playerPositionBeforeRegister = null;

    // Customers spawn just inside the front door. The small jitter box keeps several quick
    // arrivals from stacking on one pixel.
    const { doorwayPoint } = this.storeDoorAnimation;
    this.customerSpawnBounds = {
      xMin: doorwayPoint.x - 8,
      xMax: doorwayPoint.x + 8,
      yMin: this.storeDoor.y + 8,
      yMax: this.storeDoor.y + TILE_SIZE,
    };
    // Customers leave by walking back out through the same door.
    this.exitPoint = { x: doorwayPoint.x, y: this.storeDoor.y };

    this.checkoutWindow = new CheckoutWindow(this.windowManager);
    this.checkoutWindow.onFirstScan = () => this.registerLine[0]?.resetPatience();
    this.goBacksWindow = new GoBacksWindow(this.windowManager, this.playerState);
    this.fixtureWindow = new FixtureWindow(this.windowManager, this.playerState, this.eventBus);
    // Customers waiting at the register; index 0 is being checked out. Re-laid-out by
    // layoutRegisterLine whenever it changes so they queue single-file.
    this.registerLine = [];

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
    this.refreshCamera();
    this.physics.add.collider(this.player.sprite, this.room.wallGroup);
    this.physics.add.collider(this.player.sprite, this.obstacleGroup);
    // The register is its own group so customers (who share obstacleGroup) can queue
    // flush against it; the player still collides with it.
    this.physics.add.collider(this.player.sprite, this.registerGroup);

    // Loading Pad: ordered crates spawn here and must be hauled in by hand. It fills the
    // zone's two rows above its south wall; the top row stays open as the walkway into
    // the Storeroom.
    const loadingPad = getLoadingPadBounds();
    this.loadingPadSpawnPoint = {
      x: (loadingPad.left + loadingPad.right) / 2,
      y: (loadingPad.top + loadingPad.bottom) / 2,
    };
    this.drawLoadingPad();
    this.loadingPadRect = new Phaser.Geom.Rectangle(
      this.loadingPadSpawnPoint.x - LOADING_PAD_WIDTH / 2,
      this.loadingPadSpawnPoint.y - LOADING_PAD_HEIGHT / 2,
      LOADING_PAD_WIDTH,
      LOADING_PAD_HEIGHT,
    );
    const { gridW, gridH } = getAuthoredGridSize();
    this.crateBounds = new Phaser.Geom.Rectangle(0, 0, gridW * TILE_SIZE, gridH * TILE_SIZE);
    this.crateGroup = this.physics.add.group();
    this.physics.add.collider(this.crateGroup, this.crateGroup, (spriteA, spriteB) => {
      for (const sprite of [spriteA, spriteB]) {
        this.restockCrates.find((crate) => crate.sprite === sprite)?.refreshDrag();
      }
    });
    this.physics.add.collider(this.crateGroup, this.room.wallGroup);
    this.physics.add.collider(this.crateGroup, this.obstacleGroup);
    this.physics.add.collider(this.crateGroup, this.registerGroup);
    // Loose crates bounce off the loading pad; only the deliveries locked onto it sit inside.
    // The player and customers walk over it freely.
    const padBarrier = this.add.zone(
      this.loadingPadRect.centerX,
      this.loadingPadRect.centerY,
      LOADING_PAD_WIDTH,
      LOADING_PAD_HEIGHT,
    );
    this.physics.add.existing(padBarrier, true);
    this.physics.add.collider(this.crateGroup, padBarrier, null, (crateSprite) =>
      !this.restockCrates.find((crate) => crate.sprite === crateSprite)?.lockedToPad);
    // Overlap rather than collide, so thrown crates hit customers without blocking their paths.
    this.physics.add.overlap(this.crateGroup, this.customerGroup, (crateSprite, customerSprite) => {
      const crate = this.restockCrates.find((candidate) => candidate.sprite === crateSprite);
      const customer = this.customers.find((candidate) => candidate.sprite === customerSprite);
      if (crate && customer && crate.tryHitCustomer(customer)) {
        this.eventBus.emit(GAME_EVENTS.CUSTOMER_HIT_BY_CRATE, {
          customer,
          itemId: crate.itemId,
        });
      }
    });
    this.restockCrates = []; // uncarried crates, at the Loading Pad or dropped on the floor
    this.carriedCrate = null; // the uppermost carried crate, used for the next action
    this.carriedCrates = [];
    // Floats above a carried crate: what's inside, and for items, how many locker spaces it needs.
    this.carriedCrateLabel = this.add.text(0, 0, "", {
      fontFamily: "Courier New, monospace",
      fontSize: "13px",
      fontStyle: "bold",
      color: "#ffffff",
      backgroundColor: "#111827",
      padding: { x: 3, y: 2 },
      align: "center",
    }).setOrigin(0.5, 1).setVisible(false);

    this.crateMotionPaused = false;
    this.shiftClock.subscribe(({ started, isPaused }) => {
      const paused = started && isPaused;
      // Paused time must freeze the register too, or the player could ring up for free.
      this.checkoutWindow.setPaused(paused);
      if (paused === this.crateMotionPaused) return;
      this.crateMotionPaused = paused;
      for (const crate of this.restockCrates) crate.setPaused(paused);
    });
    this.customers = [];
    this.employees = [];
    const initialLayout = this.fixtures.layout();
    const initialAccess = validateFixtureLayout(initialLayout, this.getLayoutOptions());
    if (!initialAccess.valid) throw new Error(initialAccess.reason);
    this.applyFixtureLayout(initialLayout, initialAccess);
    this.fixturePlacement = new FixturePlacement(this);
    this.input.mouse.disableContextMenu();
    this.interactables = new InteractableRegistry();
    this.registerInteractableSources();
    this.controlMode = new ControlMode(this);

    // E opens fixtures or delivers/places crates; Q unpacks stock or opens Go-Backs.
    this.bindControlKey("keydown-E", "interact", () => this.handleInteract());
    this.bindSecondaryInteractKey();
    this.bindCrateKey();
    this.registerPrompt = this.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#e2e8f0",
      backgroundColor: "#0b1220",
      padding: { x: 6, y: 4 },
      align: "center",
    }).setOrigin(0.5, 1).setDepth(9990).setVisible(false);

    // Constructed after the fixtures exist: its Supply tab reads their stock immediately
    // on construction (via SupplyRenderer -> getRestockableItems()).
    this.managerTablet = new ManagerTablet(this.windowManager, this.playerState, this);
    this.debugInfo = new DebugInfo(this);
    this.eventBus.on(GAME_EVENTS.CUSTOMER_HIT_BY_CRATE, ({ customer }) => {
      const penalty = CRATE_HIT_REPUTATION_PENALTY;
      customer.playerState.subReputation(penalty, customer.factionId);
      this.showFloatingText(
        customer.sprite.x,
        customer.sprite.y - 40,
        `Customer hit!\n${reputationPenaltyText(penalty, customer.factionId)}`,
        "#ef4444",
      );
      this.debugInfo?.recordCustomer("customer-hit-by-crate", customer);
    });
    this.eventBus.on(GAME_EVENTS.CUSTOMER_LEFT_ANGRY, ({ customer, cart }) => {
      const penalty = ANGRY_REPUTATION_PENALTY;
      customer.playerState.subReputation(penalty, customer.factionId);
      this.showFloatingText(
        customer.sprite.x,
        customer.sprite.y - 40,
        `Left angry!\n${reputationPenaltyText(penalty, customer.factionId)}`,
        "#ef4444",
      );
      this.handleAngryLeave(customer, cart);
    });
    this.eventBus.on(GAME_EVENTS.CUSTOMER_MISSING_PRIMARY, ({ customer, itemIds, itemNames }) => {
      const penalty = MISSING_PRIMARY_REPUTATION_PENALTY;
      customer.playerState.subReputation(penalty, customer.factionId);
      this.showFloatingText(
        customer.sprite.x,
        customer.sprite.y - 40,
        `Out of stock:\n${itemNames.join("\n")}\n${reputationPenaltyText(penalty, customer.factionId)}`,
        "#ef4444",
      );
      this.debugInfo?.record("customer-missing-primary", {
        customerId: this.debugInfo.identifyCustomer(customer),
        itemIds,
      });
    });
    this.eventBus.on(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, ({ customer }) => {
      this.recordSale(customer.cart);
      this.playerState.addReputation(1, customer.factionId);
      this.customersServedThisShift += 1;
      this.debugInfo?.recordCustomer("customer-sale-completed", customer);
    });
    this.eventBus.on(GAME_EVENTS.CRATE_DELIVERY_RESULT, ({ itemId, accepted, remaining }) => {
      const item = database.getItem(itemId);
      if (remaining === 0) {
        this.showGameMessage(`Restocked ${item.name} +${accepted}`, "#10b981");
      } else {
        this.showGameMessage(
          accepted > 0
            ? `Restocked +${accepted}, ${remaining} left (full)`
            : `Already full -- still carrying ${remaining}`,
          "#f59e0b",
        );
      }
      this.debugInfo?.record("crate-delivery-result", { itemId, accepted, remaining });
    });
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
    this.bindControlKey("keydown-I", "tablet", () => this.managerTablet.openWindow());

    // The shop camera: PageUp zooms in, PageDown zooms out (never past the whole shop).
    this.bindControlKey("keydown-PAGE_UP", "cameraZoom", () => this.zoomCamera(1));
    this.bindControlKey("keydown-PAGE_DOWN", "cameraZoom", () => this.zoomCamera(-1));

    // Debug-only: tile-grid overlay that makes off-grid fixtures obvious.
    this.bindControlKey("keydown-G", "debug", () => this.toggleDebugGrid());

    // Debug-only: lets one random customer in right away.
    this.bindControlKey("keydown-Y", "debug", () => this.spawnCustomer(null));

    // Debug-only: skip the opening setup with a stocked shelf and a third locker.
    this.bindControlKey("keydown-K", "debug", () => this.debugQuickstart());

    // The shift clock's manual pause: freezes time entirely so the player can think.
    this.bindControlKey("keydown-P", "pause", () => this.shiftClock.togglePause());

    // Controller: the same actions as the keys above (see handleGamepad), plus a menu cursor
    // for every window.
    this.padInput = new GamepadInput();
    this.uiNavigator = new UINavigator({
      onUnhandled: (button) => this.handleUnusedMenuButton(button),
    });

    this.events.once("shutdown", () => {
      this.uiNavigator.destroy();
      this.eventBus.clear();
      this.debugInfo.destroy();
      this.fixturePlacement.destroy();
      this.managerTablet.uiWindow.onClose = null;
      this.managerTablet.disableInventoryNavigation();
      this.managerTablet.fixtureHighlight.destroy();
      this.autosaveTimer.remove();
      this.storeDoorAnimation.destroy();
      this.backroomDoorAnimation.destroy();
      this.backroomExitAnimation.destroy();
      this.hud.destroy();
      this.fixtureWindow.destroy();
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
    this.playerState.subscribe(() => {
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

  bindSecondaryInteractKey() {
    this.bindControlKey("keydown-Q", "goBacks", (event) => {
      if (!event.repeat) this.handleSecondaryInteract();
    });
  }

  handleSecondaryInteract() {
    if (this.carriedCrate?.kind === "item" && this.controlMode.allows("unpack")) {
      this.unpackCarriedCrate();
    } else {
      this.openGoBacksBin();
    }
  }

  /**
   * One frame of controller input. A screen on top gets it through the menu cursor;
   * otherwise each button runs the same action as its keyboard key:
   *   A = E (interact)   X = Space (crate)   Y = Q (go-backs; unpack a stock crate)   Back = I (tablet)
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
      this.fixturePlacement.handlePad(pad);
    } else {
      if (pad.justPressed(PAD.A)) this.handleInteract();
      if (pad.justPressed(PAD.X) && !this.checkoutWindow.usesSpaceKey()) this.handleCrateInteract();
      if (pad.justPressed(PAD.Y)) this.handleSecondaryInteract();
      if (pad.justPressed(PAD.B) && this.operatingRegister) this.endRegisterSession();
    }
    if (pad.justPressed(PAD.LB)) this.handleUnusedMenuButton(PAD.LB);
    if (pad.justPressed(PAD.RB)) this.handleUnusedMenuButton(PAD.RB);
  }

  // Buttons the open screen had no use for, e.g. B or Y while ringing up a customer.
  handleUnusedMenuButton(button) {
    if (button === PAD.B && this.operatingRegister) this.endRegisterSession();
    if (button === PAD.Y) this.openGoBacksBin();
    if ((button === PAD.LB || button === PAD.RB) && this.controlMode.allows("cameraZoom")) {
      this.zoomCamera(button === PAD.RB ? 1 : -1);
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

  // The camera starts zoomed so the shop the player owns fills the screen. PageUp/PageDown
  // zoom in and out; the furthest zoom-out always shows the whole owned shop. Buying an
  // expansion keeps the current zoom, so the camera follows the player whenever the shop
  // is bigger than the screen.
  setupCamera() {
    if (!this.cameraResizeListening) {
      this.cameraResizeListening = true;
      this.scale.on(Phaser.Scale.Events.RESIZE, this.handleCameraResize, this);
      this.events.once("shutdown", () => {
        this.scale.off(Phaser.Scale.Events.RESIZE, this.handleCameraResize, this);
        this.cameraResizeListening = false;
      });
    }
    this.cameraZoom = null;
    this.cameraViewHeight = null;
    this.refreshCamera();
  }

  // Keeps the same amount of shop visible when the window or resolution changes.
  handleCameraResize() {
    const viewH = Math.max(1, this.scale.height - MAP_SCREEN_TOP);
    if (this.cameraZoom && this.cameraViewHeight) this.cameraZoom *= viewH / this.cameraViewHeight;
    this.refreshCamera();
  }

  getCameraZoomRange() {
    const viewW = Math.max(1, this.scale.width);
    const viewH = Math.max(1, this.scale.height - MAP_SCREEN_TOP);
    const shop = this.room.getCameraBounds();
    const fitZoom = Math.min(
      Math.max(1, viewW - 2 * MAP_SCREEN_MARGIN) / shop.width,
      Math.max(1, viewH - 2 * MAP_SCREEN_MARGIN) / shop.height,
    );
    const closestZoom = viewH / (CAMERA_MIN_VISIBLE_ROWS * TILE_SIZE);
    return { min: fitZoom, max: Math.max(fitZoom, closestZoom) };
  }

  // Pop-ups drawn in the map (prompts, labels, customer bubbles) use this scale so they
  // stay the same size on screen no matter how far the camera showing them is zoomed.
  getPopupScale(worldX, worldY) {
    return 1 / (this.cameraAt(worldX, worldY)?.zoom || 1);
  }

  /**
   * The camera that draws a world point: the backroom window's for backroom points while
   * it's open, otherwise the shop camera. With no point, the shop camera.
   * @param {number} [worldX]
   * @param {number} [worldY]
   */
  cameraAt(worldX, worldY) {
    const backroom = this.backroomCamera;
    if (backroom?.visible && Number.isFinite(worldY) && isBackroomRow(Math.floor(worldY / TILE_SIZE))) {
      return backroom;
    }
    return this.cameras?.main;
  }

  /**
   * Screen position to world position, through whichever camera is drawn there.
   * @param {number} screenX
   * @param {number} screenY
   */
  screenToWorld(screenX, screenY) {
    const backroom = this.backroomCamera;
    const overBackroom = backroom?.visible &&
      Phaser.Geom.Rectangle.Contains(new Phaser.Geom.Rectangle(backroom.x, backroom.y, backroom.width, backroom.height), screenX, screenY);
    return (overBackroom ? backroom : this.cameras.main).getWorldPoint(screenX, screenY);
  }

  zoomCamera(direction) {
    this.cameraZoom = (this.cameraZoom ?? this.cameras.main.zoom) * CAMERA_ZOOM_STEP ** direction;
    this.refreshCamera();
  }

  refreshCamera() {
    const camera = this.cameras.main;
    const viewW = Math.max(1, this.scale.width);
    const viewH = Math.max(1, this.scale.height - MAP_SCREEN_TOP);
    // The map is drawn only below the top status bar.
    camera.setViewport(0, MAP_SCREEN_TOP, viewW, viewH);

    const { min, max } = this.getCameraZoomRange();
    const zoom = Phaser.Math.Clamp(this.cameraZoom ?? min, min, max);
    this.cameraZoom = zoom;
    this.cameraViewHeight = viewH;
    camera.setZoom(zoom);

    // Pad the shop's edges with a small margin, and widen any side shorter than the
    // screen so the shop sits centered instead of stuck to one edge.
    const shop = this.room.getCameraBounds();
    const margin = MAP_SCREEN_MARGIN / zoom;
    const visibleW = viewW / zoom;
    const visibleH = viewH / zoom;
    const boundsW = Math.max(shop.width + 2 * margin, visibleW);
    const boundsH = Math.max(shop.height + 2 * margin, visibleH);
    camera.setBounds(
      shop.x + shop.width / 2 - boundsW / 2,
      shop.y + shop.height / 2 - boundsH / 2,
      boundsW,
      boundsH,
    );

    // In the backroom the shop view holds still where the player left it.
    if (this.player?.sprite && !this.playerInBackroom) {
      camera.startFollow(this.player.sprite, true);
    } else if (this.player?.sprite) {
      camera.stopFollow();
    } else {
      camera.centerOn(shop.x + shop.width / 2, shop.y + shop.height / 2);
    }
    this.refreshBackroomWindow();
  }

  // --- Backroom window ---

  // The backroom has its own camera, drawn as a framed window over the middle of the shop
  // while the player is inside. The shop keeps running behind it.
  setupBackroomWindow() {
    this.backroomCamera = this.cameras.add(0, 0, 1, 1, false, "backroom")
      .setBackgroundColor("#05080f")
      .setVisible(false);
    const frame = document.createElement("div");
    frame.id = "backroom-window";
    frame.className = "backroom-window hidden";
    frame.innerHTML = '<div class="backroom-window-title">BACKROOM</div>';
    document.getElementById("ui-layer")?.appendChild(frame);
    this.backroomFrame = frame;
    this.events.once("shutdown", () => {
      frame.remove();
      this.backroomFrame = null;
    });
    this.refreshBackroomWindow();
  }

  // Sizes the window to fit the backroom the player owns: buying a backroom upgrade makes
  // both the room and its window bigger.
  refreshBackroomWindow() {
    const camera = this.backroomCamera;
    if (!camera) return;
    const open = this.playerInBackroom;
    camera.setVisible(open);
    this.backroomFrame?.classList.toggle("hidden", !open);
    if (!open) return;

    const screenW = Math.max(1, this.scale.width);
    const screenH = Math.max(1, this.scale.height - MAP_SCREEN_TOP);
    const room = this.room.getCameraBounds("backroom");
    const zoom = Math.min(
      (screenW * BACKROOM_WINDOW_SHARE) / room.width,
      (screenH * BACKROOM_WINDOW_SHARE - BACKROOM_TITLE_HEIGHT) / room.height,
      BACKROOM_MAX_ZOOM,
    );
    const width = Math.round(room.width * zoom);
    const height = Math.round(room.height * zoom);
    const x = Math.round((screenW - width) / 2);
    const y = Math.round(MAP_SCREEN_TOP + (screenH - height + BACKROOM_TITLE_HEIGHT) / 2);
    camera.setViewport(x, y, width, height).setZoom(zoom);
    camera.setBounds(room.x, room.y, room.width, room.height);
    camera.centerOn(room.x + room.width / 2, room.y + room.height / 2);

    const frame = this.backroomFrame;
    if (!frame) return;
    const canvas = this.game.canvas.getBoundingClientRect();
    const layer = frame.parentElement.getBoundingClientRect();
    const scaleX = canvas.width / this.scale.width;
    const scaleY = canvas.height / this.scale.height;
    const border = BACKROOM_FRAME_BORDER;
    Object.assign(frame.style, {
      left: `${canvas.left - layer.left + x * scaleX - border}px`,
      top: `${canvas.top - layer.top + y * scaleY - BACKROOM_TITLE_HEIGHT - border}px`,
      width: `${width * scaleX}px`,
      height: `${height * scaleY + BACKROOM_TITLE_HEIGHT}px`,
      borderWidth: `${border}px`,
    });
  }

  /**
   * The backroom door the player is standing in front of (the shop's door, or the backroom's
   * exit while inside), or null. E goes through it.
   * @returns {{ x: number, y: number } | null}
   */
  getNearbyBackroomDoor() {
    if (!this.player?.sprite || !this.backroomDoor) return null;
    const door = this.playerInBackroom ? this.backroomExit : this.backroomDoor;
    const { x, y } = this.player.sprite;
    const below = y - door.y;
    if (Math.abs(x - door.x) >= TILE_SIZE / 2 || below <= 0 || below >= TILE_SIZE * 1.75) return null;
    // A locker beside the door wins when the player is standing nearer to it.
    const target = this.interactables?.findTarget("interact", this.getInteractionOrigin());
    if (target?.kind === "fixture" && Math.abs(x - target.target.x) < Math.abs(x - door.x)) return null;
    return door;
  }

  /**
   * Moves the player (and anything they carry) between the shop and the backroom, arriving
   * on the floor just inside the other door, facing away from it.
   * @param {boolean} inBackroom
   */
  setPlayerInBackroom(inBackroom) {
    this.playerInBackroom = inBackroom;
    const arrival = inBackroom ? this.backroomExitFront : this.backroomDoorFront;
    this.player.teleportTo(arrival.x, arrival.y);
    this.player.forceFacing("down");
    this.syncCarriedCrate();
    this.refreshCamera();
    this.debugInfo?.record(inBackroom ? "entered-backroom" : "left-backroom", {});
  }

  syncCarriedCrate() {
    this.player.updateCarryPose?.();
    const crates = this.getCarriedCrates();
    crates.forEach((crate, index) => crate.followCarrier?.(this.player.sprite, index, PLAYER_CRATE_HOLD_OFFSET));
  }

  getCarriedCrates() {
    if (Array.isArray(this.carriedCrates)) return this.carriedCrates;
    return this.carriedCrate ? [this.carriedCrate] : [];
  }

  addCarriedCrate(crate) {
    const stack = this.getCarriedCrates();
    stack.push(crate);
    this.carriedCrates = stack;
    this.carriedCrate = crate;
    this.syncCarriedCrate();
  }

  removeCarriedCrate(crate) {
    const stack = this.getCarriedCrates();
    const index = stack.indexOf(crate);
    if (index < 0) return false;
    stack.splice(index, 1);
    this.carriedCrates = stack;
    if (this.carriedCrate === crate) this.carriedCrate = stack.at(-1) ?? null;
    this.syncCarriedCrate();
    return true;
  }

  createItemCrate(itemId, quantity, x, y) {
    const item = database.getItem(itemId);
    return new Crate(this, itemId, quantity, x, y, { tint: getItemCrateTint(item?.tags) });
  }

  registerInteractableSources() {
    this.interactables.registerProvider("stock-holders", () =>
      this.fixtures.stockHolders().map((fixture) => ({
        id: `fixture:${fixture.id}`,
        kind: "fixture",
        target: fixture,
        actions: ["fixture", "interact"],
        range: SHELF_INTERACT_RANGE,
        priority: 2,
        distanceFrom: (origin) => fixtureInteractionDistance(fixture, origin),
      })));

    this.interactables.registerProvider("register", () => {
      const fixture = this.fixtures.register();
      if (!fixture?.sprite) return [];
      return [{
        id: "register",
        kind: "register",
        target: fixture,
        actions: ["register", "goBacks", "interact"],
        range: REGISTER_INTERACT_RANGE,
        priority: 1,
        hint: `${controlLabel("interact")}: Activate Register\n${controlLabel("goBacks")}: Go-Backs`,
        distanceFrom: ({ x, y }) => {
          const bounds = fixture.sprite.getBounds();
          const dx = Math.max(bounds.left - x, 0, x - bounds.right);
          const dy = Math.max(bounds.top - y, 0, y - bounds.bottom);
          return Math.hypot(dx, dy);
        },
      }];
    });

    this.interactables.registerProvider("crates", () =>
      this.restockCrates.map((crate, index) => ({
        id: `crate:${index}`,
        target: crate,
        actions: [crate.canPickUp() ? "cratePickup" : "movingCrate"],
        range: INTERACT_RANGE,
        priority: 1,
        hint: crate.kind === "fixture"
          ? `${getFixtureType(crate.typeId).name} fixture | ${controlLabel("crate")}: Pick up`
          : `${database.getItem(crate.itemId).name} x${crate.quantity} | ${controlLabel("crate")}: Pick up`,
        distanceFrom: ({ x, y }) => crate.distanceTo(x, y),
      })));
  }

  getInteractionOrigin() {
    return { x: this.player.sprite.x, y: this.player.sprite.y };
  }

  // --- Fixture layout ---

  /**
   * Builds a fixture model and its sprite, then registers it. Shelves and lockers start
   * empty; applySave fills in contents afterward.
   * @param {{ id: string, type: string, gx: number, gy: number, rotation?: number }} entry - gx/gy is the top-left cell
   * @returns {object} the registered fixture
   */
  spawnFixture({ id, type, gx, gy, rotation = 0 }) {
    const spec = getFixtureType(type);
    if (!spec) throw new Error(`Unknown fixture type: ${type}`);
    const footprint = fixtureFootprint({ type, rotation });
    const base = {
      id,
      x: (gx + footprint.w / 2) * TILE_SIZE,
      y: (gy + footprint.h / 2) * TILE_SIZE,
      // Unrotated size: the shelf's item grid and art are laid out in this frame.
      gridDimensions: { w: spec.w, h: spec.h },
    };
    let fixture;
    if (spec.kind === "shelf") {
      fixture = new ShelfFixture({
        ...base,
        displayType: "universal",
        displayGrid: getShelfDisplayGrid(spec),
        // Per-placement slot cap, not a shared pool -- see ShelfFixture.getPlacementCapacity.
        stackDepth: spec.stackDepth,
        placements: [],
      });
    } else if (spec.kind === "storage") {
      fixture = new StorageFixture({ ...base, displayType: "storage", capacity: spec.capacity, stock: [] });
    } else {
      fixture = { ...base };
    }
    Object.assign(fixture, { type, gx, gy, rotation });
    if (spec.kind === "register") this.drawRegister(fixture);
    else this.drawFixture(fixture, getFixtureTexture(this, spec));
    this.orientFixtureSprite(fixture);
    if (fixture instanceof ShelfFixture) {
      fixture.stockDisplay = new ShelfIconDisplay(
        this,
        fixture,
        (itemId) => database.getItem(itemId),
      );
      fixture.stockDisplay.setAngle(rotation * 90);
      fixture.stockDisplay.sync();
    }
    if (fixture.capacityLabel) this.refreshLockerCapacityDisplay(fixture);
    return this.fixtures.add(fixture);
  }

  /**
   * Turns the sprite to the fixture's rotation and fits its collision box to the turned
   * footprint. Phaser's own refit ignores rotation, so the box is set by hand.
   * @param {object} fixture
   */
  orientFixtureSprite(fixture) {
    const { sprite, x, y } = fixture;
    const rotation = fixtureRotation(fixture);
    const spec = getFixtureType(fixture.type);
    // Art drawn for each facing is swapped in upright; other art is spun to face its way.
    const facingArt = hasFacingTextures(spec);
    if (spec.id === "locker_single") {
      const sheet = getSingleLockerSprite(rotation);
      sprite.setTexture(sheet.key, fixture.lockerAnimation.frameIndex);
      sizeSingleLocker(sprite, rotation);
    } else if (facingArt) {
      sprite.setTexture(getFixtureTexture(this, spec, rotation));
      this.sizeFacingArt(sprite, spec, rotation);
    }
    sprite.setPosition(x, y).setAngle(facingArt ? 0 : rotation * 90);
    const sideways = !facingArt && rotation % 2 === 1;
    let width = sideways ? sprite.displayHeight : sprite.displayWidth;
    let height = sideways ? sprite.displayWidth : sprite.displayHeight;
    let centerX = x;
    let centerY = y;
    // The register art's top part is the monitor and printer standing on the counter; only
    // the counter itself blocks movement.
    if (facingArt && spec.kind === "register") {
      const trim = height * REGISTER_PASSABLE_TOP_BY_FACING[fixtureFacing(fixture)];
      height -= trim;
      centerY += trim / 2;
    } else if ((facingArt && spec.kind === "shelf") || spec.id === "locker_single") {
      const footprint = fixtureFootprint(fixture);
      width = footprint.w * TILE_SIZE;
      height = footprint.h * TILE_SIZE;
    } else if (spec?.kind === "register") {
      // Older spun art: that top part faces the rotated direction.
      const trim = (sideways ? width : height) * REGISTER_PASSABLE_TOP_FRACTION;
      const [dx, dy] = [[0, 1], [-1, 0], [0, -1], [1, 0]][rotation];
      if (sideways) width -= trim;
      else height -= trim;
      centerX += dx * trim / 2;
      centerY += dy * trim / 2;
    }
    const body = sprite.body;
    body.world.staticTree.remove(body);
    body.position.set(centerX - width / 2, centerY - height / 2);
    body.width = width;
    body.height = height;
    body.halfWidth = width / 2;
    body.halfHeight = height / 2;
    body.center.set(centerX, centerY);
    body.world.staticTree.insert(body);
  }

  sizeFacingArt(sprite, spec, rotation = 0) {
    if (spec.kind === "shelf") {
      const footprint = fixtureFootprint({ type: spec.id, rotation });
      sprite.setDisplaySize(footprint.w * TILE_SIZE, footprint.h * TILE_SIZE);
    } else {
      sprite.setScale(this.getFacingArtScale(spec));
    }
  }

  /**
   * Scale the register's facing art against its front view.
   * @param {object} spec
   */
  getFacingArtScale(spec) {
    const source = this.textures?.get(spec.facingTextures.down)?.getSourceImage?.();
    const targetWidth = spec.kind === "register" ? REGISTER_FACING_ART_WIDTH : spec.w * TILE_SIZE;
    return source?.width ? targetWidth / source.width : 1;
  }

  despawnAllFixtures() {
    for (const fixture of this.fixtures.clear()) {
      fixture.stockDisplay?.destroy();
      fixture.capacityLabel?.destroy();
      fixture.sprite.destroy();
    }
  }

  /**
   * Options for validateFixtureLayout: walkability, the entrance, and cells no fixture may
   * cover (doorways, both sides of the backroom entrance, and the Loading Pad).
   * @param {Array<{ left: number, right: number, top: number, bottom: number }>} occupiedRectangles - bodies a fixture must not land on (px)
   */
  getLayoutOptions(occupiedRectangles = []) {
    const entrance = getStoreDoorCell();
    const link = getBackroomLink();
    const doorwayCells = new Set([
      ...getStoreDoorCells().flatMap(({ gx, gy }) => [`${gx},${gy}`, `${gx},${gy + 1}`]),
      `${link.shop.gx},${link.shop.gy}`,
      `${link.backroom.gx},${link.backroom.gy}`,
    ]);
    const reservedCells = new Set(doorwayCells);
    return {
      isWalkable: (gx, gy) => this.room.isWalkable(gx, gy),
      // Door art counts as a doorway, not wall a fixture can tuck into.
      isWall: (gx, gy) => {
        const wall = this.room.wallCells.get(`${gx},${gy}`);
        return Boolean(wall && !wall.door);
      },
      entrance, reservedCells, doorwayCells, occupiedRectangles, links: [[link.shop, link.backroom]],
      backroomBounds: getBackroomInteriorBounds(this.room.zones),
      reservedRectangles: [getLoadingPadBounds()],
    };
  }

  // Saving needs a quiet store: no shift running and nobody inside.
  canSaveOffShift() {
    return !this.loadFailed && (!this.shiftClock.started || this.shiftEnded) && this.customers.length === 0;
  }

  canHireEmployees() {
    return !this.startingShift && !this.loadFailed && this.canSaveOffShift();
  }

  hireEmployee(employeeId) {
    const employee = this.playerState.getEmployeeProfile(employeeId);
    if (!this.canHireEmployees()) {
      this.showShopMessage("Staff can only be hired between shifts.");
      return false;
    }
    if (this.playerState.hiredEmployees.includes(employeeId)) return false;
    const staffLimitReason = getStaffLimitReason(
      this.playerState.shopLevel, this.playerState.hiredEmployees.length,
    );
    if (staffLimitReason) {
      this.showShopMessage(staffLimitReason);
      return false;
    }
    if (!this.playerState.hireEmployee(employeeId)) {
      this.showShopMessage(`Not enough credits. ${employee.hireCost} credits are required.`);
      return false;
    }
    this.showGameMessage(
      `${employee.name} hired and On Shift. ${employee.wagePerShift} credits in wages are due at each shift start.`,
      "#10b981",
    );
    this.requestAutosave();
    return true;
  }

  setEmployeeOnShift(employeeId, onShift) {
    const employee = this.playerState.getEmployeeProfile(employeeId);
    if (!this.canHireEmployees()) {
      this.showShopMessage("Staff can only be set On Shift or Off Shift between shifts.");
      return false;
    }
    if (this.playerState.employeeTraining[employeeId]) {
      this.showShopMessage(`${employee.name} is away training next shift. They're available again once they return.`);
      return false;
    }
    if (!this.playerState.setEmployeeOnShift(employeeId, onShift)) return false;
    this.showGameMessage(
      onShift
        ? `${employee.name} is On Shift. They'll work and be paid ${employee.wagePerShift} credits each shift.`
        : `${employee.name} is Off Shift. They'll stay home and won't be paid until you set them On Shift.`,
      "#10b981",
    );
    this.requestAutosave();
    return true;
  }

  getEmployeeTrainingBlockReason(employeeId, jobId) {
    const offer = getEmployeeTrainingOffer(
      employeeId, this.playerState.employeeSkills[employeeId], jobId,
    );
    if (!this.canHireEmployees()) return "Book employee training between shifts.";
    if (!this.playerState.hiredEmployees.includes(employeeId)) return "Hire this employee before booking training.";
    if (this.playerState.employeeTraining[employeeId]) return "This employee already has training booked.";
    if (!offer) return "This skill is already at Level 5.";
    if (this.playerState.credits < offer.cost) return `Training costs ${offer.cost} credits.`;
    return null;
  }

  trainEmployee(employeeId, jobId) {
    const reason = this.getEmployeeTrainingBlockReason(employeeId, jobId);
    if (reason) {
      this.showShopMessage(reason);
      return false;
    }
    if (!this.playerState.trainEmployee(employeeId, jobId)) {
      this.showShopMessage("Training is no longer available. Check the employee's skill and your credits.");
      return false;
    }
    const employee = this.playerState.getEmployeeProfile(employeeId);
    this.showGameMessage(
      `${employee.name} will be away training next shift. Their ${employee.wagePerShift}-credit wage is still due.`,
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
    if (!this.playerState.moveEmployeeJobPriority(employeeId, jobId, direction)) return false;
    this.requestAutosave();
    return true;
  }

  // Wages are paid up front, even into the red (bible Step 32), one receipt line each.
  payEmployeeWages() {
    let total = 0;
    for (const employeeId of this.playerState.getPaidEmployees()) {
      const employee = this.playerState.getEmployeeProfile(employeeId);
      if (employee.wagePerShift <= 0) continue;
      this.playerState.spendCredits(employee.wagePerShift, {
        category: "wages",
        label: employee.name,
      });
      total += employee.wagePerShift;
    }
    return total;
  }

  spawnHiredEmployees() {
    this.employees = this.playerState.getWorkingEmployees()
      .map((employeeId) => new Employee(this, this.playerState.getEmployeeProfile(employeeId)));
  }

  clearEmployees() {
    for (const employee of this.employees) employee.destroy();
    this.employees = [];
  }

  canRearrangeFixtures() {
    return this.canSaveOffShift() && !this.startingShift;
  }

  // Fixtures can only be moved from the same room the player is standing in.
  getFixtureMoveAreaBlockReason(fixture) {
    if (!fixture) return null;
    const inBackroom = isBackroomRow(Math.floor(fixture.gy));
    if (inBackroom === Boolean(this.playerInBackroom)) return null;
    const name = this.fixtures.displayName(fixture);
    return inBackroom
      ? `Go into the backroom to move the ${name}.`
      : `Go out to the sales floor to move the ${name}.`;
  }

  getExpansionPurchaseOptions() {
    const nextId = EXPANSION_ORDER.find((id) =>
      this.room.zones.find((zone) => zone.id === id)?.locked);
    return EXPANSION_ORDER.map((id) => {
      const zone = this.room.zones.find((candidate) => candidate.id === id);
      if (!zone) throw new Error(`Unknown sales-floor expansion: ${id}`);
      return {
        zone,
        isPurchased: !zone.locked,
        isNext: id === nextId,
        levelMet: this.playerState.shopLevel >= zone.requiredShopLevel,
        canAfford: this.playerState.credits >= zone.cost,
      };
    });
  }

  getBackroomPurchaseOptions() {
    const nextId = BACKROOM_UPGRADE_ORDER.find((id) =>
      this.room.zones.find((zone) => zone.id === id)?.locked);
    return BACKROOM_UPGRADE_ORDER.map((id) => {
      const zone = this.room.zones.find((candidate) => candidate.id === id);
      if (!zone) throw new Error(`Unknown backroom expansion: ${id}`);
      return {
        zone,
        isPurchased: !zone.locked,
        isNext: id === nextId,
        levelMet: this.playerState.shopLevel >= zone.requiredShopLevel,
        canAfford: this.playerState.credits >= zone.cost,
      };
    });
  }

  buyExpansion(zoneId) {
    if (!EXPANSION_ORDER.includes(zoneId)) {
      throw new Error(`Unknown sales-floor expansion: ${zoneId}`);
    }
    if (!this.canRearrangeFixtures()) {
      this.showShopMessage("Store expansions can only be bought while the store is closed.");
      return false;
    }
    const zone = this.room.zones.find((candidate) => candidate.id === zoneId);
    if (!zone) throw new Error(`Unknown sales-floor expansion: ${zoneId}`);
    if (!zone.locked) {
      this.showShopMessage(`${zone.name} is already open.`);
      return false;
    }
    const nextId = EXPANSION_ORDER.find((id) =>
      this.room.zones.find((candidate) => candidate.id === id)?.locked);
    if (zoneId !== nextId) {
      this.showShopMessage("Buy sales-floor expansions in order.");
      return false;
    }
    if (this.playerState.shopLevel < zone.requiredShopLevel) {
      this.showShopMessage(
        `Reach Shop Level ${zone.requiredShopLevel} to buy ${zone.name}.`,
      );
      return false;
    }
    if (this.playerState.credits < zone.cost) {
      this.showShopMessage(`${zone.name} costs ${formatMoney(zone.cost)}.`);
      return false;
    }

    this.playerState.spendCredits(zone.cost, { category: "expansions", label: zone.name });
    this.room.unlockZone(zoneId);
    this.refreshCamera();
    this.playerState.notifyListeners();
    this.requestAutosave();
    this.showShopMessage(`${zone.name} is open.`);
    return true;
  }

  buyBackroomUpgrade(zoneId) {
    if (!BACKROOM_UPGRADE_ORDER.includes(zoneId)) {
      throw new Error(`Unknown backroom expansion: ${zoneId}`);
    }
    if (!this.canRearrangeFixtures()) {
      this.showShopMessage("Backroom expansions can only be bought while the store is closed.");
      return false;
    }
    const zone = this.room.zones.find((candidate) => candidate.id === zoneId);
    if (!zone) throw new Error(`Unknown backroom expansion: ${zoneId}`);
    if (!zone.locked) {
      this.showShopMessage(`${zone.name} is already open.`);
      return false;
    }
    const nextId = BACKROOM_UPGRADE_ORDER.find((id) =>
      this.room.zones.find((candidate) => candidate.id === id)?.locked);
    if (zoneId !== nextId) {
      this.showShopMessage("Buy backroom expansions in order.");
      return false;
    }
    if (this.playerState.shopLevel < zone.requiredShopLevel) {
      this.showShopMessage(
        `Reach Shop Level ${zone.requiredShopLevel} to buy ${zone.name}.`,
      );
      return false;
    }
    if (this.playerState.credits < zone.cost) {
      this.showShopMessage(`${zone.name} costs ${formatMoney(zone.cost)}.`);
      return false;
    }

    this.playerState.spendCredits(zone.cost, { category: "expansions", label: zone.name });
    this.room.unlockZone(zoneId);
    this.refreshCamera();
    this.playerState.notifyListeners();
    this.requestAutosave();
    this.showShopMessage(`${zone.name} is open.`);
    return true;
  }

  /**
   * The current layout with one fixture moved and turned; nothing is applied.
   * @param {string} id
   * @param {number} gx
   * @param {number} gy
   * @param {number} [rotation] - quarter turns clockwise; defaults to its current rotation
   */
  layoutWithMove(id, gx, gy, rotation) {
    return this.fixtures.layout().map((entry) =>
      entry.id === id ? { ...entry, gx, gy, rotation: rotation ?? entry.rotation } : entry);
  }

  /**
   * Validates a move without applying it. The player and loose crates count as obstacles.
   * @param {string} id
   * @param {number} gx
   * @param {number} gy
   * @param {number} [rotation]
   * @returns {{ valid: boolean, reason?: string }} validateFixtureLayout's result
   */
  checkFixtureMove(id, gx, gy, rotation) {
    const areaBlock = this.getFixtureMoveAreaBlockReason(this.fixtures.get(id));
    if (areaBlock) return { valid: false, reason: areaBlock };
    if (isBackroomRow(Math.floor(gy)) !== Boolean(this.playerInBackroom)) {
      return { valid: false, reason: this.playerInBackroom ? "Keep it in the backroom." : "Keep it on the sales floor." };
    }
    const bodies = [this.player.sprite.body, ...this.restockCrates.map((crate) => crate.sprite.body)];
    return validateFixtureLayout(this.layoutWithMove(id, gx, gy, rotation), this.getLayoutOptions(
      bodies.filter((body) => body.enable).map((body) => ({
        left: body.left, right: body.right, top: body.top, bottom: body.bottom,
      })),
    ));
  }

  /**
   * Moves a fixture if the store is closed and the new spot is valid; otherwise shows why not.
   * @param {string} id
   * @param {number} gx
   * @param {number} gy
   * @param {number} [rotation]
   * @returns {boolean} whether it moved
   */
  moveFixture(id, gx, gy, rotation) {
    if (!this.canRearrangeFixtures()) {
      this.showShopMessage("Fixtures can only move while the store is closed.");
      return false;
    }
    if (!this.fixtures.get(id)) throw new Error(`Unknown fixture: ${id}`);
    const result = this.checkFixtureMove(id, gx, gy, rotation);
    if (!result.valid) {
      this.showShopMessage(result.reason);
      return false;
    }
    this.applyFixtureLayout(this.layoutWithMove(id, gx, gy, rotation), result);
    this.playerState.notifyListeners();
    return true;
  }

  /**
   * Moves and turns every fixture sprite to its layout cell and adopts the validated access
   * points, pathfinding blocks, and register queue cells.
   * @param {Array<{ id: string, gx: number, gy: number, rotation?: number }>} layout
   * @param {object} result - a valid result from validateFixtureLayout for this layout
   */
  applyFixtureLayout(layout, result) {
    const toWorld = (cell) => ({ x: this.room.worldX(cell.gx), y: this.room.worldY(cell.gy) });
    for (const entry of layout) {
      const fixture = this.fixtures.get(entry.id);
      fixture.gx = entry.gx;
      fixture.gy = entry.gy;
      fixture.rotation = entry.rotation ?? 0;
      const footprint = fixtureFootprint(fixture);
      fixture.x = (entry.gx + footprint.w / 2) * TILE_SIZE;
      fixture.y = (entry.gy + footprint.h / 2) * TILE_SIZE;
      this.orientFixtureSprite(fixture);
      fixture.standPoint = fixtureStandingSpot(fixture, result.access.get(entry.id));
    }
    this.blockedCells = result.blockedCells;
    for (const fixture of this.fixtures.all()) {
      fixture.stockDisplay?.setPosition(fixture.x, fixture.y);
      fixture.stockDisplay?.setAngle(fixtureRotation(fixture) * 90);
      if (fixture.capacityLabel) this.refreshLockerCapacityDisplay(fixture);
    }
    this.registerQueuePoints = this.placeRegisterQueue(result.queueCells.map(toWorld));
    this.registerQueueAnchor = this.registerQueuePoints[0];
    if (this.goBacksBadge) this.refreshGoBacksBadge();
  }

  // The register art is smaller than its floor footprint, so tile centers leave the first
  // customer a long reach from the counter. The first customer stands at the counter like the
  // player behind it; everyone else stands an even step apart along the line's path.
  placeRegisterQueue(points) {
    if (points.length === 0) return points;
    const register = this.fixtures.register();
    const bounds = register.sprite.getBounds();
    const { dx, dy } = fixtureFacingStep(register);
    const reachX = bounds.width / 2 + SPRITE_DISPLAY_WIDTH / 2 - REGISTER_FRONT_OVERLAP;
    const reachY = bounds.height / 2 + SPRITE_DISPLAY_HEIGHT / 2 - REGISTER_FRONT_OVERLAP;
    const front = { x: bounds.centerX + dx * reachX, y: bounds.centerY + dy * reachY };
    const shift = (front.x - points[0].x) * dx + (front.y - points[0].y) * dy;
    if (shift >= 0) return points;
    // The straight run out from the counter is centered on the register art.
    let straight = true;
    const path = [front, ...points.slice(1).map((point, offset) => {
      const index = offset + 1;
      straight = straight && point.x === points[0].x + dx * index * TILE_SIZE &&
        point.y === points[0].y + dy * index * TILE_SIZE;
      if (!straight) return point;
      return dx !== 0 ? { x: point.x, y: front.y } : { x: front.x, y: point.y };
    })];
    const placed = [front];
    const segmentLength = (i) => Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
    let segment = 0;
    let along = 0;
    while (placed.length < points.length) {
      along += REGISTER_QUEUE_SPACING;
      while (segment < path.length - 1 && along > segmentLength(segment)) {
        along -= segmentLength(segment);
        segment += 1;
      }
      if (segment >= path.length - 1) break;
      const t = along / segmentLength(segment);
      const a = path[segment];
      const b = path[segment + 1];
      placed.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    // Spare spots (the path ran out) fall back to the remaining tile centers.
    return placed.concat(points.slice(placed.length));
  }

  // Centered on the register graphic, just past its back edge (the side away from the
  // line). The graphic is smaller than its footprint, so a grid cell left the player
  // floating off to one side.
  getBehindRegisterPoint() {
    const register = this.fixtures.register();
    const bounds = register.sprite.getBounds();
    const { dx, dy } = fixtureFacingStep(register, true);
    const player = this.player.sprite;
    const reachX = bounds.width / 2 + player.displayWidth / 2 - REGISTER_BEHIND_OVERLAP;
    const reachY = bounds.height / 2 + player.displayHeight / 2 - REGISTER_BEHIND_OVERLAP;
    return { x: bounds.centerX + dx * reachX, y: bounds.centerY + dy * reachY };
  }

  // --- Saving and loading ---

  serialize() {
    const pending = this.fixtureWindow.pendingPlacement;
    const snapshot = {
      playerState: this.playerState.serialize(),
      market: this.market.serialize(),
      fixtures: this.fixtures.all().map((fixture) => {
        const entry = { id: fixture.id, type: fixture.type, gx: fixture.gx, gy: fixture.gy, rotation: fixtureRotation(fixture) };
        if (fixture instanceof ShelfFixture) {
          const placements = fixture.placements.map((stack) => ({ ...stack }));
          // A stack lifted mid-move is saved back at its origin.
          if (pending?.moving && this.fixtureWindow.fixture === fixture) {
            placements.push({ ...pending.moving, ...pending.origin });
          }
          return { ...entry, placements };
        }
        if (fixture instanceof StorageFixture) {
          return { ...entry, stock: fixture.stock.filter((stack) => stack.quantity > 0).map((stack) => ({ ...stack })) };
        }
        return entry;
      }),
      unlockedZones: this.room.zones.filter((zone) => !zone.locked).map((zone) => zone.id),
      layoutVersion: SHOP_LAYOUT_VERSION,
      crates: this.restockCrates.map((crate) => crate.serialize()),
      carriedCrate: this.carriedCrate ? {
        ...this.carriedCrate.serializePayload(),
      } : null,
      carriedCrates: this.getCarriedCrates().map((crate) => crate.serializePayload()),
    };
    return validateShopSave(snapshot, database);
  }

  /**
   * Replaces the whole shop with a saved one. Throws if the save is invalid.
   * @param {object} saved - raw save data; validated by validateShopSave
   */
  applySave(saved) {
    const data = validateShopSave(saved, database);
    for (const id of data.unlockedZones) this.room.unlockZone(id);
    // Saves from before the sales-floor rule still load; the misplaced fixture can then be moved out.
    const result = validateFixtureLayout(data.fixtures, { ...this.getLayoutOptions(), requireSalesFloor: false });
    if (!result.valid) throw new Error(`Invalid saved layout: ${result.reason}`);
    this.despawnAllFixtures();
    for (const entry of data.fixtures) {
      const fixture = this.spawnFixture(entry);
      if (fixture instanceof ShelfFixture) fixture.placements = entry.placements.map((stack) => ({ ...stack }));
      if (fixture instanceof StorageFixture) fixture.stock = entry.stock.map((stack) => ({ ...stack }));
    }
    this.applyFixtureLayout(data.fixtures, result);
    this.market.applySave(data.market);
    this.playerInBackroom = false;
    this.player.teleportTo(this.storeDoor.x, this.storeDoor.y + TILE_SIZE);
    this.refreshCamera();
    for (const crate of this.restockCrates) crate.destroy();
    this.restockCrates = data.crates.map((entry) => {
      const crate = entry.kind === "fixture"
        ? new Crate(this, entry.itemId, entry.quantity, entry.x, entry.y, { kind: "fixture", typeId: entry.typeId })
        : this.createItemCrate(entry.itemId, entry.quantity, entry.x, entry.y);
      crate.applySave(entry);
      // Older saves have no onPad flag: anything resting on the pad was a delivery.
      const onPad = entry.onPad ?? this.loadingPadRect.contains(entry.x, entry.y);
      if (onPad) crate.lockToPad();
      return crate;
    });
    for (const crate of this.getCarriedCrates()) crate.destroy();
    if (this.carriedCrate && !this.getCarriedCrates().includes(this.carriedCrate)) this.carriedCrate.destroy();
    this.carriedCrate = null;
    this.carriedCrates = [];
    const carriedEntries = Array.isArray(data.carriedCrates)
      ? data.carriedCrates
      : data.carriedCrate ? [data.carriedCrate] : [];
    for (const entry of carriedEntries) {
      const crate = entry.kind === "fixture"
        ? new Crate(this, entry.itemId, entry.quantity, this.player.sprite.x, this.player.sprite.y,
          { kind: "fixture", typeId: entry.typeId })
        : this.createItemCrate(entry.itemId, entry.quantity, this.player.sprite.x, this.player.sprite.y);
      crate.pickUp(this.player.sprite);
      this.carriedCrates.push(crate);
    }
    this.carriedCrate = this.carriedCrates.at(-1) ?? null;
    this.syncCarriedCrate();
    this.playerState.applySave(data.playerState, { day: this.market.day });
    this.moveShelfOverflowToGoBacks();
    this.refreshShelfStockDisplays();
    this.recalculateActiveFactions();
    this.creditsAtShiftStart = this.playerState.credits;
    this.reputationAtShiftStart = this.playerState.globalReputation;
    this.setupCamera();
    this.lastSavedSnapshot = JSON.stringify(this.serialize());
    this.setSaveStatus("Saved. Autosaves while the store is closed.");
  }

  // Older saves can hold more in a shelf slot than its cap allows; the excess goes to Go-Backs.
  moveShelfOverflowToGoBacks() {
    let moved = 0;
    for (const shelf of this.fixtures.shelves()) {
      for (const placement of shelf.placements) {
        const overflow = placement.quantity - shelf.getPlacementCapacity(placement);
        if (overflow <= 0) continue;
        const transfer = transferItems(shelf, this.playerState.goBacks, placement.itemId, overflow, {
          sourceEntry: placement,
          eventBus: this.eventBus,
          sourceName: "shelf",
          destinationName: "go-backs",
        });
        if (transfer.moved !== overflow) {
          throw new Error("Could not move saved shelf overflow into Go-Backs.");
        }
        moved += transfer.moved;
      }
    }
    if (moved > 0) this.playerState.notifyListeners();
  }

  refreshShelfStockDisplay(shelf) {
    shelf?.stockDisplay?.sync();
  }

  refreshShelfStockDisplays() {
    for (const shelf of this.fixtures.shelves()) this.refreshShelfStockDisplay(shelf);
  }

  // Coalesces any number of requests in one tick into a single save attempt.
  requestAutosave() {
    if (!this.canSaveOffShift() || this.autosaveBlocked || this.autosaveQueued) return;
    this.autosaveQueued = true;
    queueMicrotask(() => {
      this.autosaveQueued = false;
      if (!this.scene.isActive() || !this.canSaveOffShift()) return;
      this.saveOffShift().catch((error) => this.handlePersistenceError(error));
    });
  }

  async saveManually() {
    if (this.loadFailed || this.startingShift || !this.canSaveOffShift()) {
      this.showShopMessage(this.loadFailed
        ? "Cannot save after a load error. Your existing save has not been overwritten."
        : "Finish the shift before saving.");
      return;
    }
    try {
      await this.saveOffShift();
      this.autosaveBlocked = false;
      this.saveErrorWindow?.close();
      this.setSaveStatus("Saved. Autosaves while the store is closed.");
      this.showShopMessage("Game saved.");
    } catch (error) {
      this.handlePersistenceError(error);
    }
  }

  // Waits out any save already running, then skips writing if nothing changed since the
  // last successful save.
  async saveOffShift() {
    if (!this.canSaveOffShift()) return;
    if (this.saveInProgress) {
      await this.saveInProgress;
      return this.saveOffShift();
    }
    const snapshot = JSON.stringify(this.serialize());
    if (snapshot === this.lastSavedSnapshot) return;
    this.saveInProgress = this.saveManager.save();
    this.setSaveStatus("Saving...");
    try {
      await this.saveInProgress;
      this.lastSavedSnapshot = snapshot;
      this.autosaveBlocked = false;
      this.setSaveStatus("Saved. Autosaves while the store is closed.");
      this.saveErrorWindow?.close();
    } finally {
      this.saveInProgress = null;
      this.updateSaveControls();
    }
  }

  updateSaveControls() {
    if (!this.hud) return;
    this.hud.renderSaveState({
      canSave: !this.startingShift && this.canSaveOffShift(),
      saving: Boolean(this.saveInProgress),
      status: this.saveStatus,
      unavailableReason: this.loadFailed
        ? "Saving disabled: your saved game could not be loaded."
        : this.startingShift ? "Starting the shift..." : "Finish the shift before saving.",
    });
  }

  setSaveStatus(text) {
    this.saveStatus = text;
    this.managerTablet?.updateSaveStatus();
    this.updateSaveControls();
  }

  // --- On-screen messages and save errors ---

  showShopMessage(message) {
    this.showGameMessage(message, "#f59e0b");
  }

  /**
   * Shows a temporary message (2250 ms, then a 250 ms fade), after which the current
   * context hint returns.
   * @param {string} message
   * @param {string} color - CSS color
   */
  showGameMessage(message, color = "#f59e0b") {
    const element = this.gameMessageElement;
    if (!element) throw new Error("Game message element is not initialized");
    clearTimeout(this.gameMessageTimeout);
    this.gameMessageActive = true;
    element.textContent = message;
    element.style.setProperty("--game-message-color", color);
    element.classList.remove("hidden", "fading", "context-message");
    this.gameMessageTimeout = setTimeout(() => {
      element.classList.add("fading");
      this.gameMessageTimeout = setTimeout(() => {
        this.gameMessageTimeout = null;
        this.gameMessageActive = false;
        this.renderContextMessage();
      }, 250);
    }, 2250);
  }

  renderContextMessage() {
    // Temporary warnings take priority; restore the current hint when they expire.
    if (this.gameMessageActive) return;
    const element = this.gameMessageElement;
    if (element.textContent !== this.crateHint) element.textContent = this.crateHint;
    element.style.setProperty("--game-message-color", "#38bdf8");
    element.classList.remove("fading");
    element.classList.add("context-message");
    element.classList.toggle("hidden", !this.crateHint);
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
    if (!this.saveErrorWindow) {
      this.saveErrorWindow = new UIWindow({
        id: "save-error-window", title: "SAVE / LOAD ERROR", width: "400px", height: "auto",
        x: 80, y: 120, shouldCloseOtherWindows: true,
        contentHTML: '<p data-save-error role="alert"></p><button class="action-btn" data-save-retry></button>',
      }, this.windowManager);
      this.saveErrorWindow.element.querySelector("[data-save-retry]").addEventListener("click", () => {
        if (this.loadFailed) this.scene.start("scene-title");
        else {
          this.autosaveBlocked = false;
          this.saveOffShift().catch((failure) => this.handlePersistenceError(failure));
        }
      });
    }
    this.saveErrorWindow.element.querySelector("[data-save-error]").textContent =
      `${this.loadFailed ? "Your saved game could not be loaded. It has not been overwritten." : "Your progress could not be saved."} ${error.message}`;
    this.saveErrorWindow.element.querySelector("[data-save-retry]").textContent =
      this.loadFailed ? "RETURN TO TITLE" : "RETRY SAVE";
    this.saveErrorWindow.openWindow();
  }

  // --- Pathfinding ---

  /**
   * Whether a customer could stand at this cell: in an unlocked zone, not a wall, and not
   * under a fixture.
   * @param {number} gx
   * @param {number} gy
   */
  isCellWalkable(gx, gy) {
    if (!this.room.isWalkable(gx, gy)) return false;
    return !this.blockedCells.has(`${gx},${gy}`);
  }

  /**
   * @param {ShelfFixture | null} [excludedShelf] - the customer's next planned stop
   * @returns {ShelfFixture | null} a different currently stocked shelf to browse
   */
  getRandomBrowseShelf(excludedShelf = null) {
    const shelves = this.fixtures.shelves().filter((shelf) =>
      shelf !== excludedShelf && shelf.findAvailableSlot(),
    );
    return shelves.length ? shelves[Math.floor(Math.random() * shelves.length)] : null;
  }

  // Whether a customer can walk this segment without brushing a wall or a solid fixture.
  isStraightWalkClear(fromX, fromY, toX, toY) {
    const line = new Phaser.Geom.Line(fromX, fromY, toX, toY);
    const halfW = SPRITE_DISPLAY_WIDTH / 2;
    const halfH = SPRITE_DISPLAY_HEIGHT / 2;
    const solids = [...this.obstacleGroup.getChildren(), ...this.room.wallGroup.getChildren()];
    return solids.every((solid) => {
      const body = solid.body;
      if (!body) return true;
      const padded = new Phaser.Geom.Rectangle(body.x - halfW, body.y - halfH,
        body.width + halfW * 2, body.height + halfH * 2);
      return !Phaser.Geom.Intersects.LineToRectangle(line, padded);
    });
  }

  /**
   * A grid path between two world points, routed around walls and fixtures. Null means
   * no safe route exists and must not be treated as a direct path.
   * @param {number} fromX - px
   * @param {number} fromY - px
   * @param {number} toX - px
   * @param {number} toY - px
   * @returns {Array<{ x: number, y: number }> | null} world-space waypoints
   */
  findPath(fromX, fromY, toX, toY) {
    // The shop and backroom only connect through their door pair: walk to this side's door,
    // step through it, then walk on from the other side's door.
    const inBackroom = (y) => isBackroomRow(Math.floor(y / TILE_SIZE));
    if (this.backroomDoorFront && inBackroom(fromY) !== inBackroom(toY)) {
      const [near, far] = inBackroom(fromY)
        ? [this.backroomExitFront, this.backroomDoorFront]
        : [this.backroomDoorFront, this.backroomExitFront];
      const toDoor = this.findAreaPath(fromX, fromY, near.x, near.y);
      const fromDoor = toDoor && this.findAreaPath(far.x, far.y, toX, toY);
      if (!fromDoor) return null;
      return [...toDoor, { x: near.x, y: near.y, teleportTo: { x: far.x, y: far.y } }, ...fromDoor];
    }
    return this.findAreaPath(fromX, fromY, toX, toY);
  }

  findAreaPath(fromX, fromY, toX, toY) {
    // Close enough to step straight there; routing via tile centers would make a customer
    // already at their spot (like the counter front) walk out and back.
    if (Math.hypot(toX - fromX, toY - fromY) < TILE_SIZE && this.isStraightWalkClear(fromX, fromY, toX, toY)) {
      return [];
    }
    const cellAt = (x, y) => ({ gx: Math.floor(x / TILE_SIZE), gy: Math.floor(y / TILE_SIZE) });
    // Spots like the counter front sit over the register's floor space. Route from and to the
    // closest open floor instead, so a customer leaving the counter backs out the way they came
    // rather than slipping around the side of the register.
    const nearestOpenCell = (x, y) => {
      const cell = cellAt(x, y);
      if (this.isCellWalkable(cell.gx, cell.gy)) return { cell, snapped: false };
      const distance = ({ gx, gy }) => Math.hypot(this.room.worldX(gx) - x, this.room.worldY(gy) - y);
      const open = [-1, 0, 1].flatMap((ox) => [-1, 0, 1].map((oy) => ({ gx: cell.gx + ox, gy: cell.gy + oy })))
        .filter(({ gx, gy }) => this.isCellWalkable(gx, gy))
        .sort((a, b) => distance(a) - distance(b));
      return open[0] ? { cell: open[0], snapped: true } : { cell, snapped: false };
    };
    const start = nearestOpenCell(fromX, fromY);
    const goal = nearestOpenCell(toX, toY).cell;

    const gridPath = findGridPath(start.cell, goal, (gx, gy) => this.isCellWalkable(gx, gy));
    if (!gridPath) return null;
    if (start.snapped) gridPath.unshift(start.cell);

    return gridPath.map(({ gx, gy }) => ({
      x: this.room.worldX(gx),
      y: this.room.worldY(gy),
    }));
  }

  // --- Debug hooks ---
  // G key: tile-grid overlay over the whole map, locked zones included. Depth 9998 sits
  // just under the player (9999) so it draws over every fixture, making off-grid ones obvious.
  toggleDebugGrid() {
    if (!this.debugGridGraphics) {
      const { gridW, gridH } = getTotalGridSize();
      const width = gridW * TILE_SIZE;
      const height = gridH * TILE_SIZE;

      this.debugGridGraphics = this.add.graphics().setDepth(9998);
      this.debugGridGraphics.lineStyle(1, 0x00ffff, 0.5);
      for (let gx = 0; gx <= gridW; gx += 1) {
        this.debugGridGraphics.lineBetween(gx * TILE_SIZE, 0, gx * TILE_SIZE, height);
      }
      for (let gy = 0; gy <= gridH; gy += 1) {
        this.debugGridGraphics.lineBetween(0, gy * TILE_SIZE, width, gy * TILE_SIZE);
      }
      this.debugGridGraphics.setVisible(false);
    }

    this.debugGridGraphics.setVisible(!this.debugGridGraphics.visible);
  }

  // K key: skips the opening setup for testing. Signs whatever contracts the four cheapest
  // one-spot items need, puts a Budget Shelf near the door stocked full of them, drops the
  // leftover crate units in lockers, adds a third locker, and charges for all of it.
  debugQuickstart() {
    if (this.fixtures.shelves().length > 0) {
      this.showShopMessage("Quickstart only works before you place a shelf.");
      return false;
    }
    const shelfType = "shelf_budget_2x2";
    const shelfSpec = getFixtureType(shelfType);
    const lockerSpec = getFixtureType("locker_single");
    const items = database.getAllItems()
      .filter((item) => item.dimensions.w === 1 && item.dimensions.h === 1)
      .filter((item) => {
        const license = database.getLicense(item.license);
        return this.playerState.activeLicenses.has(item.license) || license?.isUnlocked(this.playerState);
      })
      .sort((a, b) => a.baseCost - b.baseCost ||
        (database.getLicense(a.license)?.baseCost ?? 0) - (database.getLicense(b.license)?.baseCost ?? 0))
      .slice(0, 4);

    const door = getStoreDoorCell();
    const lockers = this.fixtures.ofKind("storage");
    const lastLocker = lockers[lockers.length - 1];
    const shelfCell = this.findNearestFixtureCell(shelfType, door);
    const lockerCell = this.findNearestFixtureCell("locker_single", lastLocker ?? door);
    if (!shelfCell || !lockerCell) {
      this.showShopMessage("Quickstart couldn't find room for the shelf and locker.");
      return false;
    }

    for (const licenseId of new Set(items.map((item) => item.license))) {
      if (this.playerState.activeLicenses.has(licenseId)) continue;
      const license = database.getLicense(licenseId);
      this.playerState.spendCredits(license.baseCost, { category: "licenses", label: license.name });
      this.playerState.signLicense(licenseId);
    }
    this.recalculateActiveFactions();
    this.playerState.spendCredits(shelfSpec.price, { category: "fixtures", label: shelfSpec.name });
    this.playerState.spendCredits(lockerSpec.price, { category: "fixtures", label: lockerSpec.name });

    const shelf = this.spawnFixture({ id: this.fixtures.nextId(shelfType), type: shelfType, ...shelfCell });
    this.spawnFixture({ id: this.fixtures.nextId("locker_single"), type: "locker_single", ...lockerCell });
    const result = validateFixtureLayout(this.fixtures.layout(), this.getLayoutOptions());
    this.applyFixtureLayout(this.fixtures.layout(), result);

    // One item per shelf spot, in the 2x2 grid's reading order.
    const spots = [[0, 0], [1, 0], [0, 1], [1, 1]];
    items.forEach((item, index) => {
      const [gx, gy] = spots[index];
      const placement = shelf.placeItem(item.id, gx, gy, false, 0);
      const capacity = shelf.getPlacementCapacity(placement);
      const crates = Math.ceil(capacity / RESTOCK_QUANTITY);
      this.playerState.spendCredits(this.restockCost(item) * crates, {
        category: "stock_orders", label: item.name, quantity: crates,
      });
      placement.quantity = capacity;
      let leftover = crates * RESTOCK_QUANTITY - capacity;
      for (const locker of this.fixtures.ofKind("storage")) {
        if (leftover <= 0) break;
        leftover -= locker.add(item.id, leftover);
      }
      if (this.playerState.storePrices[item.id] === undefined) {
        this.playerState.storePrices[item.id] = this.market.getPrice(item.id);
      }
    });
    this.playerState.spendCredits(DELIVERY_FEE, { category: "delivery_fees", label: "Delivery fee" });

    shelf.stockDisplay.sync();
    for (const locker of this.fixtures.ofKind("storage")) this.refreshLockerCapacityDisplay(locker);
    this.playerState.notifyListeners();
    this.showShopMessage("Quickstart: shelf stocked, third locker added.");
    return true;
  }

  /**
   * The closest cell to `origin` where a new fixture of this type would be valid.
   * @param {string} typeId
   * @param {{ gx: number, gy: number }} origin
   * @returns {{ gx: number, gy: number } | null}
   */
  findNearestFixtureCell(typeId, origin) {
    const { gridW, gridH } = getAuthoredGridSize();
    const cells = [];
    for (let gy = 0; gy < gridH; gy += 1) {
      for (let gx = 0; gx < gridW; gx += 1) cells.push({ gx, gy });
    }
    cells.sort((a, b) => Math.hypot(a.gx - origin.gx, a.gy - origin.gy) -
      Math.hypot(b.gx - origin.gx, b.gy - origin.gy));
    return cells.find(({ gx, gy }) => this.checkFixturePlacement(typeId, gx, gy).valid) ?? null;
  }

  // --- Supply, pricing, and the Loading Pad ---

  // The nearest shelf or locker within SHELF_INTERACT_RANGE, or null. Shared by crate
  // delivery and opening fixtures so "close enough" means the same for both.
  getNearbyFixture() {
    return this.interactables.findTarget("fixture", this.getInteractionOrigin())?.target ?? null;
  }

  /**
   * Credits for one crate of this item. Shared by the Supply tab's price display and
   * ordering, so both always agree.
   * @param {object} item - catalog item
   * @returns {number} credits
   */
  restockCost(item) {
    return this.market.getSupplyCost(item.id, RESTOCK_QUANTITY);
  }

  /**
   * The player's own price, falling back to today's market price if never set.
   * @param {string} itemId
   * @returns {number} credits
   */
  getStorePrice(itemId) {
    return this.playerState.storePrices[itemId] ?? this.market.getPrice(itemId);
  }

  getLoadingPadSpots() {
    const offsets = [-LOADING_PAD_SPOT_SPACING, 0, LOADING_PAD_SPOT_SPACING];
    return offsets.flatMap((dy) => offsets.map((dx) => ({
      x: this.loadingPadSpawnPoint.x + dx,
      y: this.loadingPadSpawnPoint.y + dy,
    })));
  }

  // Every Loading Pad spot a new crate could land on without overlapping an existing crate.
  // A crate only blocks a spot it really sits on: fixture crates are drawn larger than a spot
  // and slightly overhang their neighbors, which shouldn't count.
  getLoadingPadSpawnPositions() {
    return this.getLoadingPadSpots().filter((position) => !this.restockCrates.some((crate) => {
      const reach = crate.sprite.displayWidth / 2 + LOADING_PAD_SPOT_SIZE / 2 - LOADING_PAD_OVERHANG_ALLOWANCE;
      return Math.abs(crate.sprite.x - position.x) < reach && Math.abs(crate.sprite.y - position.y) < reach;
    }));
  }

  // Painted floor marking: a plate with one outlined square per crate spot.
  drawLoadingPad() {
    const { x, y } = this.loadingPadSpawnPoint;
    const pad = this.add.graphics().setDepth(0.5);
    pad.fillStyle(0x0f172a, 0.55);
    pad.fillRect(x - LOADING_PAD_WIDTH / 2, y - LOADING_PAD_HEIGHT / 2, LOADING_PAD_WIDTH, LOADING_PAD_HEIGHT);
    pad.lineStyle(2, 0xfacc15, 0.9);
    pad.strokeRect(x - LOADING_PAD_WIDTH / 2, y - LOADING_PAD_HEIGHT / 2, LOADING_PAD_WIDTH, LOADING_PAD_HEIGHT);
    pad.lineStyle(1, 0xfacc15, 0.35);
    for (const spot of this.getLoadingPadSpots()) {
      pad.strokeRect(
        spot.x - LOADING_PAD_SPOT_SIZE / 2,
        spot.y - LOADING_PAD_SPOT_SIZE / 2,
        LOADING_PAD_SPOT_SIZE,
        LOADING_PAD_SPOT_SIZE,
      );
    }
    this.add
      .text(x, y - LOADING_PAD_HEIGHT / 2 - 4, "LOADING PAD", {
        fontFamily: "monospace",
        fontSize: "14px",
        fontStyle: "bold",
        color: "#facc15",
      })
      .setOrigin(0.5, 1)
      .setAlpha(0.85)
      .setDepth(0.5);
  }

  getLoadingPadSpawnPosition() {
    return this.getLoadingPadSpawnPositions()[0] ?? null;
  }

  /**
   * Prices and checks a supply order against the player's credits and free pad spots.
   * @param {Map<string, number>} order - item id -> number of crates
   */
  getSupplyOrderSummary(order) {
    return summarizeSupplyOrder(order, {
      getCrateCost: (itemId) => this.restockCost(database.getItem(itemId)),
      credits: this.playerState.credits,
      freePadSpots: this.getLoadingPadSpawnPositions().length,
    });
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
    this.playerState.setStorePrice(itemId, price);
    return true;
  }

  // Inventory tab rows: every owned item, including items currently held by customers.
  getInventoryItems() {
    const totals = new Map();
    const add = (entry, column) => {
      if (!entry.itemId || entry.quantity <= 0) return;
      if (!totals.has(entry.itemId)) {
        totals.set(entry.itemId, { storage: 0, stock: 0, inCustomerCarts: 0 });
      }
      totals.get(entry.itemId)[column] += entry.quantity;
    };

    for (const fixture of this.fixtures.stockHolders()) {
      const column = fixture instanceof ShelfFixture ? "stock" : "storage";
      for (const entry of fixture.stock) add(entry, column);
    }
    // A lifted shelf stack is still owned and assigned to that shelf until dropped.
    const moving = this.fixtureWindow.pendingPlacement?.moving;
    if (moving) add(moving, "stock");
    for (const entry of this.playerState.hovercart.stock) add(entry, "storage");
    for (const entry of this.playerState.goBacks.stock) add(entry, "storage");
    for (const crate of this.restockCrates) add(crate, "storage");
    for (const crate of this.getCarriedCrates()) {
      if (crate.kind === "item") add(crate, "storage");
    }
    for (const customer of this.customers) {
      if (customer.state === "LEAVING") continue;
      for (const { itemId } of customer.cart) {
        add({ itemId, quantity: 1 }, "inCustomerCarts");
      }
    }
    for (const employee of this.employees) {
      for (const entry of employee.backpack.stock) add(entry, "storage");
    }

    return database.getAllItems()
      .filter((item) => totals.has(item.id))
      .map((item) => ({
        item,
        ...totals.get(item.id),
        marketPrice: this.market.getPrice(item.id),
        storePrice: this.getStorePrice(item.id),
      }));
  }

  // Supply tab rows: every catalog item the player holds a Supplier License for, whether or
  // not it's stocked anywhere yet (a new fixture starts empty). Affordability is checked
  // per order, so unaffordable items still appear.
  getRestockableItems() {
    const quantityByItemId = new Map();
    for (const fixture of this.fixtures.stockHolders()) {
      for (const entry of fixture.stock) {
        quantityByItemId.set(entry.itemId, (quantityByItemId.get(entry.itemId) || 0) + entry.quantity);
      }
    }
    // Items with a shelf spot (even a sold-out one): how many are out and how many fit.
    const shelfByItemId = new Map();
    for (const shelf of this.fixtures.shelves()) {
      for (const placement of shelf.placements) {
        const totals = shelfByItemId.get(placement.itemId) || { quantity: 0, capacity: 0 };
        totals.quantity += placement.quantity;
        totals.capacity += shelf.getPlacementCapacity(placement);
        shelfByItemId.set(placement.itemId, totals);
      }
    }

    return database
      .getAllItems()
      .filter((item) => this.playerState.activeLicenses.has(item.license))
      .map((item) => ({
        item,
        quantity: quantityByItemId.get(item.id) || 0,
        shelf: shelfByItemId.get(item.id) || null,
        cost: this.restockCost(item),
      }));
  }

  // Customer factions follow the player's licenses.
  recalculateActiveFactions() {
    const activeFactions = getLicensedFactionIds(
      this.playerState.activeLicenses,
      database.getAllItems(),
    );
    this.playerState.setActiveFactions(activeFactions);
  }

  /**
   * Places a whole supply order: charges the stock plus one flat delivery fee, then drops
   * every crate onto the Loading Pad at once. Each crate is hauled to a fixture by hand.
   * @param {Map<string, number>} order - item id -> number of crates
   * @returns {boolean} false if unlicensed, unaffordable, or the pad lacks room
   */
  placeSupplyOrder(order) {
    for (const [itemId, count] of order) {
      const item = database.getItem(itemId);
      if (count > 0 && (!item || !this.playerState.activeLicenses.has(item.license))) return false;
    }
    const summary = this.getSupplyOrderSummary(order);
    if (!summary.canPlace) return false;

    const spots = this.getLoadingPadSpawnPositions();
    for (const [itemId, count] of order) {
      if (count <= 0) continue;
      const item = database.getItem(itemId);
      this.playerState.spendCredits(this.restockCost(item) * count, {
        category: "stock_orders",
        label: item.name,
        quantity: count,
      });
    }
    this.playerState.spendCredits(summary.deliveryFee, {
      category: "delivery_fees",
      label: "Delivery fee",
    });
    for (const [itemId, count] of order) {
      // A first-time item starts at today's market price, then stays put until repriced.
      if (count > 0 && this.playerState.storePrices[itemId] === undefined) {
        this.playerState.storePrices[itemId] = this.market.getPrice(itemId);
      }
      for (let index = 0; index < count; index += 1) {
        const spawn = spots.shift();
        const crate = this.createItemCrate(itemId, RESTOCK_QUANTITY, spawn.x, spawn.y);
        crate.setPaused(this.crateMotionPaused);
        crate.lockToPad();
        this.restockCrates.push(crate);
      }
    }
    this.playerState.notifyListeners();
    return true;
  }

  // --- Buying, crating, and placing fixtures ---

  // Fixture shop rows, with every reason a purchase might be blocked.
  getFixturePurchaseOptions() {
    return Object.values(FIXTURE_TYPES).map((spec) => {
      const license = database.getLicense(spec.licenseId);
      const licensed = this.playerState.activeLicenses.has(spec.licenseId);
      const uniqueAlreadyPlaced = spec.kind === "register" &&
        this.fixtures.ofKind("register").length > 0;
      const hasDeliverySpace = !!this.getLoadingPadSpawnPosition();
      return {
        spec,
        license,
        licensed,
        canAfford: this.playerState.credits >= spec.price,
        uniqueAlreadyPlaced,
        hasDeliverySpace,
      };
    });
  }

  /**
   * Buys a fixture, delivered as a crate on the Loading Pad. Only one register is allowed.
   * @param {string} typeId
   * @returns {boolean} whether the purchase went through
   */
  buyFixture(typeId) {
    const spec = getFixtureType(typeId);
    if (!spec) throw new Error(`Unknown fixture type: ${typeId}`);
    if (!this.playerState.activeLicenses.has(spec.licenseId)) return false;
    if (this.fixtures.ofKind("register").length && spec.kind === "register") return false;
    if (this.playerState.credits < spec.price) return false;
    const spawn = this.getLoadingPadSpawnPosition();
    if (!spawn) return false;

    this.playerState.spendCredits(spec.price, { category: "fixtures", label: spec.name });
    const crate = new Crate(this, null, 1, spawn.x, spawn.y, { kind: "fixture", typeId });
    crate.setPaused(this.crateMotionPaused);
    crate.lockToPad();
    this.restockCrates.push(crate);
    this.playerState.notifyListeners();
    return true;
  }

  canCrateFixture(fixture) {
    return this.getFixtureCrateBlockReason(fixture) === null;
  }

  /**
   * @param {object} fixture
   * @returns {string | null} why it can't be packed into a crate, or null if it can
   */
  getFixtureCrateBlockReason(fixture) {
    return this.getFixtureRemovalBlockReason(fixture, "crated");
  }

  getFixtureSaleBlockReason(fixture) {
    return this.getFixtureRemovalBlockReason(fixture, "sold");
  }

  getFixtureRemovalBlockReason(fixture, action) {
    if (!fixture) return "Fixture not found.";
    if (!this.canRearrangeFixtures()) return `Fixtures can only be ${action} while the store is closed.`;
    if (getFixtureType(fixture.type).kind === "register" &&
      this.fixtures.ofKind("register").length <= 1) return `The last register cannot be ${action}.`;
    const pending = this.fixtureWindow?.fixture === fixture
      ? this.fixtureWindow.pendingPlacement?.moving
      : null;
    if (fixture instanceof ShelfFixture &&
      (fixture.placements.some((stack) => stack.quantity > 0) || pending?.quantity > 0)) {
      return `Only empty fixtures can be ${action}.`;
    }
    if (fixture instanceof StorageFixture && fixture.stock.some((stack) => stack.quantity > 0)) {
      return `Only empty fixtures can be ${action}.`;
    }
    return null;
  }

  removePlacedFixture(fixture) {
    const layout = this.fixtures.layout().filter((entry) => entry.id !== fixture.id);
    const result = validateFixtureLayout(layout, { ...this.getLayoutOptions(), requireSalesFloor: false });
    if (!result.valid) {
      this.showShopMessage(result.reason);
      return false;
    }
    if (this.fixtureWindow.fixture === fixture) this.fixtureWindow.uiWindow.close();
    fixture.stockDisplay?.destroy();
    fixture.capacityLabel?.destroy();
    fixture.sprite.destroy();
    this.fixtures.remove(fixture.id);
    this.applyFixtureLayout(layout, result);
    return true;
  }

  /**
   * Packs an empty fixture into a crate where it stood, so it can be carried and re-placed.
   * @param {string} id
   * @returns {boolean} whether it was crated
   */
  crateFixture(id) {
    const fixture = this.fixtures.get(id);
    if (!fixture) throw new Error(`Unknown fixture: ${id}`);
    const reason = this.getFixtureCrateBlockReason(fixture);
    if (reason) {
      this.showShopMessage(reason);
      return false;
    }
    if (!this.removePlacedFixture(fixture)) return false;
    const crate = new Crate(this, null, 1, fixture.x, fixture.y, {
      kind: "fixture",
      typeId: fixture.type,
    });
    crate.setPaused(this.crateMotionPaused);
    this.restockCrates.push(crate);
    this.playerState.notifyListeners();
    return true;
  }

  sellFixture(id) {
    const fixture = this.fixtures.get(id);
    const reason = this.getFixtureSaleBlockReason(fixture);
    if (reason) {
      this.showShopMessage(reason);
      return false;
    }
    const spec = getFixtureType(fixture.type);
    const value = getFixtureResaleValue(fixture.type);
    if (!this.removePlacedFixture(fixture)) return false;
    this.playerState.addCredits(value, { category: "fixture_sales", label: spec.name });
    return true;
  }

  getFixtureCrateSaleBlockReason(crate) {
    if (!crate || crate.kind !== "fixture" ||
      (crate !== this.carriedCrate && !this.restockCrates.includes(crate))) {
      return "Fixture crate not found.";
    }
    if (!this.canRearrangeFixtures()) return "Fixtures can only be sold while the store is closed.";
    return null;
  }

  sellFixtureCrate(crate) {
    const reason = this.getFixtureCrateSaleBlockReason(crate);
    if (reason) {
      this.showShopMessage(reason);
      return false;
    }
    const spec = getFixtureType(crate.typeId);
    const value = getFixtureResaleValue(crate.typeId);
    if (this.getCarriedCrates().includes(crate)) this.removeCarriedCrate(crate);
    else this.restockCrates = this.restockCrates.filter((candidate) => candidate !== crate);
    crate.destroy();
    this.playerState.addCredits(value, { category: "fixture_sales", label: spec.name });
    return true;
  }

  /**
   * Validates adding a new fixture of this type without placing it. The player and loose
   * crates count as obstacles.
   * @param {string} typeId
   * @param {number} gx
   * @param {number} gy
   * @param {number} [rotation] - quarter turns clockwise
   */
  checkFixturePlacement(typeId, gx, gy, rotation = 0) {
    const id = this.fixtures.nextId(typeId);
    const layout = [...this.fixtures.layout(), { id, type: typeId, gx, gy, rotation }];
    const bodies = [this.player.sprite.body, ...this.restockCrates.map((crate) => crate.sprite.body)];
    return validateFixtureLayout(layout, this.getLayoutOptions(
      bodies.filter((body) => body.enable).map((body) => ({
        left: body.left, right: body.right, top: body.top, bottom: body.bottom,
      })),
    ));
  }

  /**
   * Unpacks the carried fixture crate into a real fixture at this cell.
   * @param {Crate} crate - must be the carried fixture crate
   * @param {number} gx
   * @param {number} gy
   * @param {number} [rotation] - quarter turns clockwise
   * @returns {boolean} whether it was placed
   */
  placeFixtureFromCrate(crate, gx, gy, rotation = 0) {
    if (!this.canRearrangeFixtures() || this.carriedCrate !== crate || crate.kind !== "fixture") return false;
    const id = this.fixtures.nextId(crate.typeId);
    const result = this.checkFixturePlacement(crate.typeId, gx, gy, rotation);
    if (!result.valid) {
      this.showShopMessage(result.reason);
      return false;
    }

    const entry = { id, type: crate.typeId, gx, gy, rotation };
    this.spawnFixture(entry);
    this.applyFixtureLayout(this.fixtures.layout(), result);
    crate.destroy();
    this.removeCarriedCrate(crate);
    this.playerState.notifyListeners();
    return true;
  }

  // --- Player interaction and crates ---

  // E delivers/places a carried crate, opens a nearby fixture, or toggles register operation.
  handleInteract() {
    if (!this.controlMode.allows("interact")) return;
    // Doors come first so a carried crate goes through with the player, not onto the floor.
    if (!this.operatingRegister && this.getNearbyBackroomDoor()) {
      this.setPlayerInBackroom(!this.playerInBackroom);
      return;
    }
    if (this.carriedCrate) {
      if (this.carriedCrate.kind === "fixture") {
        const nearby = this.getNearbyFixture();
        if (nearby && getFixtureType(nearby.type).kind === "storage") {
          this.showGameMessage("Fixtures can't be stocked here", "#94a3b8");
          return;
        }
        this.fixturePlacement.beginFromCrate(this.carriedCrate);
        return;
      }
      this.tryDeliverCarriedCrate();
      return;
    }

    const target = this.interactables.findTarget("interact", this.getInteractionOrigin());
    if (target?.kind === "fixture") {
      this.tryOpenFixtureWindow(target.target);
      return;
    }

    // Pressing E again behind the counter leaves it.
    if (this.operatingRegister) {
      this.endRegisterSession();
      return;
    }
    if (target?.kind === "register") {
      this.tryOpenRegister();
      return;
    }

    this.showGameMessage("Nothing nearby to interact with", "#94a3b8");
  }

  /**
   * Opens a shelf or locker window if the player is in range; silently does nothing if not.
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

    const alreadyOpen = this.fixtureWindow.uiWindow.isOpen && this.fixtureWindow.fixture === target;
    this.fixtureWindow.openForFixture(target, this.fixtures.displayName(target));
    if (!alreadyOpen) {
      this.eventBus.emit(GAME_EVENTS.FIXTURE_OPENED, { fixtureId: target.id, type: target.type });
    }
    return true;
  }

  // The nearest resting or pushed crate in reach, plus whether another moving crate is in reach
  // (so pickup can say "wait" instead of "nothing here").
  getCratePickupTarget() {
    const origin = this.getInteractionOrigin();
    return {
      crate: this.interactables.findTarget("cratePickup", origin)?.target ?? null,
      movingNearby: Boolean(this.interactables.findTarget("movingCrate", origin)),
    };
  }

  // Shows the nearest crate the player can pick up.
  updateCrateHint() {
    this.crateHint = "";
    const mode = this.controlMode.getMode();
    if (mode === CONTROL_MODES.CARRYING && this.carriedCrate?.kind === "item") {
      const stackSize = this.getCarriedCrates().length;
      this.crateHint =
        `${controlLabel("unpack")}: Unpack top crate | ` +
        `${controlLabel("interact")}: Deliver top crate | ` +
        `${controlLabel("crate")}: ${stackSize >= MAX_CARRIED_CRATES
          ? "Drop stack (cannot throw)"
          : stackSize > 1 ? "Stack nearby crate or drop stack" : "Stack nearby crate or drop/throw"}`;
    } else if (mode === CONTROL_MODES.WALKING) {
      this.crateHint = this.interactables.findTarget(
        "cratePickup",
        this.getInteractionOrigin(),
      )?.hint ?? "";
    }
    this.renderContextMessage();
  }

  // Handles a pickup or warns about a nearby moving crate.
  tryPickUpNearestCrate() {
    const { crate: nearest, movingNearby } = this.getCratePickupTarget();
    if (!nearest || !nearest.pickUp(this.player.sprite)) {
      if (!nearest && !movingNearby) return false;
      this.showGameMessage("Wait for crate to stop", "#f59e0b");
      return true;
    }

    this.restockCrates = this.restockCrates.filter((crate) => crate !== nearest);
    if (this.carriedCrate) this.addCarriedCrate(nearest);
    else {
      this.carriedCrates = [nearest];
      this.carriedCrate = nearest;
      this.syncCarriedCrate();
    }

    this.playerState.notifyListeners();
    this.eventBus.emit(GAME_EVENTS.CRATE_PICKED_UP, {
      kind: nearest.kind,
      itemId: nearest.itemId,
      typeId: nearest.typeId,
      quantity: nearest.quantity,
    });
    return true;
  }

  /**
   * The player bumps into crates: loose resting crates get pushed (slowing the player),
   * loading pad crates act like walls. Crates still being launched by a throw are ignored.
   * @param {number} delta - ms since last frame
   */
  updateCratePushing(delta) {
    const body = this.player.sprite.body;
    const rectOf = (b) => ({ left: b.x, top: b.y, width: b.width, height: b.height });
    const crates = this.restockCrates
      .filter((crate) => crate.lockedToPad || crate.isPushed || crate.isStationary() || crate.isSliding())
      .map((crate) => ({ key: crate, rect: rectOf(crate.sprite.body), locked: crate.lockedToPad }));
    const { playerVelocity, crateVelocities } = solveCratePush({
      player: rectOf(body),
      velocity: body.velocity,
      dt: Math.min(delta, 50) / 1000,
      crates,
      isBlocked: (rect) => this.isCrateSpaceBlocked(rect),
    });
    body.setVelocity(playerVelocity.x, playerVelocity.y);
    for (const crate of this.restockCrates) {
      const velocity = crateVelocities.get(crate);
      if (velocity && (velocity.x || velocity.y)) crate.push(velocity);
      else if (crate.isPushed) crate.stopPush();
    }
  }

  /**
   * Pull apart loose crates that sank into each other (fast throws can push them past
   * Arcade's collision), so crates never end up stacked on top of one another.
   */
  separateStuckCrates() {
    const crates = this.restockCrates
      .filter((crate) => crate.sprite.body?.enable)
      .map((crate) => {
        const b = crate.sprite.body;
        return { key: crate, rect: { left: b.x, top: b.y, width: b.width, height: b.height }, locked: crate.lockedToPad };
      });
    const offsets = separateOverlappingCrates(crates, (_crate, rect) => this.isCrateSpaceBlocked(rect));
    for (const [crate, offset] of offsets) crate.nudge(offset.x, offset.y);
  }

  /**
   * Whether a pushed crate would leave the map or overlap a static body.
   * @param {{ left: number, top: number, width: number, height: number }} rect - px
   */
  isCrateSpaceBlocked({ left, top, width, height }) {
    const bounds = this.crateBounds;
    if (left < bounds.left || top < bounds.top || left + width > bounds.right || top + height > bounds.bottom) {
      return true;
    }
    // Static bodies: walls, fixtures, the register, and the loading pad barrier.
    return this.physics.overlapRect(left, top, width, height, false, true).some((b) => b.enable);
  }

  bindCrateKey() {
    // Cursor keys capture Space by default, which blocks focused UI controls.
    this.input.keyboard.removeCapture("SPACE");
    this.input.keyboard.on("keydown-SPACE", (event) => {
      if (event.target?.closest?.("#ui-layer")) return;
      event.preventDefault();
      if (this.checkoutWindow?.usesSpaceKey()) return;
      if (!event.repeat && this.controlMode.allows("crate")) this.handleCrateInteract();
    });
  }

  // Space picks up a nearby crate onto the stack, or drops/throws what is being carried.
  handleCrateInteract() {
    if (!this.controlMode.allows("crate")) return;
    if (this.carriedCrate) {
      const { crate } = this.getCratePickupTarget();
      if (this.carriedCrate.kind === "item" && crate?.kind === "item") {
        if (this.getCarriedCrates().length >= MAX_CARRIED_CRATES) {
          this.showGameMessage("You can only carry three crates", "#f59e0b");
          return;
        }
        this.tryPickUpNearestCrate();
        return;
      }
      this.dropCarriedCrate();
      return;
    }
    if (this.operatingRegister) {
      this.showGameMessage("Leave the register to pick up a crate", "#94a3b8");
      return;
    }
    if (!this.tryPickUpNearestCrate()) {
      this.showGameMessage("No crate nearby", "#94a3b8");
    }
  }

  dropCarriedStack() {
    const stack = this.getCarriedCrates();
    const reserved = [];
    const drops = [];
    for (const crate of stack) {
      const position = crate.findDropPosition(
        this.player.sprite.x, this.player.sprite.y, this.player.sprite, reserved, INTERACT_RANGE,
      );
      if (!position) {
        this.showGameMessage("No room to drop the stack", "#94a3b8");
        return false;
      }
      drops.push({ crate, position });
      const bounds = crate.sprite.getBounds();
      reserved.push({
        left: position.x - bounds.width / 2,
        right: position.x + bounds.width / 2,
        top: position.y - bounds.height / 2,
        bottom: position.y + bounds.height / 2,
      });
    }

    for (const { crate, position } of drops) {
      crate.drop(position.x, position.y, 0, 0, this.crateMotionPaused);
      this.restockCrates.push(crate);
      this.eventBus.emit(GAME_EVENTS.CRATE_DROPPED, {
        kind: crate.kind, itemId: crate.itemId, typeId: crate.typeId, quantity: crate.quantity,
        thrown: false, x: position.x, y: position.y,
      });
    }
    this.carriedCrates = [];
    this.carriedCrate = null;
    this.syncCarriedCrate();
    this.playerState.notifyListeners();
    return true;
  }

  // Single crates are thrown while walking; a stack is always set down without a throw.
  dropCarriedCrate() {
    if (!this.controlMode.allows("crate")) return false;
    const { x, y } = this.player.sprite;
    const crate = this.carriedCrate;
    if (!crate) {
      this.showGameMessage("No crate to drop", "#94a3b8");
      return false;
    }
    if (this.operatingRegister) {
      this.showGameMessage("Leave the register to drop a crate", "#94a3b8");
      return false;
    }
    if (this.getCarriedCrates().length > 1) return this.dropCarriedStack();

    const bodyVelocity = this.player.sprite.body.velocity;
    const velocity = this.crateMotionPaused ? { x: 0, y: 0 } : { x: bodyVelocity.x, y: bodyVelocity.y };
    const throwing = velocity.x !== 0 || velocity.y !== 0;
    const position = throwing
      ? crate.findThrowPosition(this.player.sprite, velocity.x, velocity.y)
      : crate.findDropPosition(x, y, this.player.sprite);
    if (!position) {
      this.showGameMessage(throwing ? "No room to throw crate" : "No room to drop crate", "#94a3b8");
      return false;
    }

    if (throwing) crate.startThrow(this.player.sprite, velocity.x, velocity.y);
    else crate.drop(position.x, position.y, 0, 0, this.crateMotionPaused);
    this.restockCrates.push(crate);
    this.removeCarriedCrate(crate);
    this.playerState.notifyListeners();
    this.eventBus.emit(GAME_EVENTS.CRATE_DROPPED, {
      kind: crate.kind,
      itemId: crate.itemId,
      typeId: crate.typeId,
      quantity: crate.quantity,
      thrown: throwing,
      x: position.x,
      y: position.y,
    });
    return true;
  }

  // Keyboard equivalent of clicking the register: steps behind the counter if close enough,
  // even with no customer waiting. Returns false so handleInteract can show its fallback.
  tryOpenRegister() {
    if (!this.isPlayerNearRegister()) return false;
    this.openRegisterWindow();
    return true;
  }

  // Unloads the carried item crate into the nearest shelf or locker; whatever doesn't fit
  // stays in the crate.
  tryDeliverCarriedCrate() {
    const crate = this.carriedCrate;
    if (crate.kind === "fixture") {
      this.showGameMessage("Fixtures can't be stocked here", "#94a3b8");
      return;
    }
    const target = this.getNearbyFixture();

    if (!target) {
      this.showGameMessage("Too far from a fixture to deliver", "#94a3b8");
      return;
    }

    if (target.getRemainingUnitsFor(crate.itemId) === 0) {
      const item = database.getItem(crate.itemId);
      this.showGameMessage(`${item.name} can't be stocked here`, "#94a3b8");
      return;
    }

    const quantityBefore = crate.quantity;
    const transfer = transferItems(crate, target, crate.itemId, crate.quantity, {
      eventBus: this.eventBus,
      sourceName: "crate",
      destinationName: getFixtureType(target.type).kind === "shelf" ? "shelf" : "locker",
    });
    const accepted = transfer.moved;
    const fullyAccepted = accepted >= quantityBefore;
    const remaining = fullyAccepted ? 0 : quantityBefore - accepted;
    this.fixtureWindow.refresh(target); // keep its capacity bar/stock list live if open

    if (fullyAccepted) {
      // Empty crates despawn immediately rather than lying around.
      crate.destroy();
      this.removeCarriedCrate(crate);
    }
    this.playerState.notifyListeners();
    this.eventBus.emit(GAME_EVENTS.CRATE_DELIVERY_RESULT, {
      itemId: crate.itemId,
      accepted,
      remaining,
    });
  }

  unpackCarriedCrate() {
    if (!this.controlMode.allows("unpack")) return false;
    const crate = this.carriedCrate;
    if (!crate || crate.kind !== "item") return false;

    const quantityBefore = crate.quantity;
    const transfer = transferItems(crate, this.playerState.hovercart, crate.itemId, quantityBefore, {
      eventBus: this.eventBus,
      sourceName: "crate",
      destinationName: "hovercart",
    });

    if (transfer.moved === 0) {
      this.showGameMessage(`Hovercart full; ${quantityBefore} items remain in the box`, "#f59e0b");
      return false;
    }

    if (crate.quantity === 0) {
      crate.destroy();
      this.removeCarriedCrate(crate);
    }
    this.playerState.notifyListeners();
    if (crate.quantity > 0) {
      this.showGameMessage(
        `Added ${transfer.moved} items to your hovercart; ${crate.quantity} remain in the box`,
        "#f59e0b",
      );
    } else {
      this.showGameMessage(`Added ${transfer.moved} items to your hovercart`, "#10b981");
    }
    return true;
  }

  /**
   * Brief world-space confirmation text. It holds still for 900 ms before floating up and
   * fading over 900 ms, since it spawns where the player is least likely to be looking.
   * @param {number} x - px
   * @param {number} y - px
   * @param {string} text
   * @param {string} color - CSS color
   */
  showFloatingText(x, y, text, color) {
    this.debugInfo?.record("game-message", { x, y, text, color });
    const scale = this.getPopupScale(x, y);
    const label = this.add
      .text(x, y, text, {
        fontFamily: '"Courier New", monospace',
        fontSize: "18px",
        fontStyle: "bold",
        color,
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(9999)
      .setScale(scale);

    this.tweens.add({
      targets: label,
      y: y - 36 * scale,
      alpha: 0,
      duration: 900,
      delay: 900,
      ease: "Cubic.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  // --- Fixture sprites ---

  /**
   * Creates a solid, clickable fixture sprite.
   * @param {object} fixture
   * @param {string} textureKey
   */
  drawFixture(fixture, textureKey) {
    const width = fixture.gridDimensions.w * TILE_SIZE;
    const height = fixture.gridDimensions.h * TILE_SIZE;
    let image;
    if (fixture.type === "locker_single") {
      fixture.lockerAnimation = new AnimatedDoor(this, {
        x: fixture.x, y: fixture.y, sprite: getSingleLockerSprite(fixtureRotation(fixture)),
      });
      image = fixture.lockerAnimation.sprite.setOrigin(0.5, 0.5);
      sizeSingleLocker(image, fixtureRotation(fixture));
    } else {
      image = this.add.image(fixture.x, fixture.y, textureKey).setDisplaySize(width, height);
    }
    image.setDepth(2);
    this.obstacleGroup.add(image); // solid -- customers walk up to it, not through it
    fixture.sprite = image;
    image.setInteractive({ useHandCursor: true });
    image.on("pointerdown", (pointer) => {
      if (pointer.event?.target === this.game.canvas) this.tryOpenFixtureWindow(fixture);
    });
    if (fixture instanceof StorageFixture) {
      fixture.capacityLabel = this.add.text(0, 0, "", {
        fontFamily: "Courier New, monospace",
        fontSize: "13px",
        fontStyle: "bold",
        color: "#ffffff",
        backgroundColor: "#111827",
        padding: { x: 3, y: 2 },
      }).setOrigin(0.5, fixture.type === "locker_single" ? 1 : 0).setDepth(3);
      this.refreshLockerCapacityDisplay(fixture);
    }
  }

  // Item name, then "x5 (10)": crate quantity and the locker spaces it fills (same units as "7/20").
  refreshCarriedCrateLabel() {
    const label = this.carriedCrateLabel;
    const crate = this.carriedCrate;
    if (!label) return;
    if (!crate) {
      if (label.visible) label.setVisible(false);
      return;
    }
    let text;
    if (crate.kind === "fixture") {
      text = `${getFixtureType(crate.typeId).name} fixture`;
    } else {
      const item = database.getItem(crate.itemId);
      const spaces = crate.quantity * (item?.slots || 1);
      text = `${item.name}\nx${crate.quantity} (${spaces})` +
        (this.getCarriedCrates().length > 1 ? `\n${this.getCarriedCrates().length} crates stacked` : "");
    }
    if (label.text !== text) label.setText(text);
    const bounds = crate.sprite.getBounds();
    label.setScale(this.getPopupScale(bounds.centerX, bounds.centerY));
    let x = bounds.centerX;
    const view = this.cameraAt(bounds.centerX, bounds.centerY)?.worldView;
    if (view && label.displayWidth) {
      // Keep the whole label on screen near the room's edges.
      const half = label.displayWidth / 2 + 2;
      x = Math.min(Math.max(x, view.x + half), view.right - half);
    }
    label.setPosition(x, bounds.top - 2).setDepth(crate.sprite.depth + 1).setVisible(true);
  }

  refreshGoBacksBadge() {
    const count = this.playerState.goBacks.stock.reduce((sum, entry) => sum + entry.quantity, 0);
    this.goBacksBadge.setVisible(count > 0);
    this.positionGoBacksBadge();
  }

  positionGoBacksBadge() {
    if (!this.goBacksBadge?.visible || !this.player?.sprite) return;
    const bounds = this.player.sprite.getBounds();
    this.goBacksBadge.setScale(this.getPopupScale()).setPosition(bounds.centerX, bounds.top - 2);
  }

  refreshLockerCapacityDisplay(fixture) {
    const text = `${fixture.usedCapacity()}/${fixture.capacity}`;
    if (fixture.capacityLabel.text !== text) fixture.capacityLabel.setText(text);
    const bounds = fixture.sprite.getBounds();
    if (fixture.type === "locker_single") {
      const footprint = fixtureFootprint(fixture);
      fixture.capacityLabel.setPosition(fixture.x, fixture.y - footprint.h * TILE_SIZE / 2 - 2);
      return;
    }
    fixture.capacityLabel.setPosition(bounds.centerX, bounds.top + 4);
  }

  updateLockerAnimation(fixture, delta) {
    if (!fixture.lockerAnimation) return;
    const fixtureWindow = this.fixtureWindow;
    fixture.lockerAnimation.update(delta, fixtureWindow.uiWindow.isOpen && fixtureWindow.fixture === fixture);
  }

  /**
   * The register is drawn smaller than its footprint and solid only to the player and crates.
   * @param {object} fixture
   */
  drawRegister(fixture) {
    const sprite = this.add
      .image(fixture.x, fixture.y, getFixtureType(fixture.type).texture)
      .setDisplaySize(REGISTER_WIDTH, REGISTER_HEIGHT)
      .setDepth(2)
      .setInteractive({ useHandCursor: true });
    sprite.on("pointerdown", (pointer) => {
      if (pointer.event?.target === this.game.canvas) this.openRegisterWindow();
    });
    this.registerGroup.add(sprite); // see registerGroup in create()
    fixture.sprite = sprite;
  }

  // --- Register ---

  // Clicking the register or pressing E nearby always puts the player behind the counter,
  // customer or not; only the scan window needs someone at the front of the line. A
  // customer who arrives later opens it automatically (see handleJoinQueue).
  openRegisterWindow() {
    if (!this.controlMode.allows("interact")) return;
    if (!this.isPlayerNearRegister()) return;

    this.beginRegisterSession(); // no-ops if already in one

    const frontCustomer = this.registerLine[0];
    if (frontCustomer) this.startCheckout(frontCustomer); // re-renders/refocuses if already open
  }

  resumeRegisterCheckout() {
    if (!this.operatingRegister || !this.controlMode.allows("interact")) return;
    const customer = this.registerLine[0];
    if (!customer) return;
    this.startCheckout(customer); // resumes the sale if it's this customer's
  }

  // Q at the register. The bin belongs to the register, so you have to be standing there.
  openGoBacksBin() {
    if (!this.controlMode.allows("goBacks")) return;
    if (!this.interactables.findTarget("goBacks", this.getInteractionOrigin())) return;
    this.goBacksWindow.open();
  }

  // Shown above the register, or above a backroom door, whenever the player is in range of it.
  updateRegisterPrompt() {
    const mode = this.controlMode.getMode();
    const door = (mode === CONTROL_MODES.WALKING || mode === CONTROL_MODES.CARRYING) && this.getNearbyBackroomDoor();
    if (door) {
      const key = controlLabel("interact");
      const text = this.playerInBackroom ? `Press ${key} to return to the shop` : `Press ${key} to enter the Backroom`;
      if (this.registerPrompt.text !== text) this.registerPrompt.setText(text);
      this.registerPrompt.setVisible(true).setScale(this.getPopupScale(door.x, door.y));
      // Keep the hint fully inside whatever view the player is in (the backroom window is narrow).
      const view = (this.playerInBackroom ? this.backroomCamera : this.cameras.main).worldView;
      const half = this.registerPrompt.displayWidth / 2 + 4;
      const x = view.width > half * 2 ? Phaser.Math.Clamp(door.x, view.x + half, view.right - half) : view.centerX;
      // On the door itself: above it is off the map (and outside the backroom window).
      this.registerPrompt.setPosition(x, door.y + TILE_SIZE / 2 - 4);
      return;
    }
    const target = this.interactables.findTarget("register", this.getInteractionOrigin());
    const show = Boolean(target) && mode === CONTROL_MODES.WALKING;
    this.registerPrompt.setVisible(show);
    if (!show) return;
    const text = target.hint;
    if (this.registerPrompt.text !== text) this.registerPrompt.setText(text);
    const bounds = target.target.sprite.getBounds();
    this.registerPrompt.setScale(this.getPopupScale()).setPosition(bounds.centerX, bounds.top - 6);
  }

  /**
   * An employee ringing up the front customer holds their patience. The player's own
   * checkout doesn't: the first scan resets patience once (see CheckoutWindow.onFirstScan).
   * @param {Customer} customer
   */
  isServingCustomer(customer) {
    return this.employees.some((employee) =>
        employee.state === "SERVING_REGISTER" &&
        employee.currentJob?.customer === customer &&
        this.registerLine[0] === customer,
      );
  }

  /**
   * An angry customer's cart goes to the Go-Backs bin, and the line moves up.
   * @param {Customer} customer
   * @param {Array<object>} cart
   */
  handleAngryLeave(customer, cart) {
    this.debugInfo?.record("customer-left-angry", {
      customerId: this.debugInfo.identifyCustomer(customer), cart,
    });
    this.playerState.addToGoBacks(cart);
    const wasFront = this.registerLine[0] === customer;
    this.registerLine = this.registerLine.filter((candidate) => candidate !== customer);
    this.layoutRegisterLine();
    if (!wasFront) return;
    // Also drops a sale the player stepped away from, so it can't be resumed later.
    this.checkoutWindow.close();
    if (this.operatingRegister && this.registerLine[0]) this.startCheckout(this.registerLine[0]);
  }

  // Measured to the nearest edge of the register graphic, so it works from any side and
  // follows the register wherever it's placed. Always true while already behind the counter.
  isPlayerNearRegister() {
    if (this.operatingRegister) return true;
    return Boolean(this.interactables.findTarget("register", this.getInteractionOrigin()));
  }

  // Hold the player at the validated rear access point until they leave the counter.
  beginRegisterSession() {
    if (this.operatingRegister) return;

    this.employees.forEach((employee) => employee.cancelRegisterJob());
    this.operatingRegister = true;
    this.playerPositionBeforeRegister = { x: this.player.sprite.x, y: this.player.sprite.y };
    const register = this.fixtures.register();
    const behind = this.getBehindRegisterPoint();
    // From above, the player stands tucked behind the counter, partly hidden by it.
    if (fixtureFacingStep(register, true).dy < 0) {
      behind.y += PLAYER_CHARACTER_HEIGHT * REGISTER_ABOVE_LOWER_FRACTION;
      this.playerDepthBeforeRegister = this.player.sprite.depth;
      this.player.sprite.setDepth(register.sprite.depth - 0.01);
    } else if (fixtureFacingStep(register, true).dy > 0) {
      // From below, the player stands slightly over the front of the counter.
      behind.y -= PLAYER_CHARACTER_HEIGHT * REGISTER_BELOW_RAISE_FRACTION;
    }
    this.player.teleportTo(behind.x, behind.y);
    this.player.forceFacing(fixtureFacing(register));
    this.player.inputEnabled = false;
    this.player.sprite.body.enable = false;
    this.eventBus.emit(GAME_EVENTS.REGISTER_SESSION_STARTED, {
      registerId: this.fixtures.register()?.id ?? null,
    });
  }

  // Returns the player to where they stood before beginRegisterSession(). Only called when
  // the player leaves on purpose (E again), not when the checkout window closes because
  // the line ran out.
  endRegisterSession() {
    if (!this.operatingRegister) return;

    this.operatingRegister = false;
    // The scan UI can't be operated from wherever the player is teleported back to. The
    // sale is set aside, not thrown away, so coming back can't re-roll it.
    if (this.checkoutWindow.mode === "checkout") this.checkoutWindow.suspend();
    this.goBacksWindow.uiWindow.close();
    this.player.sprite.body.enable = true;
    this.player.inputEnabled = true;
    if (this.playerDepthBeforeRegister != null) {
      this.player.sprite.setDepth(this.playerDepthBeforeRegister);
      this.playerDepthBeforeRegister = null;
    }
    this.player.teleportTo(
      this.playerPositionBeforeRegister.x,
      this.playerPositionBeforeRegister.y,
    );
    this.playerPositionBeforeRegister = null;
    this.eventBus.emit(GAME_EVENTS.REGISTER_SESSION_ENDED, {
      registerId: this.fixtures.register()?.id ?? null,
    });
  }

  // --- Customer arrivals ---

  // Fixes the shift's customer pool and arrival times from the store as it stands now.
  prepareCustomerSchedule() {
    this.customerPool = this.calculateCustomerPool();
    this.customerPoolAtShiftStart = this.customerPool;
    this.customerArrivalSchedule = createCustomerArrivalSchedule(
      this.customerPool.customerFactionIds,
      SHIFT_DURATION_MS,
    );
    this.nextScheduledArrival = 0;
    this.poolRefreshCooldownMs = 0;
  }

  calculateCustomerPool() {
    const shelfPlacements = this.fixtures.shelves().flatMap((shelf) =>
      shelf.placements.map((placement) => ({ ...placement })),
    );
    return createCustomerPool({
      storeReputation: this.playerState.globalReputation,
      factionReputation: this.playerState.factionReputation,
      activeFactions: this.playerState.activeFactions,
      shelfPlacements,
      getItem: (itemId) => database.getItem(itemId),
      employeeCount: this.playerState.getWorkingEmployees().length,
      tieBreakOffset: this.market.day,
    });
  }

  /**
   * Once per 1000 ms of play, adds late arrivals if restocking mid-shift grew the pool.
   * The pool never shrinks mid-shift.
   * @param {number} delta - ms since last frame
   */
  refreshCustomerPool(delta) {
    if (!this.shiftClock.started || this.shiftClock.softClosed ||
      this.storeTemporarilyClosed || !this.customerPool) return;
    this.poolRefreshCooldownMs -= delta;
    if (this.poolRefreshCooldownMs > 0) return;
    this.poolRefreshCooldownMs = 1000;

    const result = growCustomerArrivalSchedule({
      schedule: this.customerArrivalSchedule,
      currentPool: this.customerPool,
      nextPool: this.calculateCustomerPool(),
      elapsedMs: this.shiftClock.getElapsedMs(),
      shiftDurationMs: SHIFT_DURATION_MS,
    });
    if (result.addedFactionIds.length === 0) return;
    this.customerPool = result.pool;
    this.customerArrivalSchedule = result.schedule;
    this.debugInfo?.record("customer-pool-grew", {
      added: result.addedFactionIds.length,
      totalCustomers: result.pool.totalCustomers,
      shelfStockUnits: result.pool.calculation.shelfStockUnits,
    });
  }

  spawnScheduledCustomers() {
    if (!this.shiftClock.started || this.shiftClock.softClosed ||
      this.storeTemporarilyClosed || !this.customerArrivalSchedule) return;

    const elapsedMs = this.shiftClock.getElapsedMs();
    while (
      this.nextScheduledArrival < this.customerArrivalSchedule.length &&
      this.customerArrivalSchedule[this.nextScheduledArrival].atMs <= elapsedMs
    ) {
      const { factionId } = this.customerArrivalSchedule[this.nextScheduledArrival];
      this.nextScheduledArrival += 1;
      this.spawnCustomer(factionId);
    }
  }

  /**
   * Lets one customer in unless arrivals are closed or the store is full.
   * @param {string | null} factionId
   */
  spawnCustomer(factionId = null) {
    if (this.storeTemporarilyClosed || this.shiftClock.softClosed) return;
    if (this.customers.length >= MAX_CUSTOMERS_IN_STORE) {
      this.playerState.customersTurnedAway += 1;
      this.debugInfo?.record("customer-turned-away", { factionId, reason: "store-at-capacity" });
      return;
    }

    const customer = new Customer({
      scene: this,
      factionId,
      getShoppingPlan: (factionId, traits) => this.createCustomerShoppingPlan(factionId, traits),
      getStoreConditions: () => this.getCustomerTraitConditions(),
      registerPoint: this.registerQueueAnchor,
      exitPoint: this.exitPoint,
      onReserveShelfSlot: (shelf, arrivingCustomer) =>
        this.reserveShelfSlot(shelf, arrivingCustomer),
      onReserveQueueSlot: () => this.reserveQueueSlot(),
      onReserveExitSlot: () => this.reserveExitSlot(),
      playerState: this.playerState,
      spawnBounds: this.customerSpawnBounds,
      onJoinQueue: (arrivingCustomer) => this.handleJoinQueue(arrivingCustomer),
      onLeaveAngry: (angryCustomer, cart) => {
        this.eventBus.emit(GAME_EVENTS.CUSTOMER_LEFT_ANGRY, {
          customer: angryCustomer,
          cart,
        });
      },
      onMissingPrimary: (customer, itemIds, itemNames) => {
        this.eventBus.emit(GAME_EVENTS.CUSTOMER_MISSING_PRIMARY, { customer, itemIds, itemNames });
      },
      onComplete: (completedCustomer) => {
        this.debugInfo?.recordCustomer("customer-exited", completedCustomer);
        this.customers = this.customers.filter(
          (candidate) => candidate !== completedCustomer,
        );
      },
    });
    this.customerGroup.add(customer.sprite);
    this.customers.push(customer);
    this.storeDoorAnimation.letIn(customer.sprite);
    this.debugInfo?.recordCustomer("customer-entered", customer);
  }

  toggleTemporaryStoreClosure() {
    if (!this.shiftClock.started || this.shiftClock.softClosed) return false;

    if (this.storeTemporarilyClosed) {
      const closedDuration = Math.max(
        0,
        this.shiftClock.getElapsedMs() - this.storeTemporarilyClosedSinceMs,
      );
      this.customerArrivalSchedule = this.customerArrivalSchedule.map((arrival, index) =>
        index < this.nextScheduledArrival
          ? arrival
          : { ...arrival, atMs: arrival.atMs + closedDuration });
      this.storeTemporarilyClosed = false;
      this.storeTemporarilyClosedSinceMs = null;
      this.hud.renderStoreStatus(false);
      this.showGameMessage("Store reopened. Customer arrivals have resumed.", "#38bdf8");
    } else {
      this.storeTemporarilyClosed = true;
      this.storeTemporarilyClosedSinceMs = this.shiftClock.getElapsedMs();
      this.hud.renderStoreStatus(true);
      this.showGameMessage(
        "Store temporarily closed. Customers inside can finish shopping; new arrivals are paused.",
        "#f59e0b",
      );
    }
    return true;
  }

  // What trait appearance conditions (CustomerTraits.js) can check about the store.
  getCustomerTraitConditions() {
    const shelves = this.fixtures.shelves();
    const itemIds = new Set(shelves.flatMap((shelf) =>
      shelf.placements.map((placement) => placement.itemId),
    ));
    return { shelfCount: shelves.length, itemVariety: itemIds.size };
  }

  /**
   * A buy list from what's on the shelves, plus the shelves worth visiting for it.
   * @param {string | null} factionId
   * @param {string[]} [traits]
   */
  createCustomerShoppingPlan(factionId, traits = []) {
    const shelves = this.fixtures.shelves();
    const shelfItemIds = shelves.flatMap((shelf) =>
      shelf.placements.map((placement) => placement.itemId),
    );
    const buyList = createCustomerBuyList(
      factionId,
      shelfItemIds,
      (itemId) => database.getItem(itemId),
    );
    buyList.bonusItemIds = addDiscountBonusItem(
      buyList,
      shelfItemIds,
      (itemId) => this.getStorePrice(itemId) <=
        this.market.getPrice(itemId) * BARGAIN_PRICE_RATIO,
    );
    buyList.bonusItemIds = addTraitBonusItems(buyList, shelfItemIds, traits);
    const targetIds = new Set([
      ...buyList.primaryItemIds,
      ...buyList.bonusItemIds,
      ...Object.values(buyList.matchingAmmoIdsByFirearm).flat(),
    ]);
    const shelfStops = shelves.map((fixture) => ({ fixture, standPoint: fixture.standPoint })).filter(({ fixture }) =>
      fixture.placements.some((placement) => targetIds.has(placement.itemId)),
    );
    const allShelfStops = shelves.filter((fixture) => fixture.findAvailableSlot())
      .map((fixture) => ({ fixture, standPoint: fixture.standPoint }));
    return {
      ...buyList,
      itemQuantities: createCustomerItemQuantities([...targetIds]),
      shelfStops,
      allShelfStops,
    };
  }

  getItem(itemId) {
    return database.getItem(itemId);
  }

  // --- Register queue and checkout ---

  /**
   * Only the front customer's cart shows in the checkout window; the rest wait single-file
   * with patience bubbles (see Customer.updatePatience).
   * @param {Customer} customer
   */
  handleJoinQueue(customer) {
    this.debugInfo?.recordCustomer("customer-joined-queue", customer);
    this.registerLine.push(customer);
    this.layoutRegisterLine();

    if (this.registerLine.length === 1) {
      this.startCheckout(customer);
    }
  }

  // A distinct queue waypoint for a customer heading to the register, so two walkers never
  // aim at the same pixel; layoutRegisterLine fixes final spots on arrival. Derived fresh
  // from live customer states rather than a counter, so a customer who gives up can't
  // leak a reservation. The caller is still SEEK_SHELF, so it isn't counted.
  reserveQueueSlot() {
    const inFlight = this.customers.filter((c) => c.state === "SEEK_REGISTER").length;
    const index = this.registerLine.length + inFlight;
    return this.registerQueuePoints[Math.min(index, this.registerQueuePoints.length - 1)];
  }

  /**
   * Spreads shoppers heading to the same shelf across its clear front cells.
   * @param {ShelfFixture} shelf
   * @param {Customer | null} arrivingCustomer - excluded from the count
   * @returns {{ x: number, y: number }} world-space waypoint
   */
  reserveShelfSlot(shelf, arrivingCustomer = null) {
    const inFlight = this.customers.filter((c) =>
      c !== arrivingCustomer && (c.state === "SEEK_SHELF" || c.state === "BROWSING") &&
      c.fixture === shelf,
    ).length;
    const cells = fixtureAccessCells(shelf);
    return fixtureStandingSpot(shelf, cells[inFlight % cells.length]);
  }

  reserveExitSlot() {
    const occupied = new Set(this.customers
      .filter((customer) => customer.state === "LEAVING" && customer.destination)
      .map((customer) => `${customer.destination.x},${customer.destination.y}`));
    const offset = CUSTOMER_EXIT_SLOT_OFFSETS.find(({ dx, dy }) =>
      !occupied.has(`${this.exitPoint.x + dx},${this.exitPoint.y + dy}`),
    );
    if (!offset) throw new Error("No unoccupied customer exit slot is available.");
    return { x: this.exitPoint.x + offset.dx, y: this.exitPoint.y + offset.dy };
  }

  // Queue cells remain reachable even when the register is moved near other fixtures.
  layoutRegisterLine() {
    this.registerLine.forEach((customer, index) => {
      const point = this.registerQueuePoints[index];
      customer.setQueueTarget(point.x, point.y);
    });
  }

  /**
   * Opens checkout for this customer if the player is at the register, stepping them
   * behind the counter if needed; otherwise does nothing until openRegisterWindow retries.
   * Each finished sale moves the line up and serves the next customer.
   * @param {Customer} customer
   */
  startCheckout(customer) {
    if (!this.controlMode.allows("interact")) return;
    if (!this.isPlayerNearRegister()) return;
    this.beginRegisterSession();

    // Stepping away mid-sale and coming back picks up exactly where it was left.
    if (this.checkoutWindow.isCheckingOut(customer.cart)) {
      this.checkoutWindow.resume();
      return;
    }
    // Decided once per customer, so restarting the sale can't change how they pay.
    customer.checkoutPayment ??= chooseCustomerPayment(customer.factionId);

    this.checkoutWindow.openForCustomer(customer.cart, () => {
      const total = customer.completeSale();
      this.eventBus.emit(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, { customer, total });
      this.registerLine.shift();
      this.layoutRegisterLine(); // shuffle everyone else forward one spot

      const nextCustomer = this.registerLine[0];
      nextCustomer?.resetPatience(); // any sale resets the next in line's patience
      if (nextCustomer) {
        this.startCheckout(nextCustomer);
      } else {
        // Nothing left to scan: the belt closes, but the player stays at the counter.
        this.checkoutWindow.close();
      }
    }, {
      cash: ["cash", "m-scrips"].includes(customer.checkoutPayment.type),
      exact: customer.checkoutPayment.exact,
      currency: customer.checkoutPayment.type === "m-scrips" ? "m-scrips" : "credits",
      paymentType: customer.checkoutPayment.type,
      chitCode: customer.checkoutPayment.code,
      onWrongChange: () => this.playerState.subReputation(1),
    });
  }

  completeEmployeeCheckout(employee, customer) {
    if (this.operatingRegister || this.registerLine[0] !== customer ||
      employee.currentJob?.customer !== customer) return false;
    if (this.checkoutWindow.isCheckingOut(customer.cart)) this.checkoutWindow.close();
    const total = customer.completeSale();
    this.eventBus.emit(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, { customer, total });
    this.showFloatingText(
      employee.sprite.x,
      employee.sprite.y - 40,
      `Sale completed: ${formatMoney(total)}`,
      "#10b981",
    );
    this.registerLine.shift();
    this.layoutRegisterLine();
    this.registerLine[0]?.resetPatience();
    return true;
  }

  // --- Frame update and shift flow ---

  update(time, delta) {
    this.handleGamepad(time, delta);
    this.fixturePlacement.update();
    for (const crate of this.restockCrates) crate.updateThrow(delta);
    this.separateStuckCrates();
    // The front door opens for the player and for customers on their way out (arrivals
    // hold it open themselves); the backroom door for the player standing at it.
    this.storeDoorAnimation.update(delta, [
      this.player?.sprite,
      ...this.customers.map((customer) =>
        !customer.isDestroyed && customer.state === "LEAVING" ? customer.sprite : null),
    ]);
    const nearBackroomDoor = Boolean(this.getNearbyBackroomDoor());
    this.backroomDoorAnimation.update(delta, !this.playerInBackroom && nearBackroomDoor);
    this.backroomExitAnimation.update(delta, this.playerInBackroom && nearBackroomDoor);
    // Pausing a started shift freezes time entirely: customers and arrivals included.
    // Before the shift starts the clock also reads as paused, but the player moves freely.
    const mode = this.controlMode.getMode();
    const movementFrozen = (this.shiftClock.isPaused && this.shiftClock.started) ||
      mode === CONTROL_MODES.PLACING || mode === CONTROL_MODES.LOADING;

    if (movementFrozen) {
      // Skipping customer update() also freezes their state-machine timers, not just movement.
      this.player.sprite.body.setVelocity(0, 0);
      this.player.forceFacing(this.player.currentFacing);
      this.customers.forEach((customer) => customer.standStill());
      this.employees.forEach((employee) => employee.standStill());
      for (const crate of this.restockCrates) if (crate.isPushed) crate.stopPush();
    } else {
      this.player.update(delta);
      this.updateCratePushing(delta);
      this.syncCarriedCrate();
      this.customers.forEach((customer) => customer.update(delta));
      this.employees.forEach((employee) => employee.update(delta));
    }
    this.hud.renderStamina(this.player);

    this.shiftClock.update(delta);
    this.updateRegisterPrompt();
    this.positionGoBacksBadge();
    this.updateCrateHint();
    for (const fixture of this.fixtures.stockHolders()) {
      this.updateLockerAnimation(fixture, delta);
      if (fixture.capacityLabel) this.refreshLockerCapacityDisplay(fixture);
    }
    this.refreshCarriedCrateLabel();
    this.refreshCustomerPool(delta);
    this.spawnScheduledCustomers();

    // Soft close: once the store stops admitting customers, the shift ends only after
    // everyone already inside has left.
    if (this.shiftClock.softClosed) {
      this.employees.forEach((employee) => employee.requestClockOut());
    }
    if (this.shiftClock.softClosed && this.customers.length === 0 &&
      this.employees.every((employee) => employee.isReadyToClockOut()) && !this.shiftEnded) {
      this.endShift();
    }
  }

  // The shift ends quietly once the doors are locked and the last customer is gone. The
  // day stays open (prices, calendar) until the player clicks End Day in Finances.
  endShift() {
    const previousLevel = this.playerState.shopLevel;
    this.clearEmployees();
    this.shiftEnded = true;
    this.shiftClock.started = false;
    this.shiftClock.isPaused = true;
    this.shiftClock.notifyListeners();
    this.storeTemporarilyClosed = false;
    this.storeTemporarilyClosedSinceMs = null;
    this.hud.renderStoreStatus(false);
    this.playerState.finishShift({
      customersServed: this.customersServedThisShift,
      customersTurnedAway: this.playerState.customersTurnedAway,
    });
    this.eventBus.emit(GAME_EVENTS.SHIFT_ENDED, {
      served: this.customersServedThisShift,
      turnedAway: this.playerState.customersTurnedAway,
      reputation: this.playerState.globalReputation,
      factionReputation: this.playerState.factionReputation,
    });
    let levelMessage = "";
    if (this.playerState.shopLevel > previousLevel) {
      const newContracts = database.getAllLicenses().filter((license) =>
        license.requiredShopLevel > previousLevel &&
        license.requiredShopLevel <= this.playerState.shopLevel &&
        !this.playerState.activeLicenses.has(license.id) &&
        license.isUnlocked(this.playerState));
      const staffLimitRaised = STAFF_LIMIT_LEVELS.some((level) =>
        level > previousLevel && level <= this.playerState.shopLevel);
      const newSalesExpansions = this.room.zones.filter((zone) =>
        zone.requiredShopLevel > previousLevel &&
        zone.requiredShopLevel <= this.playerState.shopLevel &&
        zone.locked && zone.salesFloor);
      const newBackroomExpansions = this.room.zones.filter((zone) =>
        zone.requiredShopLevel > previousLevel &&
        zone.requiredShopLevel <= this.playerState.shopLevel &&
        zone.locked && zone.backroom);
      levelMessage = ` Shop Level ${this.playerState.shopLevel} reached!`;
      if (newContracts.length) {
        levelMessage += ` Contracts unlocked: ${newContracts.map((license) => license.name).join(", ")} (Contracts tab).`;
      }
      if (staffLimitRaised) {
        const limit = getStaffLimit(this.playerState.shopLevel);
        levelMessage += ` You can now have ${limit} employee${limit === 1 ? "" : "s"} hired at once (Employee tab).`;
      }
      if (newSalesExpansions.length) {
        levelMessage += ` Sales-floor expansion${newSalesExpansions.length > 1 ? "s" : ""} available to buy in the Layout tab.`;
      }
      if (newBackroomExpansions.length) {
        levelMessage += ` Backroom expansion${newBackroomExpansions.length > 1 ? "s" : ""} available to buy in the Layout tab.`;
      }
      const newHovercartUpgrades = HOVERCART_UPGRADES.filter((upgrade) =>
        upgrade.requiredShopLevel > previousLevel &&
        upgrade.requiredShopLevel <= this.playerState.shopLevel &&
        upgrade.capacity > this.playerState.hovercart.capacity);
      if (newHovercartUpgrades.length) {
        levelMessage += ` Hovercart upgrade to ${newHovercartUpgrades.map((upgrade) => upgrade.capacity).join(", ")} spaces available in the Equipment tab.`;
      }
      if (hasUnimplementedShopRewardBetween(previousLevel, this.playerState.shopLevel)) {
        levelMessage += " Some later level rewards are not in the game yet.";
      }
    }
    this.showShiftClosingSequence();
    if (levelMessage) this.showGameMessage(levelMessage, "#10b981");
  }

  showShiftClosingSequence() {
    if (typeof document === "undefined") return;
    this.shiftClosingOverlay?.remove();
    const overlay = document.createElement("div");
    overlay.className = "shift-closing-overlay";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");

    const panel = document.createElement("div");
    panel.className = "shift-closing-panel";
    const title = document.createElement("div");
    title.className = "shift-closing-title";
    title.textContent = "SHOP CLOSED";
    const summary = document.createElement("div");
    summary.className = "shift-closing-summary";
    summary.textContent = `Customers served: ${this.customersServedThisShift} · Turned away: ${this.playerState.customersTurnedAway}`;
    const hint = document.createElement("div");
    hint.className = "shift-closing-hint";
    hint.textContent = "Select END DAY to review today's receipt.";

    panel.append(title, summary, hint);
    overlay.append(panel);
    overlay.addEventListener("animationend", (event) => {
      if (event.target !== overlay) return;
      overlay.remove();
      if (this.shiftClosingOverlay === overlay) this.shiftClosingOverlay = null;
    }, { once: true });
    document.getElementById("game-container").append(overlay);
    this.shiftClosingOverlay = overlay;
  }

  /**
   * Adds a sold cart to today's receipt, one line per item.
   * @param {{ itemId: string, price: number }[]} cart
   */
  recordSale(cart) {
    const sold = new Map();
    for (const { itemId, price } of cart) {
      const line = sold.get(itemId) ?? { amount: 0, quantity: 0 };
      line.amount = sumMoney([line.amount, price]);
      line.quantity += 1;
      sold.set(itemId, line);
    }
    for (const [itemId, { amount, quantity }] of sold) {
      this.playerState.addCredits(amount, {
        category: "sales",
        label: database.getItem(itemId).name,
        quantity,
      });
    }
  }

  openFinances() {
    this.managerTablet.openWindow();
    if (this.managerTablet.uiWindow.isOpen) this.managerTablet.switchTab("finances");
  }

  canEndDay() {
    return this.playerState.awaitingEndDay && !this.startingShift &&
      !this.fixturePlacement.active && this.canSaveOffShift();
  }

  // Closes today's receipt, moves the calendar on, and changes market prices (bible Steps 43
  // and 52). Prices only move here, so repricing between shifts is stress-free.
  endDay() {
    if (!this.canEndDay()) return false;
    this.market.advanceDay();
    this.playerState.endDay(this.market.day);
    if (this.getEmergencyLoanOffer().available) {
      this.showGameMessage(
        `Day ${this.market.day} begins. You have nothing left to sell and can't afford a supply order. Open Finances to take an emergency loan.`,
        "#f59e0b",
      );
      return true;
    }
    this.showGameMessage(`Day ${this.market.day} begins. Market prices have changed.`, "#10b981");
    return true;
  }

  /**
   * The loan is only offered when the shop is stuck: nothing left to sell anywhere and not
   * enough credits for the cheapest one-crate supply order.
   */
  getEmergencyLoanOffer() {
    const shiftRunning = this.shiftClock.started && !this.shiftEnded;
    const ownsSellableStock = this.getInventoryItems()
      .some(({ storage, stock, inCustomerCarts }) => storage + stock + inCustomerCarts > 0);
    const crateCosts = this.getRestockableItems().map(({ cost }) => cost);
    return getEmergencyLoanOffer({
      credits: this.playerState.credits,
      hasLoan: !!this.playerState.emergencyLoan,
      shiftRunning,
      ownsSellableStock,
      cheapestOrderCost: crateCosts.length ? Math.min(...crateCosts) + DELIVERY_FEE : null,
    });
  }

  takeEmergencyLoan() {
    const offer = this.getEmergencyLoanOffer();
    if (!offer.available) return false;
    this.playerState.takeEmergencyLoan(offer.amount, offer.repayTotal);
    this.showGameMessage(
      `Emergency loan received: ${formatMoney(offer.amount)}. You owe ${formatMoney(offer.repayTotal)}, paid back from your sales.`,
      "#f59e0b",
    );
    this.requestAutosave();
    return true;
  }

  payOffEmergencyLoan() {
    if (!this.playerState.payOffEmergencyLoan()) return false;
    this.showGameMessage("Emergency loan paid off.", "#10b981");
    this.requestAutosave();
    return true;
  }

  // Today's running receipt and the last finished one, for the Finances tab.
  getFinancesView() {
    const state = this.playerState;
    const last = state.lastDayReceipt;
    const shiftRunning = this.shiftClock.started && !this.shiftEnded;
    return {
      day: this.market.day,
      shiftRunning,
      emergencyLoan: {
        offer: this.getEmergencyLoanOffer(),
        balance: state.emergencyLoan?.balance ?? 0,
        canPayOff: !!state.emergencyLoan && state.credits >= state.emergencyLoan.balance,
      },
      pendingReputationChange: shiftRunning ? state.pendingReputation.global : null,
      awaitingEndDay: state.awaitingEndDay,
      canEndDay: this.canEndDay(),
      today: summarizeReceipt(state.dayLedger.serialize(), state.credits, state.globalReputation),
      lastDay: last ? summarizeReceipt(last, last.closingCredits, last.closingReputation) : null,
    };
  }

  // Saves a checkpoint first; if that save fails, the shift doesn't start.
  async startNextShift() {
    if (this.startingShift || this.loadFailed || !this.canSaveOffShift()) return;
    if (this.playerState.awaitingEndDay) {
      this.showShopMessage("End the day first: click END DAY at the top.");
      return;
    }
    if (this.fixturePlacement.active) {
      this.showShopMessage("Finish or cancel fixture placement before starting the shift.");
      return;
    }
    this.startingShift = true;
    this.fixtureWindow.uiWindow.close();
    this.managerTablet.uiWindow.close();
    this.player.sprite.body.stop();
    try {
      await this.saveOffShift();
    } catch (error) {
      this.startingShift = false;
      this.handlePersistenceError(error);
      return;
    }
    this.prepareCustomerSchedule();
    this.storeTemporarilyClosed = false;
    this.storeTemporarilyClosedSinceMs = null;
    this.hud.renderStoreStatus(false);
    const wages = this.payEmployeeWages();
    if (wages > 0) {
      this.showGameMessage(`Employee wages paid: ${wages} credits.`, "#f59e0b");
    }
    this.creditsAtShiftStart = this.playerState.credits;
    this.reputationAtShiftStart = this.playerState.globalReputation;
    this.shiftClock.startNewShift();
    this.shiftEnded = false;
    this.startingShift = false;
    this.spawnHiredEmployees();
    this.setSaveStatus("Checkpoint saved. Autosaving resumes after this shift.");
    this.customersServedThisShift = 0;
    this.playerState.customersTurnedAway = 0;
    this.eventBus.emit(GAME_EVENTS.SHIFT_STARTED, { pool: this.customerPool });
    this.managerTablet.refreshLayoutPanels();
    this.managerTablet.refreshEmployeePanel();
  }
}
