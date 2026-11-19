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
import { ShelfFixture } from "../logic/ShelfFixture.js";
import { Customer, SPRITE_DISPLAY_WIDTH, SPRITE_DISPLAY_HEIGHT } from "../logic/Customer.js";
import { Employee } from "../logic/Employee.js";
import { getEmployeeTrainingOffer } from "../logic/EmployeeTraining.js";
import {
  addDiscountBonusItem, BARGAIN_PRICE_RATIO, createCustomerBuyList, createCustomerItemQuantities,
} from "../logic/CustomerBuyLists.js";
import { formatMoneyAmount, formatTransactionTotal, isMoney, roundMoney } from "../logic/Money.js";
import { addTraitBonusItems, CUSTOMER_TRAITS } from "../logic/CustomerTraits.js";
import {
  createCustomerArrivalSchedule,
  growCustomerArrivalSchedule,
  createCustomerPool,
  getLicensedFactionIds,
} from "../logic/CustomerPooling.js";
import { Player, PLAYER_CHARACTER_HEIGHT, PLAYER_CRATE_HOLD_OFFSET } from "../logic/Player.js";
import { Crate, CRATE_STACK_SPACING } from "../logic/Crate.js";
import { getItemCrateTint } from "../logic/CrateCategory.js";
import {
  FLOOR_STACK_MAX, HOLD_KEY_MS, MAX_CARRIED_CRATES, isInFacingCone, isSquarelyInFront,
} from "../logic/CrateStack.js";
import { getCrateItemLimit } from "../logic/ShelfSlotStocking.js";
import { CRATE_FOOTER_HEIGHT_PX, CrateFooter } from "../logic/CrateFooter.js";
import { getCrateOrderQuantity } from "../logic/SupplyOrder.js";
import { findCratePushRival, solveCratePush } from "../logic/CratePushing.js";
import { separateOverlappingCrates } from "../logic/CrateSeparation.js";
import { CheckoutWindow } from "../logic/CheckoutWindow.js";
import { chooseCustomerPayment } from "../logic/CustomerPayment.js";
import { TileRoom } from "../logic/TileRoom.js";
import { SlidingDoor } from "../logic/SlidingDoor.js";
import {
  TILE_SIZE, getZone, getAuthoredGridSize, getStoreDoorCell, getStoreDoorCells, EXPANSION_ORDER,
  BACKROOM_UPGRADE_ORDER, getBackroomDoorCell, getBackroomExitCell, getBackroomLink,
  getBackroomInteriorBounds, getBackroomBounds, getLoadingPadBounds, getDoorwayClearanceBounds, LOADING_PAD_WIDTH, LOADING_PAD_HEIGHT,
} from "../logic/RoomLayout.js";
import { ShiftClock, SHIFT_DURATION_MS } from "../logic/ShiftClock.js";
import { findFreeWalkPath } from "../logic/Pathfinder.js";
import { FixturePlacement } from "../logic/FixturePlacement.js";
import { worldToClientRect } from "../logic/FixtureHighlight.js";
import { getGameScale } from "../logic/GameViewport.js";
import { setupSandboxRoom } from "../debug/SandboxRoom.js";
import { setupUiLab } from "../debug/UiLab.js";
import { ShelfAttentionHighlight } from "../logic/ShelfAttentionHighlight.js";
import { ShelfFacingLight } from "../logic/ShelfFacingLight.js";
import { ShelfItemDisplay } from "../logic/ShelfItemDisplay.js";
import { ShelfStockingWindow } from "../logic/ShelfStockingWindow.js";
import { getFixtureTexture, hasFacingTextures } from "../logic/FixtureTexture.js";
import { STARTING_FIXTURES, FIXTURE_TYPES, REGISTER_FRONT_OVERLAP, getFixtureType, getFixtureResaleValue, getShelfDisplayGrid, fixtureAccessCells, fixtureArtInset, fixtureFacing, fixtureFacingStep, fixtureFootprint, fixtureInteractionDistance, fixtureRotation, fixtureStandingSpot, validateFixtureLayout } from "../logic/FixtureLayout.js";
import { FixtureRegistry } from "../logic/FixtureRegistry.js";
import { SHOP_LAYOUT_VERSION, validateShopSave } from "../logic/ShopSave.js";
import { TrashField, randomTrashKind } from "../logic/TrashField.js";
import {
  UPSET_REPUTATION_LOSS, WALK_OUT_REPUTATION_LOSS, getCleanlinessMax, getCleanlinessScore,
} from "../logic/Litter.js";
import { UIWindow } from "../logic/UIWindow.js";
import { Messages, SHOP_MESSAGE_COLOR } from "../world/Messages.js";
import { ShiftSystem } from "../systems/ShiftSystem.js";
import { AREA, Areas, areaAt, areaAtRow } from "../world/Areas.js";
import { SupplySystem } from "../systems/SupplySystem.js";
import { GamepadInput, PAD } from "../logic/GamepadInput.js";
import { UINavigator } from "../logic/UINavigator.js";
import { controlLabel, getInputDevice, setInputDevice } from "../logic/InputDevice.js";
import { SaveManager } from "../../SaveManager.js";
import { database } from "./boot.js"; // the exported DatabaseManager singleton
import { installSceneTextSize } from "../logic/GameTextSize.js";
import { gameRandom, randomSeed } from "../core/Random.js";

// Most customers inside the store at once. When full, the next arrival is lost for good,
// so a backed-up dealer really does lose that sale.
const MAX_CUSTOMERS_IN_STORE = 6;
// Spread around the doorway's center; kept within the one-cell doorway, low enough that
// no one's head rises above the top of the door opening.
const CUSTOMER_EXIT_SLOT_OFFSETS = Object.freeze([
  [-8, -4],
  [0, -4],
  [8, -4],
  [-8, 4],
  [0, 4],
  [8, 4],
].map(([dx, dy]) => Object.freeze({ dx, dy })));
// How far below the doorway cell's center a customer's feet must be for their head to stay
// under the top of the door opening (opening top is 24px above center, heads ~42px tall,
// tallest art reaches 50px).
const DOORWAY_FEET_OFFSET = 30;

function reputationPenaltyText(penalty, factionId) {
  const faction = factionId ? CUSTOMER_TRAITS[factionId] : null;
  if (factionId && !faction?.group) throw new Error(`Unknown customer faction: ${factionId}.`);
  return `-${penalty} store reputation${faction ? `\n-${penalty} ${faction.name} reputation` : ""}\nat shift end`;
}

// How far from a trashcan's edge (in pixels) the player can still use it.
const TRASHCAN_REACH = 40;
// Loose trash is picked up from this far ahead of the player's feet (px), within the reach.
const TRASH_PICKUP_AHEAD = 22;
const TRASH_PICKUP_REACH = 26;

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

// Screen space kept clear when fitting the map: the top status bar (36px + 2px border),
// the bottom crate bar (#crate-footer, 96px), and a small margin around the map.
const MAP_SCREEN_TOP = 38;
const MAP_SCREEN_BOTTOM = CRATE_FOOTER_HEIGHT_PX;
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
// Customers only consider crates this close (px) when shoving through.
const CUSTOMER_PUSH_REACH = 160;
// A customer held back by a crate that won't move this long (ms) squeezes past it for a moment.
const CUSTOMER_CRATE_STUCK_MS = 1000;
const CUSTOMER_CRATE_SQUEEZE_MS = 1500;
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
// Extra drop (share of the player's height) when standing behind a register from above.
const REGISTER_ABOVE_LOWER_FRACTION = 0.3;
const REGISTER_BELOW_RAISE_FRACTION = 0.65;
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
    this.recalculateActiveFactions();
    this.shiftClock = new ShiftClock();
    this.customerArrivalSchedule = [];
    this.nextScheduledArrival = 0;
    this.customerPool = null;
    this.customerPoolAtShiftStart = null;
    this.poolRefreshCooldownMs = 0;
    this.storeTemporarilyClosed = false;
    this.storeTemporarilyClosedSinceMs = null;
    this.hud = new HUDController(
      this.gameState,
      this.shiftClock,
      () => this.shift.start(),
      () => this.saveManually(),
      () => this.shift.endDay(),
      () => this.toggleTemporaryStoreClosure(),
      () => this.confirmReturnToMainMenu(),
    );

    this.windowManager = new WindowManager();
    this.shift = new ShiftSystem(this);

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

    this.areas = new Areas(this);
    this.setupBackroomWindow();
    // Every placed fixture lives in this registry.
    this.fixtures = new FixtureRegistry();
    // The register's body is solid to the player and crates only: customers queue almost
    // flush against its front edge, so it can't join obstacleGroup.
    this.registerGroup = this.physics.add.staticGroup();
    for (const entry of STARTING_FIXTURES) this.spawnFixture(entry);
    this.operatingRegister = false;
    this.playerPositionBeforeRegister = null;

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

    this.checkoutWindow = new CheckoutWindow(this.windowManager);
    this.checkoutWindow.onFirstScan = () => this.operatingLine()[0]?.resetPatience();
    this.checkoutWindow.getRegisterScreenArea = () => this.getRegisterScreenArea();
    this.shelfStockingWindow = new ShelfStockingWindow(this);
    // One customer line per register, keyed by fixture id; index 0 is being checked out.
    // Re-laid-out by layoutRegisterLine whenever a line changes so they queue single-file.
    this.registerLines = new Map();
    // The register the player is standing behind, while operatingRegister is true.
    this.operatingRegisterFixture = null;
    // That register's normal depth while it's lifted over the player tucked behind it.
    this.registerDepthBeforeTuck = null;

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
    // two floor rows against the backroom's bottom wall.
    const loadingPad = getLoadingPadBounds();
    this.supply = new SupplySystem(this, new Phaser.Geom.Rectangle(
      (loadingPad.left + loadingPad.right) / 2 - LOADING_PAD_WIDTH / 2,
      (loadingPad.top + loadingPad.bottom) / 2 - LOADING_PAD_HEIGHT / 2,
      LOADING_PAD_WIDTH,
      LOADING_PAD_HEIGHT,
    ));
    this.supply.drawPad();
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
      this.supply.padRect.centerX,
      this.supply.padRect.centerY,
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
    this.trash = new TrashField(this, (x, y) => this.isOpenTrashSpot(x, y));
    this.heldTrash = null;
    const initialLayout = this.fixtures.layout();
    const initialAccess = validateFixtureLayout(initialLayout, this.getLayoutOptions());
    if (!initialAccess.valid) throw new Error(initialAccess.reason);
    this.applyFixtureLayout(initialLayout, initialAccess);
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
      this.handleAngryLeave(customer, cart);
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
    this.bindControlKey("keydown-PAGE_UP", "cameraZoom", () => this.zoomCamera(1));
    this.bindControlKey("keydown-PAGE_DOWN", "cameraZoom", () => this.zoomCamera(-1));

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
      if (pad.justPressed(PAD.B) && this.operatingRegister) this.endRegisterSession();
    }
    if (pad.justPressed(PAD.LB)) this.handleUnusedMenuButton(PAD.LB);
    if (pad.justPressed(PAD.RB)) this.handleUnusedMenuButton(PAD.RB);
  }

  // Buttons the open screen had no use for, e.g. B or Y while ringing up a customer.
  handleUnusedMenuButton(button) {
    if (button === PAD.B && this.operatingRegister) this.endRegisterSession();
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
    const viewH = Math.max(1, this.scale.height - MAP_SCREEN_TOP - MAP_SCREEN_BOTTOM);
    if (this.cameraZoom && this.cameraViewHeight) this.cameraZoom *= viewH / this.cameraViewHeight;
    this.refreshCamera();
  }

  getCameraZoomRange() {
    const viewW = Math.max(1, this.scale.width);
    const viewH = Math.max(1, this.scale.height - MAP_SCREEN_TOP - MAP_SCREEN_BOTTOM);
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
    if (backroom?.visible && Number.isFinite(worldY) && areaAt(worldY) === AREA.BACKROOM) {
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
    const viewH = Math.max(1, this.scale.height - MAP_SCREEN_TOP - MAP_SCREEN_BOTTOM);
    // The map is drawn only between the top status bar and the bottom crate bar.
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
    if (this.player?.sprite && this.areas.playerArea !== AREA.BACKROOM) {
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
    const open = this.areas.playerArea === AREA.BACKROOM;
    camera.setVisible(open);
    this.backroomFrame?.classList.toggle("hidden", !open);
    if (!open) return;

    const screenW = Math.max(1, this.scale.width);
    const screenH = Math.max(1, this.scale.height - MAP_SCREEN_TOP - MAP_SCREEN_BOTTOM);
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
    const border = BACKROOM_FRAME_BORDER;
    Object.assign(frame.style, {
      left: `${x - border}px`,
      top: `${y - BACKROOM_TITLE_HEIGHT - border}px`,
      width: `${width}px`,
      height: `${height + BACKROOM_TITLE_HEIGHT}px`,
      borderWidth: `${border}px`,
    });
  }

  syncCarriedCrate() {
    this.player.updateCarryPose?.();
    const crates = this.getCarriedCrates();
    crates.forEach((crate, index) => crate.followCarrier?.(this.player.sprite, index, PLAYER_CRATE_HOLD_OFFSET));
    this.syncHeldTrash();
  }

  // Held trash sits at his hand on the side he faces; facing away, his body hides it.
  syncHeldTrash() {
    const sprite = this.heldTrash?.sprite;
    if (!sprite) return;
    const player = this.player.sprite;
    const facing = this.player.currentFacing;
    const side = { left: -14, right: 14, down: 12, up: -12 }[facing] ?? 12;
    sprite.setPosition(player.x + side, player.y - 4);
    sprite.setDepth(player.depth + (facing === "up" ? -0.5 : 0.5));
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

  // --- Fixture layout ---

  /**
   * Builds a fixture model and its sprite, then registers it. Shelves start
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
        handsOn: spec.artLayout === "budget",
        placements: [],
      });
    } else {
      fixture = { ...base };
    }
    Object.assign(fixture, { type, gx, gy, rotation });
    if (spec.kind === "register") this.drawRegister(fixture);
    else this.drawFixture(fixture, getFixtureTexture(spec));
    this.orientFixtureSprite(fixture);
    if (fixture instanceof ShelfFixture) {
      fixture.stockDisplay = new ShelfAttentionHighlight(this, fixture);
      if (spec.artLayout === "budget") fixture.facingLight = new ShelfFacingLight(this, fixture);
      fixture.stockItemsDisplay = new ShelfItemDisplay(this, fixture, (itemId) => database.getItem(itemId));
      fixture.stockDisplay.sync();
    }
    return this.fixtures.add(fixture);
  }

  /**
   * Turns the sprite to the fixture's rotation and fits its body box to the turned
   * footprint. Phaser's own refit ignores rotation, so the box is set by hand.
   * @param {object} fixture
   */
  orientFixtureSprite(fixture) {
    const { sprite, x, y } = fixture;
    const rotation = fixtureRotation(fixture);
    const spec = getFixtureType(fixture.type);
    // Art drawn for each facing is swapped in upright; other art is spun to face its way.
    const facingArt = hasFacingTextures(spec);
    if (facingArt) {
      sprite.setTexture(getFixtureTexture(spec, rotation));
      this.sizeFacingArt(sprite, spec, rotation);
    }
    sprite.setPosition(x, y).setAngle(facingArt ? 0 : rotation * 90);
    const footprint = fixtureFootprint(fixture);
    const inset = fixtureArtInset(fixture);
    const width = (footprint.w - inset.left - inset.right) * TILE_SIZE;
    const height = (footprint.h - inset.top - inset.bottom) * TILE_SIZE;
    const centerX = x + (inset.left - inset.right) * TILE_SIZE / 2;
    const centerY = y + (inset.top - inset.bottom) * TILE_SIZE / 2;
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
    const footprint = fixtureFootprint({ type: spec.id, rotation });
    sprite.setDisplaySize(footprint.w * TILE_SIZE, footprint.h * TILE_SIZE);
  }

  despawnAllFixtures() {
    for (const fixture of this.fixtures.clear()) {
      fixture.stockDisplay?.destroy();
      fixture.facingLight?.destroy();
      fixture.stockItemsDisplay?.destroy();
      fixture.sprite.destroy();
    }
  }

  /**
   * Options for validateFixtureLayout: walkability, the entrance, door thresholds, and
   * approach spaces used when checking shelf fronts and the checkout line.
   * @param {Array<{ left: number, right: number, top: number, bottom: number }>} occupiedRectangles - bodies a fixture must not land on (px)
   */
  getLayoutOptions(occupiedRectangles = []) {
    const entrance = getStoreDoorCell();
    const link = getBackroomLink();
    const backroomDoor = getBackroomDoorCell();
    const backroomExit = getBackroomExitCell();
    const doorwayCells = new Set([
      ...getStoreDoorCells().map(({ gx, gy }) => `${gx},${gy}`),
      `${backroomDoor.gx},${backroomDoor.gy}`,
      `${backroomExit.gx},${backroomExit.gy}`,
    ]);
    const reservedCells = new Set([
      ...doorwayCells,
      ...getStoreDoorCells().map(({ gx, gy }) => `${gx},${gy + 1}`),
      `${link.shop.gx},${link.shop.gy}`,
      `${link.backroom.gx},${link.backroom.gy}`,
    ]);
    return {
      isWalkable: (gx, gy) => this.room.isWalkable(gx, gy),
      // Door art counts as a doorway, not wall a fixture can tuck into.
      isWall: (gx, gy) => {
        const wall = this.room.wallCells.get(`${gx},${gy}`);
        return Boolean(wall && !wall.door);
      },
      entrance, reservedCells, doorwayCells, fixtureReservedCells: doorwayCells, occupiedRectangles,
      links: [[link.shop, link.backroom]],
      backroomBounds: getBackroomInteriorBounds(this.room.zones),
      reservedRectangles: [getLoadingPadBounds()],
      doorwayClearanceRectangles: getDoorwayClearanceBounds(),
    };
  }

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

  canRearrangeFixtures() {
    if (this.loadFailed || this.shift.starting ||
      (this.shiftClock.started && this.shiftClock.isPaused)) return false;
    return this.canSaveOffShift() ||
      (this.shiftClock.started && (this.storeTemporarilyClosed || this.shiftClock.softClosed));
  }

  canExpandStore() {
    return this.canSaveOffShift() && !this.shift.starting;
  }

  // Fixtures can only be moved from the same room the player is standing in.
  getFixtureMoveAreaBlockReason(fixture) {
    if (!fixture) return null;
    const area = areaAtRow(Math.floor(fixture.gy));
    if (area === this.areas.playerArea) return null;
    const name = this.fixtures.displayName(fixture);
    return area === AREA.BACKROOM
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
        levelMet: this.gameState.reputation.shopLevel >= zone.requiredShopLevel,
        canAfford: this.gameState.economy.credits >= zone.cost,
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
        levelMet: this.gameState.reputation.shopLevel >= zone.requiredShopLevel,
        canAfford: this.gameState.economy.credits >= zone.cost,
      };
    });
  }

  buyExpansion(zoneId) {
    if (!EXPANSION_ORDER.includes(zoneId)) {
      throw new Error(`Unknown sales-floor expansion: ${zoneId}`);
    }
    if (!this.canExpandStore()) {
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
    if (this.gameState.reputation.shopLevel < zone.requiredShopLevel) {
      this.showShopMessage(
        `Reach Shop Level ${zone.requiredShopLevel} to buy ${zone.name}.`,
      );
      return false;
    }
    if (this.gameState.economy.credits < zone.cost) {
      this.showShopMessage(`${zone.name} costs ${formatMoneyAmount(zone.cost)}.`);
      return false;
    }

    this.gameState.economy.spend(zone.cost, { category: "expansions", label: zone.name });
    this.room.unlockZone(zoneId);
    this.refreshCamera();
    this.gameState.shop.changed();
    this.requestAutosave();
    this.showShopMessage(`${zone.name} is open.`);
    return true;
  }

  buyBackroomUpgrade(zoneId) {
    if (!BACKROOM_UPGRADE_ORDER.includes(zoneId)) {
      throw new Error(`Unknown backroom expansion: ${zoneId}`);
    }
    if (!this.canExpandStore()) {
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
    if (this.gameState.reputation.shopLevel < zone.requiredShopLevel) {
      this.showShopMessage(
        `Reach Shop Level ${zone.requiredShopLevel} to buy ${zone.name}.`,
      );
      return false;
    }
    if (this.gameState.economy.credits < zone.cost) {
      this.showShopMessage(`${zone.name} costs ${formatMoneyAmount(zone.cost)}.`);
      return false;
    }

    this.gameState.economy.spend(zone.cost, { category: "expansions", label: zone.name });
    this.room.unlockZone(zoneId);
    this.refreshCamera();
    this.gameState.shop.changed();
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
  checkFixtureMove(id, gx, gy, rotation, connectivityCache = null) {
    const areaBlock = this.getFixtureMoveAreaBlockReason(this.fixtures.get(id));
    if (areaBlock) return { valid: false, reason: areaBlock };
    if (areaAtRow(Math.floor(gy)) !== this.areas.playerArea) {
      return { valid: false, reason: this.areas.playerArea === AREA.BACKROOM ? "Keep it in the backroom." : "Keep it on the sales floor." };
    }
    const bodies = [this.player.sprite.body, ...this.restockCrates.map((crate) => crate.sprite.body)];
    return validateFixtureLayout(this.layoutWithMove(id, gx, gy, rotation), { ...this.getLayoutOptions(
      bodies.filter((body) => body.enable).map((body) => ({
        left: body.left, right: body.right, top: body.top, bottom: body.bottom,
      })),
    ), connectivityCache });
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
    this.gameState.shop.changed();
    return true;
  }

  /**
   * Moves and turns every fixture sprite to its layout cell and adopts the validated access
   * points and register queue positions.
   * @param {Array<{ id: string, gx: number, gy: number, rotation?: number }>} layout
   * @param {object} result - a valid result from validateFixtureLayout for this layout
   */
  applyFixtureLayout(layout, result) {
    for (const entry of layout) {
      const fixture = this.fixtures.get(entry.id);
      fixture.gx = entry.gx;
      fixture.gy = entry.gy;
      fixture.rotation = entry.rotation ?? 0;
      const footprint = fixtureFootprint(fixture);
      fixture.x = (entry.gx + footprint.w / 2) * TILE_SIZE;
      fixture.y = (entry.gy + footprint.h / 2) * TILE_SIZE;
      this.orientFixtureSprite(fixture);
      fixture.accessCells = result.accessCells?.get(entry.id) ?? fixtureAccessCells(fixture);
      fixture.standPoint = fixtureStandingSpot(fixture, result.access.get(entry.id));
    }
    for (const fixture of this.fixtures.all()) {
      fixture.stockDisplay?.setPosition(fixture.x, fixture.y);
      fixture.stockDisplay?.setAngle(fixtureRotation(fixture) * 90);
      fixture.stockItemsDisplay?.setPosition(fixture.x, fixture.y);
      fixture.stockItemsDisplay?.setAngle(fixtureRotation(fixture) * 90);
    }
    // Each register carries its own validated customer-line positions.
    for (const register of this.fixtures.registers()) {
      register.queuePoints = result.queuePointsById?.get(register.id) ?? result.queuePoints;
    }
    if (this.goBacksBadge) this.refreshGoBacksBadge();
    this.trash?.moveOffBlockedSpots();
  }

  // Just past the body box's rear edge, excluding transparent picture margins.
  getBehindRegisterPoint(register = this.operatingRegisterFixture ?? this.fixtures.register()) {
    const bounds = register.sprite.body;
    const { dx, dy } = fixtureFacingStep(register, true);
    const player = this.player.sprite;
    const reachX = bounds.width / 2 + player.displayWidth / 2 - REGISTER_BEHIND_OVERLAP;
    const reachY = bounds.height / 2 + player.displayHeight / 2 - REGISTER_BEHIND_OVERLAP;
    return { x: bounds.center.x + dx * reachX, y: bounds.center.y + dy * reachY };
  }

  // --- Saving and loading ---

  serialize() {
    const snapshot = {
      ...this.gameState.toSave(),
      fixtures: this.fixtures.all().map((fixture) => {
        const entry = { id: fixture.id, type: fixture.type, gx: fixture.gx, gy: fixture.gy, rotation: fixtureRotation(fixture) };
        if (fixture instanceof ShelfFixture) {
          const placements = fixture.placements.map((stack) => ({ ...stack }));
          return { ...entry, placements, ...(fixture.handsOn ? { stockingVersion: 1 } : {}) };
        }
        return entry;
      }),
      unlockedZones: this.room.zones.filter((zone) => !zone.locked).map((zone) => zone.id),
      layoutVersion: SHOP_LAYOUT_VERSION,
      crates: this.restockCrates.map((crate) => {
        const above = this.floorStacks.get(crate) ?? [];
        return above.length
          ? { ...crate.serialize(), stack: above.map((stacked) => stacked.serializePayload()) }
          : crate.serialize();
      }),
      carriedCrate: this.carriedCrate ? {
        ...this.carriedCrate.serializePayload(),
      } : null,
      carriedCrates: this.getCarriedCrates().map((crate) => crate.serializePayload()),
      ...(this.trash ? { trash: this.serializeTrash() } : {}),
    };
    return validateShopSave(snapshot, database);
  }

  // Trash in hand is saved as lying on the shop floor where he stands (or by the backroom door).
  serializeTrash() {
    const trash = this.trash.serialize();
    if (this.heldTrash) {
      const spot = this.areas.playerArea === AREA.BACKROOM
        ? this.areas.arrivalIn(AREA.SHOP)
        : { x: this.player.sprite.x, y: this.player.sprite.body?.bottom ?? this.player.sprite.y };
      trash.push({ kind: this.heldTrash.kind, x: spot.x, y: spot.y });
    }
    return trash;
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
    // Saves from before the sales-floor rule still load; the misplaced fixture can then be moved out.
    const result = validateFixtureLayout(data.fixtures, { ...this.getLayoutOptions(), requireSalesFloor: false });
    if (!result.valid) throw new Error(`Invalid saved layout: ${result.reason}`);
    this.gameState.replaceWith(next, () => this.rebuildShopFromSave(data, result));
    this.shift.resetStartingTotals();
    this.setupCamera();
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
    this.despawnAllFixtures();
    for (const entry of data.fixtures) {
      const fixture = this.spawnFixture(entry);
      if (fixture instanceof ShelfFixture) fixture.placements = entry.placements.map((stack) => ({ ...stack }));
    }
    this.applyFixtureLayout(data.fixtures, layout);
    this.areas.playerArea = AREA.SHOP;
    this.player.teleportTo(this.storeDoor.x, this.storeDoor.y + TILE_SIZE);
    this.refreshCamera();
    for (const crate of this.getFloorCrates()) crate.destroy();
    this.floorStacks = new Map();
    this.markedStackBase = null;
    this.cratePress = null;
    this.restockCrates = data.crates.map((entry) => {
      const crate = entry.kind === "fixture"
        ? new Crate(this, entry.itemId, entry.quantity, entry.x, entry.y, { kind: "fixture", typeId: entry.typeId })
        : this.createItemCrate(entry.itemId, entry.quantity, entry.x, entry.y);
      crate.applySave(entry);
      // Older saves have no onPad flag: anything resting on the pad was a delivery.
      const onPad = entry.onPad ?? this.supply.padRect.contains(entry.x, entry.y);
      if (onPad) crate.lockToPad();
      if (entry.stack?.length) {
        this.floorStacks.set(crate, entry.stack.map((stacked) => {
          const above = this.createItemCrate(stacked.itemId, stacked.quantity, entry.x, entry.y);
          above.pickUp(crate.sprite);
          return above;
        }));
      }
      return crate;
    });
    this.syncFloorStacks();
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
    this.heldTrash?.sprite.destroy();
    this.heldTrash = null;
    this.trash?.load(data.trash ?? []);
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

  // --- Buying, crating, and placing fixtures ---

  // Fixture shop rows, with every reason a purchase might be blocked.
  getFixturePurchaseOptions() {
    return Object.values(FIXTURE_TYPES).map((spec) => {
      const license = database.getLicense(spec.licenseId);
      const licensed = this.gameState.catalog.owns(spec.licenseId);
      const hasDeliverySpace = !!this.supply.firstFreePadSpot();
      return {
        spec,
        license,
        licensed,
        canAfford: this.gameState.economy.credits >= spec.price,
        hasDeliverySpace,
      };
    });
  }

  /**
   * Buys a fixture, delivered as a crate on the Loading Pad.
   * @param {string} typeId
   * @returns {boolean} whether the purchase went through
   */
  buyFixture(typeId) {
    const spec = getFixtureType(typeId);
    if (!spec) throw new Error(`Unknown fixture type: ${typeId}`);
    if (!this.gameState.catalog.owns(spec.licenseId)) return false;
    if (this.gameState.economy.credits < spec.price) return false;
    const spawn = this.supply.takePadSpots(1)[0];
    if (!spawn) return false;

    this.gameState.economy.spend(spec.price, { category: "fixtures", label: spec.name });
    this.supply.deliver(new Crate(this, null, 1, spawn.x, spawn.y, { kind: "fixture", typeId }));
    this.supply.freePlayerFromPad();
    this.gameState.shop.changed();
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
    if (fixture instanceof ShelfFixture && fixture.placements.some((stack) => stack.quantity > 0)) {
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
    if (this.shelfStockingWindow?.fixture === fixture) this.shelfStockingWindow.uiWindow.close();
    fixture.stockDisplay?.destroy();
    fixture.facingLight?.destroy();
    fixture.stockItemsDisplay?.destroy();
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
    this.gameState.shop.changed();
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
    this.gameState.economy.add(value, { category: "fixture_sales", label: spec.name });
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
    this.gameState.economy.add(value, { category: "fixture_sales", label: spec.name });
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
  checkFixturePlacement(typeId, gx, gy, rotation = 0, connectivityCache = null) {
    const id = this.fixtures.nextId(typeId);
    const layout = [...this.fixtures.layout(), { id, type: typeId, gx, gy, rotation }];
    const bodies = [this.player.sprite.body, ...this.restockCrates.map((crate) => crate.sprite.body)];
    return validateFixtureLayout(layout, { ...this.getLayoutOptions(
      bodies.filter((body) => body.enable).map((body) => ({
        left: body.left, right: body.right, top: body.top, bottom: body.bottom,
      })),
    ), connectivityCache });
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
    this.gameState.shop.changed();
    return true;
  }

  // --- Player interaction and crates ---

  /**
   * The fixture holding Ctrl (or holding A on a controller) would pick up to move: the one
   * you're facing, with empty hands, while the store is closed.
   */
  getHoldToMoveFixture() {
    if (!this.controlMode.allows("interact") || this.getCarriedCrates().length > 0 || this.heldTrash) return null;
    if (this.operatingRegister || this.areas.nearbyPortal()) return null;
    const target = this.interactables?.findTarget("interact", this.getInteractionOrigin());
    let fixture = null;
    if (target?.kind === "fixture" && this.isPlayerFacingFixture(target.target)) fixture = target.target;
    // The register is in reach only while you face it, from any side.
    else if (target?.kind === "register") fixture = target.target;
    if (!fixture) {
      const trashcan = this.getNearbyTrashcan();
      if (trashcan && this.isPlayerFacingFixture(trashcan)) fixture = trashcan;
    }
    if (!fixture || !this.canRearrangeFixtures()) return null;
    return this.getFixtureMoveAreaBlockReason(fixture) ? null : fixture;
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
    if (this.operatingRegister) {
      this.endRegisterSession();
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
    return Boolean(this.getNearbyTrashcan());
  }

  // The trashcan the player faces, with its edge a few steps ahead, or null. Standing
  // beside a trashcan while facing something else never counts.
  getNearbyTrashcan() {
    if (this.areas.playerArea === AREA.BACKROOM) return null;
    const step = {
      up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
    }[this.player.currentFacing];
    if (!step) return null;
    const { x, y } = this.player.sprite;
    const probe = { x: x + step.x * TRASHCAN_REACH, y: y + step.y * TRASHCAN_REACH };
    return this.fixtures.ofKind("trash").find((fixture) => {
      const { w, h } = fixtureFootprint(fixture);
      const left = fixture.gx * TILE_SIZE;
      const top = fixture.gy * TILE_SIZE;
      return probe.x >= left - 6 && probe.x <= left + w * TILE_SIZE + 6 &&
        probe.y >= top - 6 && probe.y <= top + h * TILE_SIZE + 6;
    }) ?? null;
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
    this.gameState.shop.changed();
    this.showGameMessage(empties.length === 1
      ? "Empty crate put in the trashcan."
      : `${empties.length} empty crates put in the trashcan.`, "#10b981");
    return true;
  }

  // --- Trash and cleanliness (documentation/modules/Cleaning.md) ---

  // Where loose trash may lie: open sales floor that no wall or fixture covers.
  isOpenTrashSpot(x, y) {
    const gx = Math.floor(x / TILE_SIZE);
    const gy = Math.floor(y / TILE_SIZE);
    const zone = this.room.zones.find((candidate) => gx >= candidate.gridX && gx < candidate.gridX + candidate.gridW &&
      gy >= candidate.gridY && gy < candidate.gridY + candidate.gridH);
    if (!zone?.salesFloor || zone.locked || !this.room.isWalkable(gx, gy)) return false;
    const margin = 8;
    return !this.fixtures.all().some((fixture) => {
      const { w, h } = fixtureFootprint(fixture);
      return x >= fixture.gx * TILE_SIZE - margin && x <= (fixture.gx + w) * TILE_SIZE + margin &&
        y >= fixture.gy * TILE_SIZE - margin && y <= (fixture.gy + h) * TILE_SIZE + margin;
    });
  }

  /**
   * A customer drops a piece of trash at their feet, if that spot is open shop floor.
   * @returns {boolean} whether it was dropped
   */
  dropTrash(x, y) {
    if (!this.isOpenTrashSpot(x, y)) return false;
    this.trash.add(randomTrashKind(), x, y);
    return true;
  }

  // The trash just ahead of his feet, the way he faces.
  findTrashInFront() {
    if (!this.trash || this.areas.playerArea === AREA.BACKROOM || this.operatingRegister) return null;
    const step = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[this.player.currentFacing];
    if (!step) return null;
    const { center } = this.player.sprite.body;
    return this.trash.findNear({ x: center.x + step[0] * TRASH_PICKUP_AHEAD, y: center.y + step[1] * TRASH_PICKUP_AHEAD },
      TRASH_PICKUP_REACH);
  }

  pickUpTrash(piece) {
    if (!this.trash.take(piece)) return false;
    this.heldTrash = piece;
    this.syncHeldTrash();
    return true;
  }

  throwAwayHeldTrash() {
    if (!this.heldTrash) return false;
    this.heldTrash.sprite.destroy();
    this.heldTrash = null;
    this.showGameMessage("Trash thrown away. The store is cleaner.", "#10b981");
    return true;
  }

  // Q with trash in hand: it goes back on the floor just ahead of him, or at his feet.
  dropHeldTrash() {
    const piece = this.heldTrash;
    if (!piece) return false;
    const { center, bottom } = this.player.sprite.body;
    const step = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[this.player.currentFacing] ?? [0, 0];
    const spots = [
      { x: center.x + step[0] * TRASH_PICKUP_AHEAD, y: bottom + step[1] * TRASH_PICKUP_AHEAD },
      { x: center.x, y: bottom },
    ];
    const spot = spots.find(({ x, y }) => this.isOpenTrashSpot(x, y));
    if (!spot) {
      this.showGameMessage(this.areas.playerArea === AREA.BACKROOM
        ? "Trash can only be dropped out on the shop floor."
        : "No room to drop the trash here.", "#94a3b8");
      return false;
    }
    this.heldTrash = null;
    this.trash.place(piece, spot.x, spot.y);
    return true;
  }

  // Trash in hand still counts against the store until it's in a trashcan.
  getCleanliness() {
    const salesExpansions = EXPANSION_ORDER.filter((id) =>
      this.room.zones.some((zone) => zone.id === id && !zone.locked)).length;
    const max = getCleanlinessMax({ salesExpansions, shopLevel: this.gameState.reputation.shopLevel });
    const trashCount = this.trash.count + (this.heldTrash ? 1 : 0);
    return { score: getCleanlinessScore(max, trashCount), max, trashCount };
  }

  getCleanlinessPercent() {
    const { score, max } = this.getCleanliness();
    return (score / max) * 100;
  }

  /**
   * A customer found the store too dirty: store reputation only, never their faction's.
   * @param {Customer} customer
   * @param {"upset" | "walk-out"} verdict
   */
  reportCleanlinessVerdict(customer, verdict) {
    const walkOut = verdict === "walk-out";
    const penalty = walkOut ? WALK_OUT_REPUTATION_LOSS : UPSET_REPUTATION_LOSS;
    this.gameState.reputation.lose(penalty);
    this.showFloatingText(
      customer.sprite.x,
      customer.sprite.y - 50,
      `${walkOut ? "Too dirty! Leaving." : "This store is dirty."}\n${reputationPenaltyText(penalty, null)}`,
      walkOut ? "#ef4444" : "#f59e0b",
    );
    this.debugInfo?.recordCustomer(walkOut ? "customer-left-dirty-store" : "customer-upset-dirty-store", customer);
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
    this.gameState.shop.changed();
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
    return [...this.restockCrates, ...[...this.floorStacks.values()].flat()];
  }

  /**
   * The closest floor crate within half a floor square of the player, in a wide cone around
   * the way he faces, so distant stacks don't take over the put-down action.
   * @param {{ moving?: boolean }} [options] - moving: find a crate still flying or rolling instead
   * @returns {Crate | null}
   */
  findCrateInFront({ moving = false } = {}) {
    const { center } = this.player.sprite.body;
    let best = null;
    let bestDistance = TILE_SIZE / 2;
    for (const crate of this.restockCrates) {
      if (crate.canPickUp() === moving) continue;
      if (!isInFacingCone(center, crate.sprite, this.player.currentFacing)) continue;
      if (!moving && !isSquarelyInFront(this.player.sprite.body, crate.getFloorBounds(),
        this.player.currentFacing)) continue;
      const { left, right, top, bottom } = crate.sprite.getBounds();
      const dx = Math.max(left - center.x, 0, center.x - right);
      const dy = Math.max(top - center.y, 0, center.y - bottom);
      const distance = Math.hypot(dx, dy);
      if (distance <= bestDistance) {
        best = crate;
        bestDistance = distance;
      }
    }
    return best;
  }

  // The floor stack in reach (bottom crate first) and the crate its green arrow points at.
  // The arrow starts on the top crate whenever the player reaches a different stack.
  markedFloorStack() {
    const base = this.findCrateInFront();
    if (!base) {
      this.markedStackBase = null;
      return null;
    }
    const crates = [base, ...(this.floorStacks.get(base) ?? [])];
    if (base !== this.markedStackBase) {
      this.markedStackBase = base;
      this.markedFromTop = 0;
    }
    this.markedFromTop = Math.min(this.markedFromTop, crates.length - 1);
    return { base, crates, marked: crates[crates.length - 1 - this.markedFromTop] };
  }

  // Ctrl / right stick click: moves the green arrow one crate down the stack, looping back to
  // the top after the bottom.
  markNextCrateDown() {
    if (!this.controlMode.allows("crate") || this.operatingRegister) return;
    const stack = this.markedFloorStack();
    if (!stack || stack.crates.length < 2) return;
    this.markedFromTop = (this.markedFromTop + 1) % stack.crates.length;
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
    if (this.operatingRegister) {
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
    this.eventBus.emit(GAME_EVENTS.CRATE_PICKED_UP, {
      kind: crate.kind, itemId: crate.itemId, typeId: crate.typeId, quantity: crate.quantity,
    });
  }

  emitCrateDropped(crate, { x, y }, thrown) {
    this.eventBus.emit(GAME_EVENTS.CRATE_DROPPED, {
      kind: crate.kind, itemId: crate.itemId, typeId: crate.typeId, quantity: crate.quantity, thrown, x, y,
    });
  }

  // Adds the marked crate to the top of what you're carrying, and with withAbove every crate
  // above it too. Without withAbove the floor stack closes the gap.
  pickUpFromStack({ base, crates, marked }, withAbove) {
    const lifted = withAbove ? crates.slice(crates.indexOf(marked)) : [marked];
    const above = this.floorStacks.get(base) ?? [];
    if (marked === base) {
      const { x, y } = base.sprite;
      if (!base.pickUp(this.player.sprite)) {
        this.showGameMessage("Wait for crate to stop", "#f59e0b");
        return false;
      }
      this.restockCrates = this.restockCrates.filter((crate) => crate !== base);
      this.floorStacks.delete(base);
      // The next crate up settles onto the floor in the bottom crate's place.
      const [newBase, ...rest] = withAbove ? [] : above;
      if (newBase) {
        newBase.drop(x, y, 0, 0, this.crateMotionPaused);
        this.restockCrates.push(newBase);
        if (rest.length) this.floorStacks.set(newBase, rest);
      }
    } else {
      const remaining = above.filter((crate) => !lifted.includes(crate));
      if (remaining.length) this.floorStacks.set(base, remaining);
      else this.floorStacks.delete(base);
    }
    for (const crate of lifted) this.addCarriedCrate(crate);
    this.markedStackBase = null;
    this.syncFloorStacks();
    this.gameState.shop.changed();
    for (const crate of lifted) this.emitCratePickedUp(crate);
    return true;
  }

  // Moves `count` crates from the top of what you're carrying onto the floor stack, keeping
  // their order; the rest stay in your hands.
  setCratesOnStack({ base }, count) {
    const stack = this.getCarriedCrates();
    const placed = stack.slice(-count);
    this.carriedCrates = stack.slice(0, -count);
    this.carriedCrate = this.carriedCrates.at(-1) ?? null;
    this.floorStacks.set(base, [...(this.floorStacks.get(base) ?? []), ...placed]);
    this.markedStackBase = null;
    this.syncCarriedCrate();
    this.syncFloorStacks();
    this.gameState.shop.changed();
    for (const crate of placed) this.emitCrateDropped(crate, base.sprite, false);
    return true;
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
    if (this.registerDepthBeforeTuck != null && this.player?.sprite) {
      this.operatingRegisterFixture?.sprite?.setDepth(this.player.sprite.depth + 0.5);
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

  /**
   * The player bumps into crates: loose resting crates get pushed (slowing the player),
   * loading pad crates act like walls. Crates still being launched by a throw are ignored.
   * A floor stack is as heavy as its height, and whatever the player carries adds to the load;
   * he can never move more than MAX_MOVED_CRATES in total.
   * @param {number} delta - ms since last frame
   */
  updateCratePushing(delta) {
    const body = this.player.sprite.body;
    const rectOf = (b) => ({ left: b.x, top: b.y, width: b.width, height: b.height });
    const holding = this.getCarriedCrates().length;
    const crates = this.restockCrates
      .filter((crate) => crate.lockedToPad || crate.isPushed || crate.isStationary() || crate.isSliding())
      .map((crate) => ({
        key: crate,
        rect: rectOf(crate.sprite.body),
        weight: 1 + (this.floorStacks.get(crate)?.length ?? 0),
        locked: crate.lockedToPad,
      }));
    const { playerVelocity, crateVelocities } = solveCratePush({
      player: rectOf(body),
      velocity: body.velocity,
      dt: Math.min(delta, 50) / 1000,
      crates,
      isBlocked: (rect) => this.isCrateSpaceBlocked(rect),
      carriedWeight: holding,
    });
    body.setVelocity(playerVelocity.x, playerVelocity.y);
    for (const crate of this.restockCrates) {
      const velocity = crateVelocities.get(crate);
      if (velocity && (velocity.x || velocity.y)) crate.push(velocity);
      else if (crate.isPushed) crate.stopPush();
    }
  }

  /**
   * A walking customer shoves loose crates out of their way, however heavy. Called right after
   * the customer picks this frame's velocity. If someone further from their destination is
   * already pushing the same crates, this customer gives way instead. A crate jammed so it
   * can't move would trap them, so after a second of that they squeeze past for a moment.
   * @param {import("../logic/Customer.js").Customer} customer
   * @param {number} delta - ms
   * @param {{ canPush?: boolean }} [options] - false while stepping aside: crates block instead
   */
  pushCratesForCustomer(customer, delta, { canPush = true } = {}) {
    const body = customer.sprite.body;
    if (!body) return;
    if (customer.crateSqueezeMs > 0) {
      customer.crateSqueezeMs -= delta;
      return;
    }
    const intended = { x: body.velocity.x, y: body.velocity.y };
    const intendedSpeed = Math.hypot(intended.x, intended.y);
    if (!intendedSpeed) {
      customer.crateStuckMs = 0;
      return;
    }
    const rectOf = (b) => ({ left: b.x, top: b.y, width: b.width, height: b.height });
    const center = body.center;
    const crates = this.restockCrates
      .filter((crate) => !crate.lockedToPad && crate.sprite.body?.enable &&
        (crate.isPushed || crate.isStationary() || crate.isSliding()) &&
        Math.hypot(crate.sprite.x - center.x, crate.sprite.y - center.y) < CUSTOMER_PUSH_REACH)
      .map((crate) => ({
        key: crate,
        rect: rectOf(crate.sprite.body),
        weight: 1 + (this.floorStacks.get(crate)?.length ?? 0),
        locked: false,
      }));
    if (!crates.length) {
      customer.crateStuckMs = 0;
      return;
    }
    const { playerVelocity, crateVelocities } = solveCratePush({
      player: rectOf(body),
      velocity: intended,
      dt: Math.min(delta, 50) / 1000,
      crates,
      isBlocked: (rect) => this.isCrateSpaceBlocked(rect),
      maxMoved: canPush ? Infinity : 0,
    });
    const moved = [...crateVelocities].filter(([, v]) => v.x || v.y);
    const distance = customer.remainingWalkDistance();
    const now = this.time.now;
    const rival = findCratePushRival({
      customer,
      distance,
      now,
      crates: moved.map(([crate]) => crate),
      isActive: (other) => !other.isDestroyed && !other.crateYield,
    });
    if (rival) {
      const crate = moved.find(([candidate]) => candidate.customerPushClaim === rival)[0];
      customer.giveWayToCratePush(this.stepAsideFrom(customer, crate, rival.velocity));
      return;
    }
    body.setVelocity(playerVelocity.x, playerVelocity.y);
    for (const [crate, velocity] of moved) {
      crate.push(velocity);
      crate.customerPushClaim = { customer, distance, time: now, velocity };
    }
    const blocked = Math.hypot(playerVelocity.x, playerVelocity.y) < intendedSpeed * 0.3;
    customer.crateStuckMs = canPush && blocked ? (customer.crateStuckMs ?? 0) + delta : 0;
    if (customer.crateStuckMs > CUSTOMER_CRATE_STUCK_MS) {
      customer.crateStuckMs = 0;
      customer.crateSqueezeMs = CUSTOMER_CRATE_SQUEEZE_MS;
      body.setVelocity(intended.x, intended.y);
    }
  }

  // Unit direction for a customer to step out of the path of a crate someone else is pushing.
  stepAsideFrom(customer, crate, crateVelocity) {
    const center = customer.sprite.body.center;
    const offset = { x: center.x - crate.sprite.x, y: center.y - crate.sprite.y };
    const speed = Math.hypot(crateVelocity?.x ?? 0, crateVelocity?.y ?? 0);
    let away = offset;
    if (speed) {
      const side = { x: -crateVelocity.y / speed, y: crateVelocity.x / speed };
      away = side.x * offset.x + side.y * offset.y >= 0 ? side : { x: -side.x, y: -side.y };
    }
    const length = Math.hypot(away.x, away.y);
    return length ? { x: away.x / length, y: away.y / length } : { x: 0, y: 0 };
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
    const crate = this.carriedCrate;
    if (!crate) return false;
    const { x, y } = this.player.sprite;
    const { x: velocityX, y: velocityY } = this.player.sprite.body.velocity;
    const position = throwing
      ? crate.findThrowPosition(this.player.sprite, velocityX, velocityY)
      : crate.findDropPosition(x, y, this.player.sprite, [], undefined, this.player.currentFacing);
    if (!position) {
      this.showGameMessage(throwing ? "No room to throw crate" : "No room to drop crate", "#94a3b8");
      return false;
    }
    if (throwing) crate.startThrow(this.player.sprite, velocityX, velocityY);
    else crate.drop(position.x, position.y, 0, 0, this.crateMotionPaused);
    this.restockCrates.push(crate);
    this.removeCarriedCrate(crate);
    this.syncFloorStacks();
    this.gameState.shop.changed();
    this.emitCrateDropped(crate, position, throwing);
    return true;
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
    const [bottom, ...rest] = this.getCarriedCrates();
    if (!bottom) return false;
    const position = bottom.findDropPosition(this.player.sprite.x, this.player.sprite.y,
      this.player.sprite, [], undefined, this.player.currentFacing);
    if (!position) {
      this.showGameMessage("No room to set the stack down", "#94a3b8");
      return false;
    }
    bottom.drop(position.x, position.y, 0, 0, this.crateMotionPaused);
    this.restockCrates.push(bottom);
    if (rest.length) this.floorStacks.set(bottom, rest);
    this.carriedCrates = [];
    this.carriedCrate = null;
    this.syncCarriedCrate();
    this.syncFloorStacks();
    this.gameState.shop.changed();
    for (const crate of [bottom, ...rest]) this.emitCrateDropped(crate, position, false);
    return true;
  }

  // Keyboard equivalent of clicking the register: steps behind the counter if close enough,
  // even with no customer waiting. Returns false so handleInteract can show its fallback.
  tryOpenRegister() {
    if (!this.isPlayerNearRegister()) return false;
    this.openRegisterWindow();
    return true;
  }

  showFloatingText(x, y, text, color) {
    this.messages.floatText(x, y, text, color);
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
    const image = this.add.image(fixture.x, fixture.y, textureKey).setDisplaySize(width, height);
    image.setDepth(2);
    this.obstacleGroup.add(image); // solid -- customers walk up to it, not through it
    fixture.sprite = image;
    image.setInteractive({ useHandCursor: true });
    image.on("pointerdown", (pointer) => {
      if (pointer.event?.target === this.game.canvas) this.tryOpenFixtureWindow(fixture);
    });
  }

  refreshGoBacksBadge() {
    const count = this.gameState.goBacks.stock.reduce((sum, entry) => sum + entry.quantity, 0);
    this.goBacksBadge.setVisible(count > 0);
    this.positionGoBacksBadge();
  }

  positionGoBacksBadge() {
    if (!this.goBacksBadge?.visible || !this.player?.sprite) return;
    const bounds = this.player.sprite.getBounds();
    this.goBacksBadge.setScale(this.getPopupScale()).setPosition(bounds.centerX, bounds.top - 2);
  }

  /**
   * The register uses the same art-sized body box as other fixtures.
   * @param {object} fixture
   */
  drawRegister(fixture) {
    const sprite = this.add
      .image(fixture.x, fixture.y, getFixtureType(fixture.type).texture)
      .setDisplaySize(fixture.gridDimensions.w * TILE_SIZE, fixture.gridDimensions.h * TILE_SIZE)
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

    const frontCustomer = this.operatingLine()[0];
    if (frontCustomer) this.startCheckout(frontCustomer); // re-renders/refocuses if already open
  }

  resumeRegisterCheckout() {
    if (!this.operatingRegister || !this.controlMode.allows("interact")) return;
    const customer = this.operatingLine()[0];
    if (!customer) return;
    this.startCheckout(customer); // resumes the sale if it's this customer's
  }

  /**
   * Go-Backs pack themselves: every few seconds, anything in the bin is poured into any crate
   * that already holds the same item and has room, then into empty crates, and only then
   * into new crates set down near the register. A message appears only when something new
   * couldn't be packed.
   * @param {number} time - scene time in ms
   */
  autoPackGoBacks(time) {
    const stock = this.gameState.goBacks.stock.filter((entry) => entry.quantity > 0);
    if (stock.length === 0) {
      this.goBacksPackRetryAt = 0;
      this.goBacksStuckKey = null;
      return;
    }
    if (time < (this.goBacksPackRetryAt ?? 0)) return;
    this.fillExistingCratesWithGoBacks();
    const left = this.gameState.goBacks.stock.filter((entry) => entry.quantity > 0);
    if (left.length === 0) return;
    const key = left.map((entry) => `${entry.itemId}:${entry.quantity}`).sort().join(",");
    const quiet = key === this.goBacksStuckKey;
    this.packGoBacks({ quiet });
    const stuck = this.gameState.goBacks.stock.some((entry) => entry.quantity > 0);
    this.goBacksStuckKey = stuck ? key : null;
    // Retry later when there's no room yet: crates or customers may move out of the way.
    this.goBacksPackRetryAt = stuck ? time + 5000 : 0;
  }

  // Pours Go-Backs into any crate with room (on the floor, in stacks, on the Loading Pad, or in
  // the player's arms): same-item crates first, then empty ones. Crates an employee is carrying
  // are mid-job and left alone.
  fillExistingCratesWithGoBacks() {
    const crates = [
      ...(this.restockCrates ?? [])
        .filter((crate) => !crate.isCarried && !crate.launch)
        .flatMap((crate) => [crate, ...(this.floorStacks?.get(crate) ?? [])]),
      ...this.getCarriedCrates(),
    ].filter((crate) => crate.kind === "item");
    let moved = 0;
    for (const entry of [...this.gameState.goBacks.stock]) {
      const sameItem = crates.filter((crate) => crate.quantity > 0 && crate.itemId === entry.itemId);
      for (const crate of [...sameItem, ...crates.filter((crate) => crate.quantity === 0)]) {
        if (this.gameState.goBacks.available(entry.itemId) <= 0) break;
        if (crate.getRemainingUnitsFor(entry.itemId) <= 0) continue;
        moved += this.gameState.goBacks.packInto(entry.itemId, crate);
      }
    }
    return moved;
  }

  /**
   * Packs whatever is left in the Go-Backs bin into new crates and sets them down, stacked up
   * to FLOOR_STACK_MAX high, as close to the register as they fit without blocking the customer
   * line, the spot behind the counter, doorways, or the fronts of fixtures. Whatever doesn't fit
   * on the floor stays in the bin.
   * @param {{ quiet?: boolean }} [options] - quiet skips the "no room" message
   * @returns {number} how many crates were set down
   */
  packGoBacks({ quiet = false } = {}) {
    const register = this.operatingRegisterFixture ?? this.fixtures.registers()[0];
    if (!register?.sprite) return 0;
    const loads = [];
    for (const entry of this.gameState.goBacks.stock) {
      const limit = getCrateItemLimit(database.getItem(entry.itemId)?.boxSize);
      if (entry.quantity <= 0 || limit <= 0) continue;
      for (let left = entry.quantity; left > 0; left -= limit) loads.push(entry.itemId);
    }
    if (loads.length === 0) return 0;

    const reserved = [
      ...this.goBacksReservedRectangles(),
      // Nobody gets boxed in: keep a full tile of space around every person in the shop.
      ...[...this.customers.map((customer) => customer.sprite), ...this.employees.map((employee) => employee.sprite)]
        .map((sprite) => {
          const feet = sprite.body?.center ?? sprite;
          return { left: feet.x - TILE_SIZE, right: feet.x + TILE_SIZE, top: feet.y - TILE_SIZE, bottom: feet.y + TILE_SIZE };
        }),
    ];
    const { centerX, centerY } = register.sprite.getBounds();
    let packed = 0;
    let floorStacksPlaced = 0;
    while (packed < loads.length) {
      const base = this.createItemCrate(null, 0, centerX, centerY);
      base.sprite.body.enable = false; // so it doesn't count as an obstacle while it looks for room
      const spot = this.findGoBacksSpot(base, reserved);
      if (!spot) {
        base.destroy();
        break;
      }
      if (!spot.inBackroom) floorStacksPlaced += 1;
      const stack = [base];
      while (stack.length < FLOOR_STACK_MAX && packed + stack.length < loads.length) {
        stack.push(this.createItemCrate(null, 0, spot.x, spot.y));
      }
      stack.forEach((crate, index) => this.gameState.goBacks.packInto(loads[packed + index], crate));
      base.drop(spot.x, spot.y, 0, 0, this.crateMotionPaused);
      this.restockCrates.push(base);
      const above = stack.slice(1);
      for (const crate of above) crate.pickUp(base.sprite);
      if (above.length) this.floorStacks.set(base, above);
      packed += stack.length;
    }
    this.syncFloorStacks();
    this.gameState.shop.changed();
    const crates = (count) => `${count} ${count === 1 ? "crate" : "crates"}`;
    if (packed === 0) {
      if (!quiet) this.showGameMessage("No clear floor space for the Go-Backs crates. Trying again shortly.", "#f59e0b");
    } else if (packed < loads.length) {
      if (!quiet) {
        this.showGameMessage(`Packed ${crates(packed)} of Go-Backs. ` +
          "There wasn't floor space for the rest, so they're still in the bin.", "#f59e0b");
      }
    } else if (floorStacksPlaced === 0) {
      this.showGameMessage(`Packed the Go-Backs into ${crates(packed)} in the backroom.`, "#10b981");
    } else {
      this.showGameMessage(`Packed the Go-Backs into ${crates(packed)}. ` +
        "The backroom was full, so some crates sit out in the store.", "#10b981");
    }
    return packed;
  }

  // Floor the Go-Backs crates must leave clear (px): the customer line, behind the counter,
  // doorways, and where people stand to use fixtures.
  goBacksReservedRectangles() {
    const tileAround = ({ x, y }) => ({
      left: x - TILE_SIZE / 2, right: x + TILE_SIZE / 2, top: y - TILE_SIZE / 2, bottom: y + TILE_SIZE / 2,
    });
    const cellCenter = ({ gx, gy }) => ({ x: this.room.worldX(gx), y: this.room.worldY(gy) });
    const link = getBackroomLink();
    const cells = [
      ...getStoreDoorCells().flatMap(({ gx, gy }) => [{ gx, gy }, { gx, gy: gy + 1 }]),
      link.shop, link.backroom,
      ...this.fixtures.shelves().flatMap((fixture) => fixture.accessCells ?? fixtureAccessCells(fixture)),
    ];
    return [
      ...this.fixtures.registers().flatMap((register) => [
        ...(register.queuePoints ?? []).map(tileAround),
        tileAround(this.getBehindRegisterPoint(register)),
      ]),
      ...cells.map((cell) => tileAround(cellCenter(cell))),
    ];
  }

  /**
   * Where a Go-Backs crate stack can sit: a backroom tile first, then the sales floor,
   * where spots with a whole empty tile of clearance on every side are preferred, so the
   * crates never crowd anything. Reserved rectangles (queues, doorways, people) are
   * skipped everywhere.
   * @param {Crate} crate - the probing crate, body disabled
   * @param {object[]} reserved - rectangles to keep clear
   * @returns {{ x: number, y: number, inBackroom: boolean } | null}
   */
  findGoBacksSpot(crate, reserved) {
    const half = TILE_SIZE / 2;
    const isReserved = (x, y) => reserved.some((rect) =>
      x - half < rect.right && x + half > rect.left && y - half < rect.bottom && y + half > rect.top);
    const scan = (area, clearance, inBackroom) => {
      for (let y = area.top + half; y <= area.bottom - half; y += TILE_SIZE) {
        for (let x = area.left + half; x <= area.right - half; x += TILE_SIZE) {
          if (isReserved(x, y)) continue;
          if (crate.isDropPositionClear(x, y, this.player.sprite, clearance)) return { x, y, inBackroom };
        }
      }
      return null;
    };
    const backroom = getBackroomBounds(this.room.zones);
    const backroomSpot = scan({
      left: backroom.x, top: backroom.y,
      right: backroom.x + backroom.width, bottom: backroom.y + backroom.height,
    }, 0, true);
    if (backroomSpot) return backroomSpot;
    const floorAreas = this.room.zones
      .filter((zone) => !zone.locked && !BACKROOM_UPGRADE_ORDER.includes(zone.id))
      .map((zone) => ({
        left: zone.gridX * TILE_SIZE, top: zone.gridY * TILE_SIZE,
        right: (zone.gridX + zone.gridW) * TILE_SIZE, bottom: (zone.gridY + zone.gridH) * TILE_SIZE,
      }));
    for (const clearance of [TILE_SIZE, 0]) {
      for (const area of floorAreas) {
        const spot = scan(area, clearance, false);
        if (spot) return spot;
      }
    }
    return null;
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
        employee.currentJob?.register &&
        this.lineFor(employee.currentJob.register)[0] === customer,
      );
  }

  /**
   * An angry customer's cart goes to the Go-Backs bin, and their line moves up.
   * @param {Customer} customer
   * @param {Array<object>} cart
   */
  handleAngryLeave(customer, cart) {
    this.debugInfo?.record("customer-left-angry", {
      customerId: this.debugInfo.identifyCustomer(customer), cart,
    });
    this.gameState.goBacks.addCart(cart);
    const spot = this.findCustomerLine(customer);
    if (!spot) return;
    spot.line.splice(spot.index, 1);
    this.layoutRegisterLine(spot.register);
    if (spot.index !== 0) return;
    if (!this.isPlayerOperating(spot.register)) return;
    // Also drops a sale the player stepped away from, so it can't be resumed later.
    this.checkoutWindow.close();
    if (spot.line[0]) this.startCheckout(spot.line[0]);
  }

  // Screen area covering the operated register and the player behind it, plus the screen
  // space between the HUD and the crate footer, for placing the register windows.
  getRegisterScreenArea() {
    const register = this.operatingRegisterFixture ?? this.fixtures.register();
    if (!register) return null;
    const { w, h } = fixtureFootprint(register);
    const rects = [worldToClientRect(this, register.gx * TILE_SIZE, register.gy * TILE_SIZE, w * TILE_SIZE, h * TILE_SIZE)];
    for (const sprite of [register.sprite, this.player?.sprite]) {
      if (!sprite?.getBounds) continue;
      const bounds = sprite.getBounds();
      rects.push(worldToClientRect(this, bounds.x, bounds.y, bounds.width, bounds.height));
    }
    const hud = document.getElementById("persistent-hud")?.getBoundingClientRect().bottom ?? 0;
    const viewport = document.getElementById("game-container").getBoundingClientRect();
    const scale = getGameScale();
    return {
      target: {
        left: Math.min(...rects.map((rect) => rect.left)),
        top: Math.min(...rects.map((rect) => rect.top)),
        right: Math.max(...rects.map((rect) => rect.right)),
        bottom: Math.max(...rects.map((rect) => rect.bottom)),
      },
      viewport: {
        left: viewport.left + 8 * scale,
        top: hud + 8 * scale,
        right: viewport.right - 8 * scale,
        bottom: viewport.bottom - (CRATE_FOOTER_HEIGHT_PX + 8) * scale,
      },
    };
  }

  // Measured to the nearest edge of a register graphic, so it works from any side and
  // follows registers wherever they're placed. Always true while already behind a counter.
  isPlayerNearRegister() {
    if (this.operatingRegister) return true;
    return Boolean(this.getNearbyRegisterTarget());
  }

  // The register fixture within the player's reach, or null.
  getNearbyRegisterTarget() {
    return this.interactables.findTarget("register", this.getInteractionOrigin())?.target ?? null;
  }

  // Hold the player at the validated rear access point until they leave the counter.
  beginRegisterSession(register = this.getNearbyRegisterTarget()) {
    if (this.operatingRegister) return;
    if (!register) return;
    // Working the counter needs empty hands; crates would lock the player in place.
    if (this.getCarriedCrates().length > 0) {
      this.showShopMessage("Put down what you're carrying before working the register.");
      return;
    }

    this.employees.forEach((employee) => employee.cancelRegisterJob(register));
    this.operatingRegister = true;
    this.operatingRegisterFixture = register;
    this.playerPositionBeforeRegister = { x: this.player.sprite.x, y: this.player.sprite.y };
    const behind = this.getBehindRegisterPoint(register);
    // From above, the player stands tucked behind the counter, partly hidden by it.
    if (fixtureFacingStep(register, true).dy < 0) {
      behind.y += PLAYER_CHARACTER_HEIGHT * REGISTER_ABOVE_LOWER_FRACTION;
      // The counter is lifted just over him (see sortPeopleByFeet) rather than sinking him
      // under it, so he stays above every floor crate beside or behind him.
      this.registerDepthBeforeTuck = register.sprite.depth;
    } else if (fixtureFacingStep(register, true).dy > 0) {
      // From below, the player stands slightly over the front of the counter.
      behind.y -= PLAYER_CHARACTER_HEIGHT * REGISTER_BELOW_RAISE_FRACTION;
    }
    this.player.teleportTo(behind.x, behind.y);
    this.player.forceFacing(fixtureFacing(register));
    this.player.inputEnabled = false;
    this.player.sprite.body.enable = false;
    this.eventBus.emit(GAME_EVENTS.REGISTER_SESSION_STARTED, {
      registerId: register.id,
    });
    this.sortPeopleByFeet();
    this.syncFloorStacks();
  }

  // Returns the player to where they stood before beginRegisterSession(). Only called when
  // the player leaves on purpose (E again), not when the checkout window closes because
  // the line ran out.
  endRegisterSession() {
    if (!this.operatingRegister) return;

    const register = this.operatingRegisterFixture;
    this.operatingRegister = false;
    this.operatingRegisterFixture = null;
    // The scan UI can't be operated from wherever the player is teleported back to. The
    // sale is set aside, not thrown away, so coming back can't re-roll it.
    if (this.checkoutWindow.mode === "checkout") this.checkoutWindow.suspend();
    this.player.sprite.body.enable = true;
    this.player.inputEnabled = true;
    if (this.registerDepthBeforeTuck != null) {
      register?.sprite?.setDepth(this.registerDepthBeforeTuck);
      this.registerDepthBeforeTuck = null;
    }
    this.player.teleportTo(
      this.playerPositionBeforeRegister.x,
      this.playerPositionBeforeRegister.y,
    );
    this.playerPositionBeforeRegister = null;
    this.eventBus.emit(GAME_EVENTS.REGISTER_SESSION_ENDED, {
      registerId: register?.id ?? null,
    });
    this.sortPeopleByFeet();
    this.syncFloorStacks();
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
      storeReputation: this.gameState.reputation.global,
      factionReputation: this.gameState.reputation.factions,
      activeFactions: this.gameState.catalog.activeFactions,
      shelfPlacements,
      getItem: (itemId) => database.getItem(itemId),
      employeeCount: this.gameState.staff.working().length,
      tieBreakOffset: this.gameState.calendar.day,
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

  hasRoomForCustomer() {
    return this.customers.length < MAX_CUSTOMERS_IN_STORE;
  }

  /**
   * Lets one customer in unless arrivals are closed or the store is full.
   * @param {string | null} factionId
   */
  spawnCustomer(factionId = null) {
    if (this.storeTemporarilyClosed || this.shiftClock.softClosed) return;
    if (this.customers.length >= MAX_CUSTOMERS_IN_STORE) {
      this.gameState.reputation.turnAwayCustomer();
      this.debugInfo?.record("customer-turned-away", { factionId, reason: "store-at-capacity" });
      return;
    }

    const customer = new Customer({
      scene: this,
      factionId,
      getShoppingPlan: (factionId, traits) => this.createCustomerShoppingPlan(factionId, traits),
      getStoreConditions: () => this.getCustomerTraitConditions(),
      registerPoint: this.fixtures.register()?.queuePoints?.[0],
      exitPoint: this.exitPoint,
      onReserveShelfSlot: (shelf, arrivingCustomer) =>
        this.reserveShelfSlot(shelf, arrivingCustomer),
      onReserveQueueSlot: (queueingCustomer) => this.reserveQueueSlot(queueingCustomer),
      onReserveExitSlot: () => this.reserveExitSlot(),
      gameState: this.gameState,
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
    if (!this.shiftClock.started || this.shiftClock.softClosed || this.shiftClock.isPaused) return false;

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
        this.gameState.market.getPrice(itemId) * BARGAIN_PRICE_RATIO,
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
   * The customer line for one register, created on first use.
   * @param {object} register - register fixture
   * @returns {Customer[]}
   */
  lineFor(register) {
    if (!this.registerLines.has(register.id)) this.registerLines.set(register.id, []);
    return this.registerLines.get(register.id);
  }

  /** The line of the register the player is working, or an empty array. */
  operatingLine() {
    return this.operatingRegisterFixture ? this.lineFor(this.operatingRegisterFixture) : [];
  }

  /** Whether the player is working this specific register. */
  isPlayerOperating(register) {
    return this.operatingRegister && this.operatingRegisterFixture === register;
  }

  /** Whether any register has a customer waiting. */
  anyRegisterLineWaiting() {
    return this.fixtures.registers().some((register) => this.lineFor(register).length > 0);
  }

  /**
   * The register fixture and line a queued customer belongs to, or null.
   * @param {Customer} customer
   */
  findCustomerLine(customer) {
    for (const register of this.fixtures.registers()) {
      const line = this.lineFor(register);
      const index = line.indexOf(customer);
      if (index !== -1) return { register, line, index };
    }
    return null;
  }

  /**
   * Only the front customer's cart shows in the checkout window; the rest wait single-file
   * with patience bubbles (see Customer.updatePatience).
   * @param {Customer} customer
   */
  handleJoinQueue(customer) {
    this.debugInfo?.recordCustomer("customer-joined-queue", customer);
    const register = this.fixtures.get(customer.targetRegisterId) ?? this.fixtures.register();
    const line = this.lineFor(register);
    line.push(customer);
    this.layoutRegisterLine(register);

    if (line.length === 1) {
      this.startCheckout(customer);
    }
  }

  // A distinct queue waypoint for a customer heading to a register, so two walkers never
  // aim at the same pixel; layoutRegisterLine fixes final spots on arrival. The customer
  // picks the shortest line, counting shoppers already walking to it. Derived fresh
  // from live customer states rather than a counter, so a customer who gives up can't
  // leak a reservation. The caller is still SEEK_SHELF, so it isn't counted.
  reserveQueueSlot(customer) {
    const registers = this.fixtures.registers();
    const headedTo = (register) => this.customers.filter((candidate) =>
      candidate !== customer && candidate.state === "SEEK_REGISTER" &&
      candidate.targetRegisterId === register.id).length;
    const register = registers.reduce((best, candidate) =>
      this.lineFor(candidate).length + headedTo(candidate) <
        this.lineFor(best).length + headedTo(best) ? candidate : best);
    customer.targetRegisterId = register.id;
    customer.registerPoint = register.queuePoints[0];
    const index = this.lineFor(register).length + headedTo(register);
    return register.queuePoints[Math.min(index, register.queuePoints.length - 1)];
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
    const cells = shelf.accessCells ?? fixtureAccessCells(shelf);
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

  // Queue cells remain reachable even when a register is moved near other fixtures.
  layoutRegisterLine(register) {
    this.lineFor(register).forEach((customer, index) => {
      const point = register.queuePoints[index];
      customer.setQueueTarget(point.x, point.y);
    });
  }

  /**
   * Opens checkout for this customer if the player is at their register, stepping them
   * behind the counter if needed; otherwise does nothing until openRegisterWindow retries.
   * Each finished sale moves the line up and serves the next customer.
   * @param {Customer} customer
   */
  startCheckout(customer) {
    if (!this.controlMode.allows("interact")) return;
    const spot = this.findCustomerLine(customer);
    if (!spot) return;
    // Only a player already behind this customer's register serves them. Standing near
    // the counter never pulls the player onto it; E (openRegisterWindow) is the only way on.
    if (!this.isPlayerOperating(spot.register)) return;

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
      const line = this.lineFor(spot.register);
      if (line[0] === customer) line.shift();
      this.layoutRegisterLine(spot.register); // shuffle everyone else forward one spot

      const nextCustomer = line[0];
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
      onWrongChange: () => this.gameState.reputation.lose(1),
      // Three Chit mistakes (wrong keys or running out of time) in one order: the customer gives up and storms out.
      onChitFailed: () => customer.leaveAngry(),
    });
  }

  completeEmployeeCheckout(employee, customer) {
    const register = employee.currentJob?.register;
    if (!register || this.isPlayerOperating(register) ||
      employee.currentJob?.customer !== customer) return false;
    const line = this.lineFor(register);
    if (line[0] !== customer) return false;
    if (this.checkoutWindow.isCheckingOut(customer.cart)) this.checkoutWindow.close();
    const total = customer.completeSale();
    this.eventBus.emit(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, { customer, total });
    this.showFloatingText(
      employee.sprite.x,
      employee.sprite.y - 50,
      `Sale completed: ${formatTransactionTotal(total)}`,
      "#10b981",
    );
    line.shift();
    this.layoutRegisterLine(register);
    line[0]?.resetPatience();
    return true;
  }

  // Shelf Test Room's automatic cashier: serves the front customer like an employee would.
  completeSandboxCheckout(customer) {
    if (!this.sandbox) return false;
    const spot = this.findCustomerLine(customer);
    if (!spot || spot.index !== 0) return false;
    if (this.checkoutWindow.isCheckingOut(customer.cart)) this.checkoutWindow.close();
    const total = customer.completeSale();
    this.eventBus.emit(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, { customer, total });
    spot.line.shift();
    this.layoutRegisterLine(spot.register);
    spot.line[0]?.resetPatience();
    return true;
  }

  // Called by customers who couldn't reach where they were going; only the test room counts them.
  noteCustomerGaveUp(customer, reason) {
    this.sandboxRoom?.noteGaveUp(customer, reason);
  }

  // --- Frame update and shift flow ---

  update(time, delta) {
    this.handleGamepad(time, delta);
    if (this.controlMode.getMode() !== CONTROL_MODES.PAUSED) this.fixturePlacement.update();
    this.debugTools?.update();
    for (const crate of this.restockCrates) crate.updateThrow(delta);
    this.separateStuckCrates();
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
      this.updateCratePushing(delta);
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
    if (this.trash) {
      this.hud.renderCleanliness(this.getCleanliness());
      this.trash.renderHighlight(Boolean(this.highlightTrashKey?.isDown) && this.controlMode.allows("crate") &&
        this.areas.playerArea !== AREA.BACKROOM, time);
    }

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
    this.refreshCustomerPool(delta);
    this.spawnScheduledCustomers();
    if (!movementFrozen && !this.fixturePlacement.active) this.autoPackGoBacks(time);
    this.shift.update();
  }
}
