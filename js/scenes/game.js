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
import { RecentDiagnostics } from "../debug/RecentDiagnostics.js";
import { DebugTools } from "../debug/DebugTools.js";
import { Events, GAME_EVENTS } from "../core/Events.js";
import { ControlMode, CONTROL_MODES } from "../input/ControlMode.js";
import { InteractableRegistry } from "../interaction/InteractableRegistry.js";
import { InteractionSystem } from "../interaction/InteractionSystem.js";
import { ModuleHost } from "../modules/GameModules.js";
import {
  DRONE_TERMINAL_PLATFORM_SPRITE,
  DRONE_TERMINAL_SCREEN_SPRITE,
  REMOTE_ORDER_CRATE_SPRITES,
} from "../modules/droneDeliveries/DroneTerminalArt.js";
/** @typedef {import("../logic/ShelfFixture.js").ShelfFixture} ShelfFixture */
import { SPRITE_DISPLAY_WIDTH, SPRITE_DISPLAY_HEIGHT } from "../logic/Customer.js";
import { Player } from "../logic/Player.js";
import { sortPeopleByFeet } from "../world/Depth.js";
import { GoBacksBadge } from "../world/GoBacksBadge.js";
import { confirmReturnToMainMenu } from "../world/MainMenuPrompt.js";
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
import { Messages } from "../world/Messages.js";
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
import { CatalogSystem } from "../systems/CatalogSystem.js";
import { ReputationPenalties } from "../systems/ReputationPenalties.js";
import { CrateWorld } from "../world/CrateWorld.js";
import { Navigation } from "../world/Navigation.js";
import { CheckoutWindow } from "../logic/CheckoutWindow.js";
import { PlayerControls } from "../input/PlayerControls.js";
import { database } from "./boot.js"; // the exported DatabaseManager singleton
import { installSceneTextSize } from "../logic/GameTextSize.js";
import { gameRandom, randomSeed } from "../core/Random.js";
import { PauseMenu } from "../logic/PauseMenu.js";
import { setSfxPaused } from "../logic/Sfx.js";

// How far below the doorway cell's center a customer's feet must be for their head to stay
// under the top of the door opening (opening top is 24px above center, heads ~42px tall,
// tallest art reaches 50px).
const DOORWAY_FEET_OFFSET = 30;

/**
 * The playable shop scene ("scene-game"), started from the title scene.
 * Owns every fixture, crate, and customer; all are torn down on scene shutdown.
 */
export class GameScene extends Phaser.Scene {
  // --- Scene setup ---

  constructor() {
    super("scene-game");
  }

  preload() {
    for (const sprite of [DRONE_TERMINAL_PLATFORM_SPRITE, DRONE_TERMINAL_SCREEN_SPRITE]) {
      this.load.spritesheet(sprite.key, sprite.path, {
        frameWidth: sprite.frameWidth,
        frameHeight: sprite.frameHeight,
      });
    }
    for (const sprite of Object.values(REMOTE_ORDER_CRATE_SPRITES)) {
      this.load.spritesheet(sprite.key, sprite.path, {
        frameWidth: sprite.frameWidth,
        frameHeight: sprite.frameHeight,
      });
    }
  }

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
    this.gamePaused = false;
    this.worldElapsedMs = 0;
    this.pausedDomAnimations = [];
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
    this.catalogSystem = new CatalogSystem(this);
    this.catalogSystem.recalculateActiveFactions();
    this.shiftClock = new ShiftClock();
    this.customerFlow = new CustomerFlow(this);
    this.hud = new HUDController(
      this.gameState,
      this.shiftClock,
      () => this.shift.start(),
      () => this.saves.saveManually(),
      () => this.shift.endDay(),
      () => this.customerFlow.toggleTemporaryClosure(),
      () => confirmReturnToMainMenu(this),
    );

    this.windowManager = new WindowManager();
    this.shift = new ShiftSystem(this);
    this.staffSystem = new StaffSystem(this);

    this.buildMap();
    this.buildCheckout();
    this.buildPeople();
    this.buildCrates();
    this.listenForPause();
    this.buildSystems();
    this.cleanUpOnShutdown();
    this.startSession();
  }

  // Room, doors, areas, fixtures, and the walk grid.
  buildMap() {
    // Shop map: the authored tile room (see RoomLayout.js).
    this.room = new TileRoom(this);
    this.cameraRig = new CameraRig(this);

    // Static obstacles besides the room's own walls (shelves and other fixtures).
    this.obstacleGroup = this.physics.add.staticGroup();

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
  }

  // The register and the shelf window.
  buildCheckout() {
    this.checkoutSystem = new CheckoutSystem(this);
    this.checkoutWindow = new CheckoutWindow(this.windowManager);
    this.checkoutWindow.getRegisterScreenArea = () => this.checkoutSystem.getRegisterScreenArea();
    this.shelfStockingWindow = new ShelfStockingWindow(this);
  }

  // Physics groups for customers and staff, and the player.
  buildPeople() {
    const salesFloor = getZone("sales_floor");
    const zonePixelX = salesFloor.gridX * TILE_SIZE;
    const zonePixelY = salesFloor.gridY * TILE_SIZE;
    const zonePixelW = salesFloor.gridW * TILE_SIZE;
    const zonePixelH = salesFloor.gridH * TILE_SIZE;

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
  }

  // The Loading Pad, crate physics, and the crate bar.
  buildCrates() {
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
      people: [this.employeeGroup, this.player.sprite],
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
  }

  // Pausing a started shift freezes the register, held buttons, and crates.
  listenForPause() {
    this.shiftClock.subscribe(({ started, isPaused }) => {
      const paused = (started && isPaused) || Boolean(this.pauseMenu?.isOpen);
      this.setGamePaused(paused);
      if (started && isPaused) this.pauseMenu?.open();
    });
  }

  setGamePaused(paused, { shutdown = false } = {}) {
    if (paused === this.gamePaused) return;
    this.gamePaused = paused;
    if (!shutdown) {
      this.checkoutWindow.setPaused(paused);
      this.crateSystem.setMotionPaused(paused);
      this.messages.timers.setPaused(paused);
    }
    setSfxPaused(paused);
    this.time.paused = paused;
    document.body.classList.toggle("game-paused", paused);
    if (paused) {
      this.controls.cancelPresses();
      this.shelfStockingWindow.stopHolding();
      this.physics.world.pause();
      this.anims.pauseAll();
      this.tweens.pauseAll();
      this.sound.pauseAll();
      this.pausedDomAnimations = document.getAnimations().filter((animation) => animation.playState === "running");
      this.pausedDomAnimations.forEach((animation) => animation.pause());
    } else {
      // Scene plugins tear themselves down before our shutdown listener runs.
      if (!shutdown) {
        this.physics.world.resume();
        this.tweens.resumeAll();
      }
      this.anims.resumeAll();
      this.sound.resumeAll();
      this.pausedDomAnimations.forEach((animation) => animation.play());
      this.pausedDomAnimations = [];
    }
  }

  // Modules, controls, the tablet, debug tools, and event wiring.
  buildSystems() {
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
    this.diagnostics = new RecentDiagnostics(this);
    this.pauseMenu = new PauseMenu(this);
    // REAL games run without the debug recorder; every call site uses debugInfo?.
    this.debugInfo = this.realMode ? null : new DebugInfo(this);
    this.reputationPenalties = new ReputationPenalties(this);
    this.reputationPenalties.listen(this.eventBus);
    this.eventBus.on(GAME_EVENTS.CUSTOMER_LEFT_ANGRY, ({ customer, cart }) => {
      this.checkoutSystem.handleAngryLeave(customer, cart);
    });
    this.shift.listen(this.eventBus);
    this.debugInfo?.listen(this.eventBus);
    // Debug tools are keyboard shortcuts plus HUD buttons; REAL games remove them all.
    DebugTools.showButtons(!this.realMode);
    this.debugTools = this.realMode ? null : new DebugTools(this);
    this.debugTools?.install();
  }

  cleanUpOnShutdown() {
    this.events.once("shutdown", () => {
      this.eventBus.clear();
      this.debugInfo?.destroy();
      this.debugTools?.destroy();
      this.diagnostics.destroy();
      this.pauseMenu.destroy();
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
  }

  // Loads the save or test area, then starts autosave and live refreshes.
  startSession() {
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
    this.goBacksBadge = new GoBacksBadge(this);
    this.gameState.subscribe(() => {
      this.saves.requestAutosave();
      this.fixtureViews.refreshStockDisplays();
      this.saves.updateControls();
      this.goBacksBadge.refresh();
    });
    this.shiftClock.subscribe(() => this.saves.updateControls());
  }

  // --- Frame update and shift flow ---

  update(time, delta) {
    this.controls.handleGamepad(time, delta);
    if (this.gamePaused) return;
    this.worldElapsedMs += delta;
    if (this.controlMode.getMode() !== CONTROL_MODES.PAUSED) this.fixturePlacement.update();
    this.crateWorld.update(delta);
    // Customers and employees hold the public door open on their way out.
    this.storeDoorAnimation.update(delta, [
      ...this.customers.map((customer) =>
        !customer.isDestroyed && customer.state === "LEAVING" ? customer.sprite : null),
      ...this.employees.map((employee) =>
        !employee.isDestroyed && employee.state === "TO_EXIT" ? employee.sprite : null),
    ]);
    this.areas.update(delta);
    // Pausing a started shift freezes time entirely: customers and arrivals included.
    // Before the shift starts the clock also reads as paused, but the player moves freely.
    const mode = this.controlMode.getMode();
    const movementFrozen = (this.shiftClock.isPaused && this.shiftClock.started) ||
      mode === CONTROL_MODES.LOADING;
    sortPeopleByFeet(this);

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
    this.goBacksBadge.position();
    this.controls.updatePresses();
    this.interactionSystem.updateHint();
    this.crateSystem.updateCrateMarker();
    for (const fixture of this.fixtures.shelves()) {
      fixture.stockDisplay?.update(this.worldElapsedMs);
      fixture.facingLight?.update(this.worldElapsedMs);
    }
    this.customerFlow.refreshPool(delta);
    this.customerFlow.spawnScheduled();
    if (!movementFrozen && !this.fixturePlacement.active) this.checkoutSystem.autoPackGoBacks(time);
    this.shift.update();
  }
}
