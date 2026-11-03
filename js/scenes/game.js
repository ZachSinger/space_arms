import { WindowManager } from "../logic/WindowManager.js";
import { ManagerTablet } from "../logic/ManagerTablet.js";
import { PlayerState } from "../logic/PlayerState.js";
import { HUDController } from "../logic/HUDController.js";
import { StorageFixture } from "../logic/ShopInventory.js";
import { ShelfFixture } from "../logic/ShelfFixture.js";
import { Customer } from "../logic/Customer.js";
import { createCustomerBuyList } from "../logic/CustomerBuyLists.js";
import {
  createCustomerArrivalSchedule,
  createCustomerPool,
  getLicensedFactionIds,
} from "../logic/CustomerPooling.js";
import { Player } from "../logic/Player.js";
import { Crate, INTERACT_RANGE } from "../logic/Crate.js";
import { CheckoutWindow } from "../logic/CheckoutWindow.js";
import { FixtureWindow } from "../logic/FixtureWindow.js";
import { GoBacksWindow } from "../logic/GoBacksWindow.js";
import { TileRoom } from "../logic/TileRoom.js";
import { TILE_SIZE, getZone, getTotalGridSize } from "../logic/RoomLayout.js";
import { ShiftClock, SHIFT_DURATION_MS } from "../logic/ShiftClock.js";
import { ShiftSummaryWindow } from "../logic/ShiftSummaryWindow.js";
import { Market } from "../logic/Market.js";
import { findGridPath } from "../logic/Pathfinder.js";
import { FixturePlacement } from "../logic/FixturePlacement.js";
import { STARTING_FIXTURES, FIXTURE_TYPES, getFixtureType, fixtureAccessCells, validateFixtureLayout } from "../logic/FixtureLayout.js";
import { FixtureRegistry } from "../logic/FixtureRegistry.js";
import { validateShopSave } from "../logic/ShopSave.js";
import { UIWindow } from "../logic/UIWindow.js";
import { SaveManager } from "../../SaveManager.js";
import { database } from "./boot.js"; // the exported DatabaseManager singleton

// Caps how many customers can be physically inside the store at once. A full store means
// the next potential customer simply doesn't come in at all (not "delayed", gone for good)
// -- a slow/backed-up dealer genuinely loses that sale, same as if the shift had ended
// before they got to it.
const MAX_CUSTOMERS_IN_STORE = 6;

// How much stock a single ordered crate contains. Its cost comes from Market's hidden
// per-item supplier rate -- standing in for a real supplier pricing model; see TODO.md.
export const RESTOCK_QUANTITY = 5;

// How close the player has to be standing to actually operate the register -- generous on
// purpose (bigger than Crate's own INTERACT_RANGE, and bigger than the register's own
// footprint) so "reasonably close" always counts, regardless of the exact angle the
// player approaches from (early tuning measured from registerQueueAnchor made a
// straight-on south approach trivially pass, but anything off-angle could easily exceed a
// tighter radius despite looking right next to it).
const REGISTER_INTERACT_RANGE = 130;
const REGISTER_WIDTH = 90;
const REGISTER_HEIGHT = 75;

// How close the player has to be to a fixture's standPoint to deliver a carried crate or
// open it. Kept separate from Crate's own INTERACT_RANGE (which governs picking a crate up
// off the Loading Pad, and works fine tight) because standPoint is one single fixed pixel
// in front of the fixture -- a tight radius around it meant approaching from almost any
// angle but dead-center failed silently (same "reasonably close should count" problem
// the register had; see REGISTER_INTERACT_RANGE above).
const SHELF_INTERACT_RANGE = 110;

// Returns the set of "gx,gy" grid-cell keys overlapped (even partially) by a world-space
// rectangle -- used to mark a fixture's full footprint as blocked for pathfinding, since a
// fixture's pixel position/size isn't guaranteed to land on clean grid-cell boundaries.
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

export class GameScene extends Phaser.Scene {
  constructor() {
    super("scene-game");
  }

  preload() {}

  init(data = {}) {
    this.savedShopData = data.savedShopData ?? null;
  }

  create() {
    this.startingShift = false;
    this.loadFailed = false;
    this.autosaveBlocked = false;
    this.saveInProgress = null;
    this.saveErrorWindow = null;
    this.autosaveQueued = false;
    this.lastSavedSnapshot = null;
    this.saveStatus = "Not saved yet";
    this.playerState = new PlayerState();
    this.recalculateActiveFactions();
    this.market = new Market(database.getAllItems());
    this.shiftClock = new ShiftClock();
    this.customerArrivalSchedule = [];
    this.nextScheduledArrival = 0;
    this.customerPool = null;
    this.hud = new HUDController(this.playerState, this.shiftClock, () => this.startNextShift());

    this.windowManager = new WindowManager();
    this.shiftSummaryWindow = new ShiftSummaryWindow(this.windowManager, () =>
      this.startNextShift(),
    );
    this.shiftEnded = false; // guards endShift() from firing more than once per shift
    this.customersServedThisShift = 0;
    this.creditsAtShiftStart = this.playerState.credits;
    this.reputationAtShiftStart = this.playerState.globalReputation;

    // --- Shop map: authored tile room (see RoomLayout.js), with the vertical
    // slice's one hand-seeded shelf/customer-loop/register placed inside the
    // Sales Floor zone.
    this.room = new TileRoom(this);
    this.setupCamera();

    // Static obstacles that aren't part of the room's own walls (shelves, eventually other
    // placed fixtures) -- kept as its own group since TileRoom only owns the map/walls.
    this.obstacleGroup = this.physics.add.staticGroup();

    const salesFloor = getZone("sales_floor");
    const zonePixelX = salesFloor.gridX * TILE_SIZE;
    const zonePixelY = salesFloor.gridY * TILE_SIZE;
    const zonePixelW = salesFloor.gridW * TILE_SIZE;
    const zonePixelH = salesFloor.gridH * TILE_SIZE;

    // The shop's one real public entrance/exit (a designated door, not an arbitrary strip
    // of floor) -- carved into the Sales Floor's own south exterior wall, away from both
    // the shelf and the register so customer foot traffic doesn't cross either. Customers
    // spawn just inside it and walk back to its exact position to leave (see
    // customerSpawnBounds/exitPoint below); the player can walk through it too, same as
    // any other now-walkable cell.
    const doorGX = salesFloor.gridX + 2;
    const doorGY = salesFloor.gridY + salesFloor.gridH - 1;
    this.room.openDoorway(doorGX, doorGY, "door_light_blank_wide");
    this.storeDoor = { x: this.room.worldX(doorGX), y: this.room.worldY(doorGY) };

    // The Storeroom (backroom) and Sales Floor used to share one continuous open gap
    // across their entire boundary -- TileRoom only auto-walls a zone edge when the
    // neighboring zone is locked (see TileRoom.needsWallAt), so two unlocked zones sitting
    // side by side just... don't get a wall between them at all. Seal it properly with a
    // single keypad-locked employee door instead, same approach as the shop's own public
    // entrance above. The Storeroom's own connection south to the Loading Pad stays
    // intentionally open -- that one really is one continuous loading corridor, not two
    // separate rooms (see loading_pad's own zone comment in RoomLayout.js).
    const storeroom = getZone("storeroom");
    const backroomDoorGX = storeroom.gridX + storeroom.gridW - 1;
    const backroomDoorGY = storeroom.gridY + 3;
    for (let gy = storeroom.gridY; gy < storeroom.gridY + storeroom.gridH; gy += 1) {
      this.room.addWall(backroomDoorGX, gy, storeroom.wallTile, true);
    }
    this.room.openDoorway(backroomDoorGX, backroomDoorGY, "door_blast_keypad_01");
    this.backroomDoor = {
      x: this.room.worldX(backroomDoorGX),
      y: this.room.worldY(backroomDoorGY),
    };

    // Every placed fixture lives in this one registry -- see FixtureRegistry.js. Shelves use
    // manual grid placement (bible Steps 4/5/22); lockers are shared-capacity storage pools
    // (bible Step 42); the register runs checkout.
    this.fixtures = new FixtureRegistry();
    // The register's body is solid to the player and crates only: customers queue almost
    // flush against its front edge, so it can't join obstacleGroup.
    this.registerGroup = this.physics.add.staticGroup();
    // Each fixture's footprint, blocked for pathfinding (filled by applyFixtureLayout).
    this.blockedCells = new Set();
    for (const entry of STARTING_FIXTURES) this.spawnFixture(entry);
    this.operatingRegister = false;
    this.playerPositionBeforeRegister = null;

    // Customers appear just inside the store door (not spawned already deep on the floor)
    // and walk back to that exact door to leave -- a designated entrance/exit (storeDoor),
    // not an arbitrary strip of floor next to the backroom doorway like before. The small
    // +/- jitter box (rather than the door's single exact pixel) just keeps a run of
    // several customers spawning in quick succession from visually stacking on each other.
    this.customerSpawnBounds = {
      xMin: this.storeDoor.x - 24,
      xMax: this.storeDoor.x + 24,
      yMin: this.storeDoor.y - TILE_SIZE,
      yMax: this.storeDoor.y - 8,
    };
    // Where customers walk back to and vanish once their business here is done -- the
    // store door's exact position, so they visibly walk out through it rather than to some
    // unrelated point.
    this.exitPoint = { x: this.storeDoor.x, y: this.storeDoor.y };

    this.checkoutWindow = new CheckoutWindow(this.windowManager, this.playerState, () => this.openGoBacksBin());
    this.goBacksWindow = new GoBacksWindow(this.windowManager, this.playerState);
    this.fixtureWindow = new FixtureWindow(this.windowManager, this.playerState);
    // Ordered line of customers waiting at the register; index 0 is the one currently
    // being checked out. Re-laid-out (via layoutRegisterLine) any time it changes so
    // customers visibly queue up single-file instead of stacking on the same spot.
    this.registerLine = [];

    // Collision: customers can't walk through walls (TileRoom's static wall group) or
    // through the shelf/other fixtures (obstacleGroup). The register intentionally has no
    // collision body -- customers need to stand almost flush against its front edge to
    // queue, and a solid body there would just block them from ever reaching that spot.
    //
    // Deliberately NOT colliding customers against each other (no self-group collider).
    // findPath/Pathfinder.js only knows about these *static* obstacles -- it has no concept
    // of other moving customers at all, so it will happily route (or, for a short final
    // approach, fall straight back to a direct line) right past/through wherever another
    // customer currently happens to be standing. With a self-collider enabled, that
    // produces exactly the bug reported: two customers converging near the same area (the
    // shelf, the register queue, the exit) would physically block each other -- one shoved
    // against the other with velocity still aimed at its own distinct, legitimately-reachable
    // target, but making zero actual progress, forever (until SEEKING_TIMEOUT_MS gave up on
    // it). Since every convergence point already hands out a unique per-customer waypoint
    // (reserveShelfSlot/reserveQueueSlot/reserveExitSlot below), customers no longer need to
    // physically shove each other aside to find room -- so this collider was pure downside:
    // no avoidance benefit (the pathfinder can't use it to route around anyone), only
    // deadlock risk. Brief visual overlap while two customers cross paths is a minor,
    // acceptable tradeoff for them reliably actually arriving.
    this.customerGroup = this.physics.add.group();
    this.physics.add.collider(this.customerGroup, this.room.wallGroup);
    this.physics.add.collider(this.customerGroup, this.obstacleGroup);

    // Player avatar (bible Step 30/58): spawned in open floor away from both the shelf
    // (0.3/0.4) and the register (0.7/0.22) so it doesn't start inside either. Collides
    // with walls/fixtures like anyone else, but deliberately NOT with customerGroup --
    // per the bible, the player has no dynamic collision with customers either (everyone
    // glides through each other, not just customers through customers).
    this.player = new Player(this, zonePixelX + zonePixelW * 0.5, zonePixelY + zonePixelH * 0.75);
    this.physics.add.collider(this.player.sprite, this.room.wallGroup);
    this.physics.add.collider(this.player.sprite, this.obstacleGroup);
    // The register has its own static body (see drawRegister) -- not part of obstacleGroup,
    // since that's shared with customerGroup's collider and customers need to stand almost
    // flush against it to queue. The player has no such constraint.
    this.physics.add.collider(this.player.sprite, this.registerGroup);
    this.cameras.main.startFollow(this.player.sprite, true, 0.1, 0.1);

    // Loading Pad (bible Step 10): where ordered restock crates physically spawn, to be
    // hauled in by hand (see orderRestockCrate/handleInteract) rather than appearing
    // directly on the shelf -- the whole point of a physical crate is that getting it
    // inside is its own task, not an instant inventory top-up.
    const loadingPadZone = getZone("loading_pad");
    this.loadingPadSpawnPoint = {
      x: loadingPadZone.gridX * TILE_SIZE + (loadingPadZone.gridW * TILE_SIZE) / 2,
      y: loadingPadZone.gridY * TILE_SIZE + (loadingPadZone.gridH * TILE_SIZE) / 2,
    };
    const { gridW, gridH } = getTotalGridSize();
    this.crateBounds = new Phaser.Geom.Rectangle(0, 0, gridW * TILE_SIZE, gridH * TILE_SIZE);
    this.crateGroup = this.physics.add.group();
    this.physics.add.collider(this.crateGroup, this.room.wallGroup);
    this.physics.add.collider(this.crateGroup, this.obstacleGroup);
    this.physics.add.collider(this.crateGroup, this.registerGroup);
    // Register impacts without introducing dynamic obstacles to customer pathfinding.
    this.physics.add.overlap(this.crateGroup, this.customerGroup, (crateSprite, customerSprite) => {
      const crate = this.restockCrates.find((candidate) => candidate.sprite === crateSprite);
      const customer = this.customers.find((candidate) => candidate.sprite === customerSprite);
      if (crate && customer) crate.tryHitCustomer(customer);
    });
    this.restockCrates = []; // uncarried crates, at the Loading Pad or dropped on the floor
    this.carriedCrate = null; // the one crate the player is currently hauling, if any

    this.crateMotionPaused = false;
    this.shiftClock.subscribe(({ started, isPaused }) => {
      const paused = started && isPaused;
      if (paused === this.crateMotionPaused) return;
      this.crateMotionPaused = paused;
      for (const crate of this.restockCrates) crate.setPaused(paused);
    });
    this.customers = [];
    const initialLayout = this.fixtures.layout();
    const initialAccess = validateFixtureLayout(initialLayout, this.getLayoutOptions());
    if (!initialAccess.valid) throw new Error(initialAccess.reason);
    this.applyFixtureLayout(initialLayout, initialAccess);
    this.fixturePlacement = new FixturePlacement(this);
    this.input.mouse.disableContextMenu();

    // E opens fixtures or delivers/places carried crates; Space handles pickup/drop/throw.
    this.input.keyboard.on("keydown-E", () => this.handleInteract());
    this.bindCrateKey();

    // Constructed after the fixtures exist: its Supply tab reads their stock immediately
    // on construction (via SupplyRenderer -> getRestockableItems()).
    this.managerTablet = new ManagerTablet(this.windowManager, this.playerState, this);
    this.input.keyboard.on("keydown-I", () => this.managerTablet.openWindow());

    // Debug-only: proves the expand-the-store mechanism end-to-end until a
    // real purchase UI exists. Remove once that UI is built.
    this.input.keyboard.on("keydown-U", () => this.debugUnlockExpansion());

    // Debug-only: toggles a tile-grid overlay across the whole map, so misaligned fixtures
    // (placed at some fractional-of-zone-width pixel position instead of real tile
    // boundaries) are immediately obvious by eye instead of having to eyeball it against
    // the floor tiles underneath.
    this.input.keyboard.on("keydown-G", () => this.toggleDebugGrid());

    // The shift clock's "Manual Toggle" (bible Step 2) -- freezes time entirely so the
    // player can think without pressure, without a variable speed control.
    this.input.keyboard.on("keydown-P", () => this.shiftClock.togglePause());

    this.events.once("shutdown", () => {
      this.fixturePlacement.destroy();
      this.managerTablet.disableInventoryNavigation();
      this.managerTablet.fixtureHighlight.destroy();
      this.autosaveTimer.remove();
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
    this.autosaveTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => this.requestAutosave(),
    });
    this.playerState.subscribe(() => this.requestAutosave());
  }

  setupCamera() {
    const bounds = this.room.getCameraBounds();
    this.cameras.main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  // Builds a fixture model and its sprite, then registers it. Shelves and lockers start
  // empty; applySave fills in contents afterward.
  spawnFixture({ id, type, gx, gy }) {
    const spec = getFixtureType(type);
    if (!spec) throw new Error(`Unknown fixture type: ${type}`);
    const base = {
      id,
      x: (gx + spec.w / 2) * TILE_SIZE,
      y: (gy + spec.h / 2) * TILE_SIZE,
      gridDimensions: { w: spec.w, h: spec.h },
    };
    let fixture;
    if (spec.kind === "shelf") {
      fixture = new ShelfFixture({
        ...base,
        displayType: "universal",
        // The item-placement grid the player packs by hand, unrelated to the world footprint.
        displayGrid: { ...spec.displayGrid },
        // Per-placement stack depth, not a shared pool -- see ShelfFixture.getPlacementCapacity.
        stackDepth: spec.stackDepth,
        placements: [],
      });
    } else if (spec.kind === "storage") {
      fixture = new StorageFixture({ ...base, displayType: "storage", capacity: spec.capacity, stock: [] });
    } else {
      fixture = { ...base };
    }
    Object.assign(fixture, { type, gx, gy });
    if (spec.kind === "register") this.drawRegister(fixture);
    else this.drawFixture(fixture, spec.texture);
    return this.fixtures.add(fixture);
  }

  despawnAllFixtures() {
    for (const fixture of this.fixtures.clear()) fixture.sprite.destroy();
  }

  getLayoutOptions(occupiedRectangles = []) {
    const cellAt = (point) => ({ gx: Math.floor(point.x / TILE_SIZE), gy: Math.floor(point.y / TILE_SIZE) });
    const entrance = cellAt(this.storeDoor);
    const reservedCells = new Set([
      `${entrance.gx},${entrance.gy}`,
      `${entrance.gx},${entrance.gy - 1}`,
      `${cellAt(this.backroomDoor).gx},${cellAt(this.backroomDoor).gy}`,
      ...getOccupiedCellKeys(this.loadingPadSpawnPoint.x, this.loadingPadSpawnPoint.y, 136, 120),
    ]);
    return { isWalkable: (gx, gy) => this.room.isWalkable(gx, gy), entrance, reservedCells, occupiedRectangles };
  }

  canSaveOffShift() {
    return !this.loadFailed && (!this.shiftClock.started || this.shiftEnded) && this.customers.length === 0;
  }

  canRearrangeFixtures() {
    return this.canSaveOffShift() && !this.startingShift;
  }

  layoutWithMove(id, gx, gy) {
    return this.fixtures.layout().map((entry) => entry.id === id ? { ...entry, gx, gy } : entry);
  }

  checkFixtureMove(id, gx, gy) {
    const bodies = [this.player.sprite.body, ...this.restockCrates.map((crate) => crate.sprite.body)];
    return validateFixtureLayout(this.layoutWithMove(id, gx, gy), this.getLayoutOptions(
      bodies.filter((body) => body.enable).map((body) => ({
        left: body.left, right: body.right, top: body.top, bottom: body.bottom,
      })),
    ));
  }

  moveFixture(id, gx, gy) {
    if (!this.canRearrangeFixtures()) {
      this.showShopMessage("Fixtures can only move while the store is closed.");
      return false;
    }
    if (!this.fixtures.get(id)) throw new Error(`Unknown fixture: ${id}`);
    const result = this.checkFixtureMove(id, gx, gy);
    if (!result.valid) {
      this.showShopMessage(result.reason);
      return false;
    }
    this.applyFixtureLayout(this.layoutWithMove(id, gx, gy), result);
    this.playerState.notifyListeners();
    return true;
  }

  applyFixtureLayout(layout, result) {
    const toWorld = (cell) => ({ x: this.room.worldX(cell.gx), y: this.room.worldY(cell.gy) });
    for (const entry of layout) {
      const fixture = this.fixtures.get(entry.id);
      fixture.gx = entry.gx;
      fixture.gy = entry.gy;
      fixture.x = (entry.gx + fixture.gridDimensions.w / 2) * TILE_SIZE;
      fixture.y = (entry.gy + fixture.gridDimensions.h / 2) * TILE_SIZE;
      fixture.sprite.setPosition(fixture.x, fixture.y);
      fixture.sprite.body.updateFromGameObject();
      fixture.standPoint = toWorld(result.access.get(entry.id));
    }
    this.blockedCells = result.blockedCells;
    this.registerQueuePoints = result.queueCells.map(toWorld);
    this.registerQueueAnchor = this.registerQueuePoints[0];
    const behind = fixtureAccessCells(this.fixtures.register(), true);
    this.behindRegisterPoint = toWorld(behind[Math.floor(behind.length / 2)]);
  }

  serialize() {
    const pending = this.fixtureWindow.pendingPlacement;
    const snapshot = {
      playerState: this.playerState.serialize(),
      market: this.market.serialize(),
      fixtures: this.fixtures.all().map((fixture) => {
        const entry = { id: fixture.id, type: fixture.type, gx: fixture.gx, gy: fixture.gy };
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
      crates: this.restockCrates.map((crate) => crate.serialize()),
      carriedCrate: this.carriedCrate ? {
        ...this.carriedCrate.serializePayload(),
      } : null,
    };
    return validateShopSave(snapshot, database);
  }

  applySave(saved) {
    const data = validateShopSave(saved, database);
    for (const id of data.unlockedZones) this.room.unlockZone(id);
    const result = validateFixtureLayout(data.fixtures, this.getLayoutOptions());
    if (!result.valid) throw new Error(`Invalid saved layout: ${result.reason}`);
    this.despawnAllFixtures();
    for (const entry of data.fixtures) {
      const fixture = this.spawnFixture(entry);
      if (fixture instanceof ShelfFixture) fixture.placements = entry.placements.map((stack) => ({ ...stack }));
      if (fixture instanceof StorageFixture) fixture.stock = entry.stock.map((stack) => ({ ...stack }));
    }
    this.applyFixtureLayout(data.fixtures, result);
    this.market.applySave(data.market);
    this.player.teleportTo(this.storeDoor.x, this.storeDoor.y - TILE_SIZE);
    for (const crate of this.restockCrates) crate.destroy();
    this.restockCrates = data.crates.map((entry) => {
      const crate = new Crate(this, entry.itemId, entry.quantity, entry.x, entry.y,
        entry.kind === "fixture" ? { kind: "fixture", typeId: entry.typeId } : undefined);
      crate.applySave(entry);
      return crate;
    });
    if (this.carriedCrate) this.carriedCrate.destroy();
    this.carriedCrate = null;
    if (data.carriedCrate) {
      const entry = data.carriedCrate;
      this.carriedCrate = new Crate(
        this, entry.itemId, entry.quantity, this.player.sprite.x, this.player.sprite.y,
        entry.kind === "fixture" ? { kind: "fixture", typeId: entry.typeId } : undefined,
      );
      this.carriedCrate.pickUp(this.player.sprite);
    }
    this.playerState.applySave(data.playerState);
    this.recalculateActiveFactions();
    this.creditsAtShiftStart = this.playerState.credits;
    this.reputationAtShiftStart = this.playerState.globalReputation;
    this.setupCamera();
    this.lastSavedSnapshot = JSON.stringify(this.serialize());
    this.setSaveStatus("Saved. Autosaves while the store is closed.");
  }

  requestAutosave() {
    if (!this.canSaveOffShift() || this.autosaveBlocked || this.autosaveQueued) return;
    this.autosaveQueued = true;
    queueMicrotask(() => {
      this.autosaveQueued = false;
      if (!this.scene.isActive() || !this.canSaveOffShift()) return;
      this.saveOffShift().catch((error) => this.handlePersistenceError(error));
    });
  }

  async saveOffShift() {
    if (!this.canSaveOffShift()) return;
    if (this.saveInProgress) {
      await this.saveInProgress;
      return this.saveOffShift();
    }
    const snapshot = JSON.stringify(this.serialize());
    if (snapshot === this.lastSavedSnapshot) return;
    this.setSaveStatus("Saving...");
    this.saveInProgress = this.saveManager.save();
    try {
      await this.saveInProgress;
      this.lastSavedSnapshot = snapshot;
      this.autosaveBlocked = false;
      this.setSaveStatus("Saved. Autosaves while the store is closed.");
      this.saveErrorWindow?.close();
    } finally {
      this.saveInProgress = null;
    }
  }

  setSaveStatus(text) {
    this.saveStatus = text;
    this.managerTablet?.updateSaveStatus();
  }

  showShopMessage(message) {
    this.showFloatingText(this.player.sprite.x, this.player.sprite.y - 40, message, "#f59e0b");
  }

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

  // Whether a customer could ever stand at this grid cell: must belong to a currently
  // unlocked zone, not be one of the room's own wall tiles, and not overlap a placed
  // fixture's footprint (the shelf, currently).
  isCellWalkable(gx, gy) {
    if (!this.room.isWalkable(gx, gy)) return false;
    return !this.blockedCells.has(`${gx},${gy}`);
  }

  // Computes a real path (array of {x, y} world-space waypoints) from one world point to
  // another, routing around walls and fixtures via Pathfinder's grid-based BFS. Returns
  // null if no path exists; callers should fall back to a direct walk in that case (see
  // Customer.followPath) rather than refusing to move at all.
  findPath(fromX, fromY, toX, toY) {
    const start = { gx: Math.floor(fromX / TILE_SIZE), gy: Math.floor(fromY / TILE_SIZE) };
    const goal = { gx: Math.floor(toX / TILE_SIZE), gy: Math.floor(toY / TILE_SIZE) };

    const gridPath = findGridPath(start, goal, (gx, gy) => this.isCellWalkable(gx, gy));
    if (!gridPath) return null;

    return gridPath.map(({ gx, gy }) => ({
      x: this.room.worldX(gx),
      y: this.room.worldY(gy),
    }));
  }

  // Temporary debug hook (keydown-U) for the "expand the store" flow -- swap for a
  // real purchase UI once the economy/contracts system exists.
  debugUnlockExpansion() {
    if (!this.canRearrangeFixtures()) {
      this.showShopMessage("Expand the shop while the store is closed.");
      return;
    }
    const bounds = this.room.unlockZone("expansion_a");
    this.cameras.main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    this.playerState.notifyListeners();
    console.log("Unlocked expansion_a; camera bounds now", bounds);
  }

  // Debug hook (keydown-G): a tile-grid line overlay across the entire authored map
  // (every zone, including locked/not-yet-built ones, so it's also useful for lining up
  // expansion content later), drawn once and just toggled visible/hidden after that. Sits
  // at depth 9998 -- just under the player's own 9999 (bible Step 30/58) -- so it draws on
  // top of every floor/wall/fixture/character, making any fixture whose position isn't a
  // clean multiple of TILE_SIZE immediately obvious instead of having to eyeball it.
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

  // Whichever stock-holding fixture (shelf or locker) the player is standing close enough
  // to, or null -- used by both crate delivery and opening a fixture's window, so "close
  // enough" means the same thing for both.
  getNearbyFixture() {
    let nearest = null;
    let nearestDistance = SHELF_INTERACT_RANGE;

    for (const fixture of this.fixtures.stockHolders()) {
      const distance = Phaser.Math.Distance.Between(
        this.player.sprite.x,
        this.player.sprite.y,
        fixture.standPoint.x,
        fixture.standPoint.y,
      );
      if (distance <= nearestDistance) {
        nearest = fixture;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  // What ordering RESTOCK_QUANTITY more of this item costs -- shared by the Supply tab
  // (so it can display the real price) and orderRestockCrate (so it charges that same
  // price).
  restockCost(item) {
    return this.market.getSupplyCost(item.id, RESTOCK_QUANTITY);
  }

  getStorePrice(itemId) {
    return this.playerState.storePrices[itemId] ?? this.market.getPrice(itemId);
  }

  getLoadingPadSpawnPosition() {
    const offsets = [-64, 0, 64];
    for (const dy of offsets) {
      for (const dx of offsets) {
        const position = {
          x: this.loadingPadSpawnPoint.x + dx,
          y: this.loadingPadSpawnPoint.y + dy,
        };
        const occupied = this.restockCrates.some((crate) =>
          Math.abs(crate.sprite.x - position.x) < 52 &&
          Math.abs(crate.sprite.y - position.y) < 52,
        );
        if (!occupied) return position;
      }
    }
    return null;
  }

  setStorePrice(itemId, price) {
    const rounded = Math.round(price);
    if (!Number.isFinite(rounded) || rounded < 1) return false;
    this.playerState.setStorePrice(itemId, rounded);
    return true;
  }

  getInventoryItems() {
    const totals = new Map();
    const add = (entry, column) => {
      if (!entry.itemId || entry.quantity <= 0) return;
      if (!totals.has(entry.itemId)) totals.set(entry.itemId, { storage: 0, stock: 0 });
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
    if (this.carriedCrate?.kind === "item") add(this.carriedCrate, "storage");

    return database.getAllItems()
      .filter((item) => totals.has(item.id))
      .map((item) => ({
        item,
        ...totals.get(item.id),
        marketPrice: this.market.getPrice(item.id),
        storePrice: this.getStorePrice(item.id),
      }));
  }

  // Everything the Supply tab needs to render: bible Step 29's "Unified Market" -- every
  // item in the WHOLE catalog that the player currently has a signed Supplier License
  // for (bible Step 48: "Customers only expect items from Supplier Contracts you have
  // actively signed and paid for" -- the same gate applies to the player's own ordering).
  // Affordability is checked separately, per-order, not here -- an unaffordable item
  // still shows up (just can't be ordered yet), same as before. Not limited to items
  // already stocked somewhere; that was a mistake (previous commit) that made ordering
  // impossible for a fixture that legitimately starts completely empty.
  getRestockableItems() {
    const quantityByItemId = new Map();
    for (const fixture of this.fixtures.stockHolders()) {
      for (const entry of fixture.stock) {
        quantityByItemId.set(entry.itemId, (quantityByItemId.get(entry.itemId) || 0) + entry.quantity);
      }
    }

    return database
      .getAllItems()
      .filter((item) => this.playerState.activeLicenses.has(item.license))
      .map((item) => ({
        item,
        quantity: quantityByItemId.get(item.id) || 0,
        cost: this.restockCost(item),
      }));
  }

  recalculateActiveFactions() {
    const activeFactions = getLicensedFactionIds(
      this.playerState.activeLicenses,
      database.getAllItems(),
    );
    this.playerState.setActiveFactions(activeFactions);
  }

  // Spends credits and spawns a physical crate at the Loading Pad (bible Step 10) -- it
  // isn't actually restocked until the player hauls it to a fixture, see handleInteract().
  // Returns false (no-op) if the player can't afford it or doesn't have a signed license
  // for this item (bible Step 48) -- NOT gated on whether anything's already stocked
  // somewhere; that was wrong (see getRestockableItems' own comment).
  orderRestockCrate(itemId) {
    const item = database.getItem(itemId);
    if (!item) return false;
    if (!this.playerState.activeLicenses.has(item.license)) return false;

    const cost = this.restockCost(item);
    if (this.playerState.credits < cost) return false;
    const spawn = this.getLoadingPadSpawnPosition();
    if (!spawn) return false;

    this.playerState.spendCredits(cost);
    // A first-time item starts at today's market price, then stays put until repriced.
    if (this.playerState.storePrices[itemId] === undefined) {
      this.playerState.storePrices[itemId] = this.market.getPrice(itemId);
    }

    const crate = new Crate(this, itemId, RESTOCK_QUANTITY, spawn.x, spawn.y);
    crate.setPaused(this.crateMotionPaused);
    this.restockCrates.push(crate);
    this.playerState.notifyListeners();
    return true;
  }

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

  buyFixture(typeId) {
    const spec = getFixtureType(typeId);
    if (!spec) throw new Error(`Unknown fixture type: ${typeId}`);
    if (!this.playerState.activeLicenses.has(spec.licenseId)) return false;
    if (this.fixtures.ofKind("register").length && spec.kind === "register") return false;
    if (this.playerState.credits < spec.price) return false;
    const spawn = this.getLoadingPadSpawnPosition();
    if (!spawn) return false;

    this.playerState.spendCredits(spec.price);
    const crate = new Crate(this, null, 1, spawn.x, spawn.y, { kind: "fixture", typeId });
    crate.setPaused(this.crateMotionPaused);
    this.restockCrates.push(crate);
    this.playerState.notifyListeners();
    return true;
  }

  canCrateFixture(fixture) {
    return this.getFixtureCrateBlockReason(fixture) === null;
  }

  getFixtureCrateBlockReason(fixture) {
    if (!fixture) return "Fixture not found.";
    if (!this.canRearrangeFixtures()) return "Fixtures can only be crated while the store is closed.";
    if (getFixtureType(fixture.type).kind === "register" &&
      this.fixtures.ofKind("register").length <= 1) return "The last register cannot be crated.";
    if (fixture instanceof ShelfFixture && fixture.placements.some((stack) => stack.quantity > 0)) {
      return "Only empty fixtures can be crated.";
    }
    if (fixture instanceof StorageFixture && fixture.stock.some((stack) => stack.quantity > 0)) {
      return "Only empty fixtures can be crated.";
    }
    return null;
  }

  crateFixture(id) {
    const fixture = this.fixtures.get(id);
    if (!fixture) throw new Error(`Unknown fixture: ${id}`);
    const reason = this.getFixtureCrateBlockReason(fixture);
    if (reason) {
      this.showShopMessage(reason);
      return false;
    }
    if (this.fixtureWindow.fixture === fixture) this.fixtureWindow.uiWindow.close();
    fixture.sprite.destroy();
    this.fixtures.remove(id);
    const crate = new Crate(this, null, 1, fixture.x, fixture.y, {
      kind: "fixture",
      typeId: fixture.type,
    });
    crate.setPaused(this.crateMotionPaused);
    this.restockCrates.push(crate);
    this.playerState.notifyListeners();
    return true;
  }

  checkFixturePlacement(typeId, gx, gy) {
    const id = this.fixtures.nextId(typeId);
    const layout = [...this.fixtures.layout(), { id, type: typeId, gx, gy }];
    const bodies = [this.player.sprite.body, ...this.restockCrates.map((crate) => crate.sprite.body)];
    return validateFixtureLayout(layout, this.getLayoutOptions(
      bodies.filter((body) => body.enable).map((body) => ({
        left: body.left, right: body.right, top: body.top, bottom: body.bottom,
      })),
    ));
  }

  placeFixtureFromCrate(crate, gx, gy) {
    if (!this.canRearrangeFixtures() || this.carriedCrate !== crate || crate.kind !== "fixture") return false;
    const id = this.fixtures.nextId(crate.typeId);
    const result = this.checkFixturePlacement(crate.typeId, gx, gy);
    if (!result.valid) {
      this.showShopMessage(result.reason);
      return false;
    }

    const entry = { id, type: crate.typeId, gx, gy };
    this.spawnFixture(entry);
    this.applyFixtureLayout(this.fixtures.layout(), result);
    crate.destroy();
    this.carriedCrate = null;
    this.playerState.notifyListeners();
    return true;
  }

  // E delivers/places a carried crate, opens a nearby fixture, or toggles register operation.
  handleInteract() {
    if (this.fixturePlacement.active || this.startingShift || this.loadFailed) return;
    if (this.carriedCrate) {
      if (this.carriedCrate.kind === "fixture") {
        const nearby = this.getNearbyFixture();
        if (nearby && getFixtureType(nearby.type).kind === "storage") {
          this.showFloatingText(this.player.sprite.x, this.player.sprite.y - 40,
            "Fixtures can't be stocked here", "#94a3b8");
          return;
        }
        this.fixturePlacement.beginFromCrate(this.carriedCrate);
        return;
      }
      this.tryDeliverCarriedCrate();
      return;
    }

    if (this.tryOpenFixtureWindow()) return;

    // Toggle: pressing E again while already behind the counter leaves it, rather than
    // trying (and failing) to re-enter an already-active session.
    if (this.operatingRegister) {
      this.endRegisterSession();
      return;
    }
    if (this.tryOpenRegister()) return;

    this.showFloatingText(
      this.player.sprite.x,
      this.player.sprite.y - 40,
      "Nothing nearby to interact with",
      "#94a3b8",
    );
  }

  // Opens whichever fixture (shelf or storage) the player is standing close enough to --
  // called either with a specific fixture (clicking its sprite directly) or with none (the
  // E key, which finds whichever one is nearby). Silently no-ops if out of range, same as
  // the register's own click-to-open (no pathfind-to-anchor yet -- see bible's "Modal
  // Windows & Anchors" note in the design doc for the eventual intended behavior).
  tryOpenFixtureWindow(fixture) {
    if (this.fixturePlacement.active || this.startingShift || this.loadFailed) return false;
    const target = fixture || this.getNearbyFixture();
    if (!target) return false;

    const distance = Phaser.Math.Distance.Between(
      this.player.sprite.x,
      this.player.sprite.y,
      target.standPoint.x,
      target.standPoint.y,
    );
    if (distance > SHELF_INTERACT_RANGE) return false;

    this.fixtureWindow.openForFixture(target, this.fixtures.displayName(target));
    return true;
  }

  // Handles a pickup or warns about a nearby moving crate.
  tryPickUpNearestCrate() {
    const { x, y } = this.player.sprite;
    let nearest = null;
    let nearestDistance = INTERACT_RANGE;
    let movingNearby = false;

    for (const crate of this.restockCrates) {
      const distance = crate.distanceTo(x, y);
      if (distance > INTERACT_RANGE) continue;
      if (!crate.isStationary()) {
        movingNearby = true;
        continue;
      }
      if (distance <= nearestDistance) {
        nearest = crate;
        nearestDistance = distance;
      }
    }

    if (!nearest || !nearest.pickUp(this.player.sprite)) {
      if (!nearest && !movingNearby) return false;
      this.showFloatingText(x, y - 40, "Wait for crate to stop", "#f59e0b");
      return true;
    }

    this.restockCrates = this.restockCrates.filter((crate) => crate !== nearest);
    this.carriedCrate = nearest;

    const description = nearest.kind === "fixture"
      ? `${getFixtureType(nearest.typeId).name} fixture`
      : `${database.getItem(nearest.itemId).name} x${nearest.quantity}`;
    this.showFloatingText(x, y - 40, `Picked up ${description} (Space to drop/throw)`, "#38bdf8");
    this.playerState.notifyListeners();
    return true;
  }

  bindCrateKey() {
    // Cursor keys capture Space by default, which blocks focused UI controls.
    this.input.keyboard.removeCapture("SPACE");
    this.input.keyboard.on("keydown-SPACE", (event) => {
      if (event.target?.closest?.("#ui-layer")) return;
      event.preventDefault();
      if (!event.repeat) this.handleCrateInteract();
    });
  }

  handleCrateInteract() {
    if (this.fixturePlacement.active || this.startingShift || this.loadFailed) return;
    if (this.carriedCrate) {
      this.dropCarriedCrate();
      return;
    }
    const { x, y } = this.player.sprite;
    if (this.operatingRegister) {
      this.showFloatingText(x, y - 40, "Leave the register to pick up a crate", "#94a3b8");
      return;
    }
    if (!this.tryPickUpNearestCrate()) {
      this.showFloatingText(x, y - 40, "No crate nearby", "#94a3b8");
    }
  }

  dropCarriedCrate() {
    if (this.fixturePlacement.active || this.startingShift || this.loadFailed) return false;
    const { x, y } = this.player.sprite;
    const crate = this.carriedCrate;
    if (!crate) {
      this.showFloatingText(x, y - 40, "No crate to drop", "#94a3b8");
      return false;
    }
    if (this.operatingRegister) {
      this.showFloatingText(x, y - 40, "Leave the register to drop a crate", "#94a3b8");
      return false;
    }

    const position = crate.findDropPosition(x, y);
    if (!position) {
      this.showFloatingText(x, y - 40, "No room to drop crate", "#94a3b8");
      return false;
    }

    const velocity = this.player.sprite.body.velocity;
    crate.drop(
      position.x,
      position.y,
      this.crateMotionPaused ? 0 : velocity.x,
      this.crateMotionPaused ? 0 : velocity.y,
      this.crateMotionPaused,
    );
    this.restockCrates.push(crate);
    this.carriedCrate = null;
    const description = crate.kind === "fixture"
      ? `${getFixtureType(crate.typeId).name} fixture`
      : `${database.getItem(crate.itemId).name} x${crate.quantity}`;
    this.showFloatingText(x, y - 40, `Dropped ${description}`, "#38bdf8");
    this.playerState.notifyListeners();
    return true;
  }

  // Keyboard equivalent of clicking the register sprite -- enters the register (teleports
  // behind the counter) if close enough, regardless of whether there's actually a
  // customer to scan right now (see openRegisterWindow's comment). Returns true/false so
  // handleInteract knows whether this actually did anything, for its own fallback
  // "nothing nearby" message.
  tryOpenRegister() {
    if (!this.isPlayerNearRegister()) return false;
    this.openRegisterWindow();
    return true;
  }

  tryDeliverCarriedCrate() {
    const crate = this.carriedCrate;
    if (crate.kind === "fixture") {
      this.showFloatingText(this.player.sprite.x, this.player.sprite.y - 40,
        "Fixtures can't be stocked here", "#94a3b8");
      return;
    }
    const target = this.getNearbyFixture();

    if (!target) {
      this.showFloatingText(
        this.player.sprite.x,
        this.player.sprite.y - 40,
        "Too far from a fixture to deliver",
        "#94a3b8",
      );
      return;
    }

    const item = database.getItem(crate.itemId);

    if (target.getRemainingUnitsFor(crate.itemId) === 0) {
      this.showFloatingText(
        this.player.sprite.x,
        this.player.sprite.y - 40,
        `${item.name} can't be stocked here`,
        "#94a3b8",
      );
      return;
    }

    const accepted = target.restock(crate.itemId, crate.quantity);
    this.fixtureWindow.refresh(target); // keep its capacity bar/stock list live if open

    if (accepted >= crate.quantity) {
      // Fully emptied -- the "Abstracted Box" approach (bible Step 62): once the last
      // unit leaves a crate, it instantly despawns rather than sticking around empty.
      this.showFloatingText(
        this.player.sprite.x,
        this.player.sprite.y - 40,
        `Restocked ${item.name} +${accepted}`,
        "#10b981",
      );
      crate.destroy();
      this.carriedCrate = null;
    } else {
      // Fixture's total capacity is already full -- keep carrying whatever didn't fit
      // instead of silently discarding it.
      crate.quantity -= accepted;
      this.showFloatingText(
        this.player.sprite.x,
        this.player.sprite.y - 40,
        accepted > 0
          ? `Restocked +${accepted}, ${crate.quantity} left (full)`
          : `Already full -- still carrying ${crate.quantity}`,
        "#f59e0b",
      );
    }
    this.playerState.notifyListeners();
  }

  // Brief on-screen confirmation for actions that would otherwise have no visible feedback
  // at all (picking up/delivering a crate just makes it silently appear/disappear). Holds
  // fully readable for a beat before floating up and fading out, rather than fading
  // immediately on spawn -- at the old 14px/instant-fade tuning this was gone before you
  // could even read it (the text itself is right above the player's own head, exactly
  // where you're least likely to already be looking the instant you press the key).
  showFloatingText(x, y, text, color) {
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
      .setDepth(9999);

    this.tweens.add({
      targets: label,
      y: y - 36,
      alpha: 0,
      duration: 900,
      delay: 900,
      ease: "Cubic.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  drawFixture(fixture, textureKey) {
    const width = fixture.gridDimensions.w * TILE_SIZE;
    const height = fixture.gridDimensions.h * TILE_SIZE;
    const image = this.add
      .image(fixture.x, fixture.y, textureKey)
      .setDisplaySize(width, height)
      .setDepth(2);
    this.obstacleGroup.add(image); // solid -- customers walk up to it, not through it
    fixture.sprite = image;
    image.setInteractive({ useHandCursor: true });
    image.on("pointerdown", (pointer) => {
      if (pointer.event?.target === this.game.canvas) this.tryOpenFixtureWindow(fixture);
    });
  }

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

  // Walking up and pressing E / clicking the register always lets the player step behind
  // the counter (bible-style), regardless of whether there's actually a customer waiting
  // right now -- only the item-scanning window itself is conditional on there being
  // something to scan. If a customer does show up later while already standing there (see
  // handleJoinQueue), the scan window opens automatically. Requires the player to
  // actually be near the register -- now that a real player character exists, operating
  // it from anywhere on the map doesn't make sense anymore.
  openRegisterWindow() {
    if (this.fixturePlacement.active || this.startingShift || this.loadFailed) return;
    if (!this.isPlayerNearRegister()) return;

    this.beginRegisterSession(); // no-ops if already in one

    const frontCustomer = this.registerLine[0];
    if (frontCustomer) this.startCheckout(frontCustomer); // re-renders/refocuses if already open
    else this.checkoutWindow.openIdle(); // still offers the Go-Backs bin
  }

  // The bin is part of the register UI, so it's only reachable from behind the counter.
  openGoBacksBin() {
    if (!this.operatingRegister) return;
    this.goBacksWindow.open();
  }

  // The front customer's patience holds while the player is actually ringing them up.
  isServingCustomer(customer) {
    return this.operatingRegister && this.registerLine[0] === customer &&
      this.checkoutWindow.mode === "checkout" && this.checkoutWindow.uiWindow.isOpen;
  }

  // Bible Step 12: an angry customer's cart goes to the Go-Backs bin.
  handleAngryLeave(customer, cart) {
    this.playerState.addToGoBacks(cart);
    const wasFront = this.registerLine[0] === customer;
    this.registerLine = this.registerLine.filter((candidate) => candidate !== customer);
    this.layoutRegisterLine();
    if (!wasFront || !this.operatingRegister || !this.checkoutWindow.uiWindow.isOpen) return;
    if (this.registerLine[0]) this.startCheckout(this.registerLine[0]);
    else this.checkoutWindow.openIdle();
  }

  // Same "front of the counter" approach point customers queue at, not the register
  // sprite's own raw center -- consistent with how the shelf's interact range is measured
  // (see tryDeliverCarriedCrate). Always true while already mid-session (teleported behind
  // the counter, see beginRegisterSession) -- their literal distance from
  // registerQueueAnchor no longer reflects anything meaningful once they're back there.
  isPlayerNearRegister() {
    if (this.operatingRegister) return true;

    const distance = Phaser.Math.Distance.Between(
      this.player.sprite.x,
      this.player.sprite.y,
      this.registerQueueAnchor.x,
      this.registerQueueAnchor.y,
    );
    return distance <= REGISTER_INTERACT_RANGE;
  }

  // Hold the player at the validated rear access point until they leave the counter.
  beginRegisterSession() {
    if (this.operatingRegister) return;

    this.operatingRegister = true;
    this.playerPositionBeforeRegister = { x: this.player.sprite.x, y: this.player.sprite.y };
    this.player.teleportTo(this.behindRegisterPoint.x, this.behindRegisterPoint.y);
    this.player.forceFacing("down");
    this.player.inputEnabled = false;
    this.player.sprite.body.enable = false;
  }

  // Teleports the player back to wherever they were standing right before
  // beginRegisterSession(), and restores input + collision. Only ever called when the
  // player deliberately leaves (pressing E again -- see handleInteract) -- NOT tied to the
  // checkout window closing, since that now also happens automatically whenever the queue
  // just runs out (nothing left to scan), which shouldn't eject them from the counter.
  endRegisterSession() {
    if (!this.operatingRegister) return;

    this.operatingRegister = false;
    // Leaving the counter should dismiss any active scan UI too -- can't operate it from
    // wherever they're about to be teleported back to.
    if (!this.checkoutWindow.uiWindow.element.classList.contains("hidden")) {
      this.checkoutWindow.uiWindow.close();
    }
    this.goBacksWindow.uiWindow.close();
    this.player.sprite.body.enable = true;
    this.player.inputEnabled = true;
    this.player.teleportTo(
      this.playerPositionBeforeRegister.x,
      this.playerPositionBeforeRegister.y,
    );
    this.playerPositionBeforeRegister = null;
  }

  prepareCustomerSchedule() {
    const shelfPlacements = this.fixtures.shelves().flatMap((shelf) =>
      shelf.placements.map((placement) => ({ ...placement })),
    );
    this.customerPool = createCustomerPool({
      storeReputation: this.playerState.globalReputation,
      factionReputation: this.playerState.factionReputation,
      activeFactions: this.playerState.activeFactions,
      shelfPlacements,
      getItem: (itemId) => database.getItem(itemId),
      employeeCount: 0,
      tieBreakOffset: this.market.day,
    });
    this.customerArrivalSchedule = createCustomerArrivalSchedule(
      this.customerPool.customerFactionIds,
      SHIFT_DURATION_MS,
    );
    this.nextScheduledArrival = 0;
  }

  spawnScheduledCustomers() {
    if (!this.shiftClock.started || !this.customerArrivalSchedule) return;

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

  spawnCustomer(factionId = null) {
    if (this.customers.length >= MAX_CUSTOMERS_IN_STORE) {
      // Store's at capacity -- this customer never comes in at all, not merely delayed.
      this.playerState.customersTurnedAway += 1;
      return;
    }

    const customer = new Customer({
      scene: this,
      factionId,
      getShoppingPlan: (factionId) => this.createCustomerShoppingPlan(factionId),
      registerPoint: this.registerQueueAnchor,
      exitPoint: this.exitPoint,
      onReserveShelfSlot: (shelf, arrivingCustomer) =>
        this.reserveShelfSlot(shelf, arrivingCustomer),
      onReserveQueueSlot: () => this.reserveQueueSlot(),
      onReserveExitSlot: () => this.reserveExitSlot(),
      playerState: this.playerState,
      spawnBounds: this.customerSpawnBounds,
      onJoinQueue: (arrivingCustomer) => this.handleJoinQueue(arrivingCustomer),
      onLeaveAngry: (angryCustomer, cart) => this.handleAngryLeave(angryCustomer, cart),
      onComplete: (completedCustomer) => {
        this.customers = this.customers.filter(
          (candidate) => candidate !== completedCustomer,
        );
      },
    });
    this.customerGroup.add(customer.sprite);
    this.customers.push(customer);
  }

  createCustomerShoppingPlan(factionId) {
    const shelves = this.fixtures.shelves();
    const shelfItemIds = shelves.flatMap((shelf) =>
      shelf.placements.map((placement) => placement.itemId),
    );
    const buyList = createCustomerBuyList(
      factionId,
      shelfItemIds,
      (itemId) => database.getItem(itemId),
    );
    const targetIds = new Set([
      ...buyList.primaryItemIds,
      ...buyList.bonusItemIds,
      ...Object.values(buyList.matchingAmmoIdsByFirearm).flat(),
    ]);
    const shelfStops = shelves
      .filter((shelf) => shelf.placements.some((placement) => targetIds.has(placement.itemId)))
      .map((fixture) => ({ fixture, standPoint: fixture.standPoint }));
    return { ...buyList, shelfStops };
  }

  getItem(itemId) {
    return database.getItem(itemId);
  }

  // Only the customer at the front of the line (index 0) has their cart shown in the
  // checkout window; everyone else waits in a visible single-file line behind them, with
  // patience bubbles overhead (bible Step 53, see Customer.updatePatience).
  handleJoinQueue(customer) {
    this.registerLine.push(customer);
    this.layoutRegisterLine();

    if (this.registerLine.length === 1) {
      this.startCheckout(customer);
    }
  }

  // Claims a unique, never-reused waypoint for a customer who's just leaving the shelf
  // and heading to the register, so two customers walking there at the same time never
  // aim at the identical pixel -- which would otherwise jam them into each other via the
  // collider and block both of them from ever actually arriving. Once a customer really
  // arrives, layoutRegisterLine() repositions them to their true index anyway, so this
  // reservation only has to be unique, not a perfect final-position guess.
  //
  // Deliberately NOT manual increment/decrement bookkeeping (an earlier version tried
  // that with a counter that was supposed to be released once a customer joined the queue,
  // but any path that skips joining -- e.g. the SEEKING_TIMEOUT_MS give-up case -- leaked
  // a phantom reservation that was never released, permanently inflating the count and
  // eventually producing a destination past the room's own wall again). Instead, this is
  // derived FRESH every call directly from live customer state: count how many OTHER
  // customers are already in SEEK_REGISTER (the caller is still SEEK_SHELF at this exact
  // point, so it's automatically excluded), plus how many are already actually queued.
  // Nothing to leak -- a customer that gives up is simply no longer SEEK_REGISTER, so it
  // stops counting on its own, by construction.
  reserveQueueSlot() {
    const inFlight = this.customers.filter((c) => c.state === "SEEK_REGISTER").length;
    const index = this.registerLine.length + inFlight;
    return this.registerQueuePoints[Math.min(index, this.registerQueuePoints.length - 1)];
  }

  // Distribute shoppers approaching the same shelf across its clear front edge.
  reserveShelfSlot(shelf, arrivingCustomer = null) {
    const inFlight = this.customers.filter((c) =>
      c !== arrivingCustomer && c.state === "SEEK_SHELF" && c.fixture === shelf,
    ).length;
    const cells = fixtureAccessCells(shelf);
    const cell = cells[inFlight % cells.length];
    return { x: this.room.worldX(cell.gx), y: this.room.worldY(cell.gy) };
  }

  reserveExitSlot() {
    return { ...this.exitPoint };
  }

  // Queue cells remain reachable even when the register is moved near other fixtures.
  layoutRegisterLine() {
    this.registerLine.forEach((customer, index) => {
      const point = this.registerQueuePoints[index];
      customer.setQueueTarget(point.x, point.y);
    });
  }

  // Opens the checkout UI for this customer -- but only if the player is actually standing
  // at the register (see isPlayerNearRegister). If not, this just quietly does nothing;
  // the window will open the next time the player walks up and clicks the register (see
  // openRegisterWindow(), which re-calls this for whoever's at the front of the line).
  // Teleports the player behind the counter the first time this succeeds in a given
  // session (beginRegisterSession() no-ops if already mid-session), so this fires
  // regardless of which of the three paths led here (a new customer auto-triggering it,
  // a manual re-open, or serving the next customer in the onComplete callback below).
  startCheckout(customer) {
    if (!this.isPlayerNearRegister()) return;
    this.beginRegisterSession();

    this.checkoutWindow.openForCustomer(customer.cart, () => {
      customer.completeSale();
      this.customersServedThisShift += 1;
      this.registerLine.shift();
      this.layoutRegisterLine(); // shuffle everyone else forward one spot

      const nextCustomer = this.registerLine[0];
      nextCustomer?.resetPatience(); // bible Step 53: any sale resets the next in line
      if (nextCustomer) {
        this.startCheckout(nextCustomer);
      } else {
        // Nothing left to scan -- stay behind the counter (does NOT call
        // endRegisterSession(); see its own comment) with the idle register view.
        this.checkoutWindow.openIdle();
      }
    });
  }

  update(time, delta) {
    this.fixturePlacement.update(delta);
    // The Manual Toggle (bible Step 2) is supposed to freeze time "entirely" -- it used to
    // only stop the clock's own displayed tick, while customers kept moving and arrivals
    // continued to enter in the background.
    // Only true once a shift has actually been started, though -- isPaused is also the
    // (separate) pre-shift "store closed" state, during which free player movement is
    // intentional/unaffected (there are no customers to freeze yet anyway).
    const movementFrozen = (this.shiftClock.isPaused && this.shiftClock.started) ||
      this.fixturePlacement.active || this.startingShift || this.loadFailed;

    if (movementFrozen) {
      // Skipping update() entirely (rather than calling it and then zeroing velocity)
      // also freezes each customer's own internal state-machine timers, not just their
      // on-screen movement.
      this.player.sprite.body.setVelocity(0, 0);
      this.customers.forEach((customer) => customer.sprite.body.setVelocity(0, 0));
    } else {
      this.player.update();
      this.customers.forEach((customer) => customer.update(delta));

      if (this.carriedCrate) {
        this.carriedCrate.followCarrier(this.player.sprite);
      }
    }

    this.shiftClock.update(delta);
    this.spawnScheduledCustomers();

    // Soft Close (bible Step 11): once hour 12 hits, stop admitting new customers, but the
    // shift itself doesn't end until everyone already inside has actually been served.

    if (this.shiftClock.softClosed && this.customers.length === 0 && !this.shiftEnded) {
      this.endShift();
    }
  }

  // The shift ends silently (bible Step 43) -- no event, just the fact that doors are
  // locked and the last customer has been served. The actual "Finances Tab"/wages/calendar
  // system doesn't exist yet, so this reports only what the vertical slice really tracks.
  endShift() {
    this.shiftEnded = true;
    this.shiftClock.started = false;
    this.shiftClock.isPaused = true;
    this.shiftClock.notifyListeners();
    // Bible Step 52: the market only moves at End Day, so repricing is stress-free.
    this.market.advanceDay();
    this.playerState.notifyListeners();
    this.shiftSummaryWindow.show({
      creditsEarned: this.playerState.credits - this.creditsAtShiftStart,
      reputationGained: this.playerState.globalReputation - this.reputationAtShiftStart,
      customersServed: this.customersServedThisShift,
      customersTurnedAway: this.playerState.customersTurnedAway,
    });
  }

  async startNextShift() {
    if (this.startingShift || this.loadFailed || !this.canSaveOffShift()) return;
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
    this.shiftClock.startNewShift();
    this.shiftEnded = false;
    this.startingShift = false;
    this.shiftSummaryWindow.uiWindow.close();
    this.setSaveStatus("Checkpoint saved. Autosaving resumes after this shift.");
    this.customersServedThisShift = 0;
    this.playerState.customersTurnedAway = 0;
    this.creditsAtShiftStart = this.playerState.credits;
    this.reputationAtShiftStart = this.playerState.globalReputation;
    this.managerTablet.refreshLayoutPanels();
  }
}
