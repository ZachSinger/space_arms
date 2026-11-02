import { WindowManager } from "../logic/WindowManager.js";
import { ManagerTablet } from "../logic/ManagerTablet.js";
import { PlayerState } from "../logic/PlayerState.js";
import { HUDController } from "../logic/HUDController.js";
import { Fixture } from "../logic/ShopInventory.js";
import { Customer, SPRITE_DISPLAY_HEIGHT } from "../logic/Customer.js";
import { Player } from "../logic/Player.js";
import { CheckoutWindow } from "../logic/CheckoutWindow.js";
import { TileRoom } from "../logic/TileRoom.js";
import { TILE_SIZE, getZone } from "../logic/RoomLayout.js";
import { ShiftClock } from "../logic/ShiftClock.js";
import { ShiftSummaryWindow } from "../logic/ShiftSummaryWindow.js";
import { findGridPath } from "../logic/Pathfinder.js";
import { database } from "./boot.js"; // the exported DatabaseManager singleton

const CUSTOMER_SPAWN_DELAY_MS = 4000;
// Caps how many customers can be physically inside the store at once. A full store means
// the next potential customer simply doesn't come in at all (not "delayed", gone for good)
// -- a slow/backed-up dealer genuinely loses that sale, same as if the shift had ended
// before they got to it.
const MAX_CUSTOMERS_IN_STORE = 6;

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

// Converts a 0-based "how many others are already here" count into a centered left/right
// zigzag offset multiplier: 0, +1, -1, +2, -2, +3, ... Used to spread multiple customers
// converging on the same shared point (the shelf, the exit) out sideways around a center
// line instead of all walking to the exact same pixel, which is what caused customers to
// collide and jam into each other there.
function spreadOffset(index) {
  if (index === 0) return 0;
  const magnitude = Math.ceil(index / 2);
  const sign = index % 2 === 1 ? 1 : -1;
  return sign * magnitude;
}

export class GameScene extends Phaser.Scene {
  constructor() {
    super("scene-game");
  }

  preload() {}

  create() {
    this.playerState = new PlayerState();
    this.shiftClock = new ShiftClock();
    this.hud = new HUDController(this.playerState, this.shiftClock);

    this.windowManager = new WindowManager();
    this.shiftSummaryWindow = new ShiftSummaryWindow(this.windowManager, () =>
      this.startNextShift(),
    );
    this.shiftEnded = false; // guards endShift() from firing more than once per shift
    this.customersServedThisShift = 0;
    this.creditsAtShiftStart = this.playerState.credits;
    this.reputationAtShiftStart = this.playerState.globalReputation;

    this.managerTablet = new ManagerTablet(this.windowManager, this.playerState);

    this.input.keyboard.on("keydown-I", () =>
      this.managerTablet.openWindow(),
    );

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

    this.fixture = new Fixture({
      id: "fixture_demo_01",
      displayType: "universal",
      x: zonePixelX + zonePixelW * 0.3,
      y: zonePixelY + zonePixelH * 0.4,
      gridDimensions: { w: 2, h: 2 },
      // Several different items (not just one) so a customer's cart can actually contain
      // a varied, multi-item haul -- see Customer.grabItems().
      slots: [
        { itemId: "wpn_rif_01", quantity: 4, x: 0, y: 0 },
        { itemId: "wpn_rif_02", quantity: 2, x: 1, y: 0 },
        { itemId: "wpn_rif_03", quantity: 3, x: 0, y: 1 },
        { itemId: "wpn_pis_01", quantity: 5, x: 1, y: 1 },
      ],
    });
    this.drawFixture(this.fixture);

    // Mark the shelf's full footprint as blocked for pathfinding (see getOccupiedCellKeys)
    // -- separate from TileRoom's own wall knowledge, since fixtures are a scene-level
    // concern, not something the room itself places.
    const fixtureWidth = this.fixture.gridDimensions.w * TILE_SIZE;
    const fixtureHeight = this.fixture.gridDimensions.h * TILE_SIZE;
    const shelfOccupiedCells = getOccupiedCellKeys(
      this.fixture.x,
      this.fixture.y,
      fixtureWidth,
      fixtureHeight,
    );
    this.blockedCells = new Set(shelfOccupiedCells);

    // Customers shop by walking up to a point just below (in front of) the shelf, not its
    // exact center -- now that the shelf is a solid obstacle, a target inside it would be
    // physically unreachable (same reasoning as registerQueueAnchor below). Critically,
    // this has to land in a grid CELL the pathfinder actually considers walkable, not just
    // a pixel that's technically clear of the shelf's edge: getOccupiedCellKeys marks a
    // cell blocked if the shelf overlaps it AT ALL (conservative, for the physics
    // collision), so a stand point placed just a few px below the shelf's raw pixel edge
    // can still fall inside a cell still marked blocked -- findPath then fails for that
    // destination and Customer falls back to an unguarded direct walk, which can clip
    // straight through the shelf. So: find the lowest grid row the shelf occupies, and
    // require the stand point to sit in the row below that entirely.
    const maxOccupiedRow = Math.max(...shelfOccupiedCells.map((key) => Number(key.split(",")[1])));
    const clearRowTopY = (maxOccupiedRow + 1) * TILE_SIZE;
    this.shelfStandPoint = {
      x: this.fixture.x,
      y: clearRowTopY + SPRITE_DISPLAY_HEIGHT / 2 + 8,
    };

    this.registerPoint = {
      x: zonePixelX + zonePixelW * 0.7,
      // Moved further from the south wall (vs. an earlier 0.35) now that the taller
      // customer sprites need more spacing per queue slot (see registerQueueSpacing) --
      // otherwise a full MAX_CUSTOMERS_IN_STORE-length queue would run out of room before
      // the wall and jam the same way a too-small shelf clearance did (see shelfStandPoint).
      // Not moved all the way up against the north wall either -- still needs clearance
      // there too.
      y: zonePixelY + zonePixelH * 0.22,
    };
    this.drawRegister(this.registerPoint);

    // Customers queue in front of the register counter, not on top of it or beside it --
    // the register sprite is drawn front-facing, so "in front" means below it (south),
    // matching the direction a customer would actually approach and face the counter from.
    // The register is deliberately placed with plenty of clearance to the south wall (see
    // above) so a multi-person queue has somewhere to physically stand now that wall
    // collision exists -- too close to the wall and customers beyond the first 1-2 in line
    // would be shoved into it with nowhere to go.
    this.registerQueueAnchor = {
      x: this.registerPoint.x,
      y: this.registerPoint.y + 48,
    };
    // Must be at least the sprite's own height, or adjacent queued customers' bodies
    // overlap each other and jam instead of standing cleanly spaced apart.
    this.registerQueueSpacing = SPRITE_DISPLAY_HEIGHT + 2;

    this.customerSpawnBounds = {
      xMin: zonePixelX + TILE_SIZE,
      xMax: zonePixelX + TILE_SIZE * 1.5,
      yMin: zonePixelY + TILE_SIZE,
      yMax: zonePixelY + zonePixelH - TILE_SIZE,
    };
    // Where customers walk back to and vanish once their business here is done. A single
    // fixed point (rather than "wherever you currently are") now that real pathfinding
    // exists to route them there regardless of what's in the way.
    this.exitPoint = {
      x: this.customerSpawnBounds.xMin,
      y: (this.customerSpawnBounds.yMin + this.customerSpawnBounds.yMax) / 2,
    };

    this.checkoutWindow = new CheckoutWindow(this.windowManager);
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
    this.cameras.main.startFollow(this.player.sprite, true, 0.1, 0.1);

    // Debug-only: proves the expand-the-store mechanism end-to-end until a
    // real purchase UI exists. Remove once that UI is built.
    this.input.keyboard.on("keydown-U", () => this.debugUnlockExpansion());

    // The shift clock's "Manual Toggle" (bible Step 2) -- freezes time entirely so the
    // player can think without pressure, without a variable speed control.
    this.input.keyboard.on("keydown-P", () => this.shiftClock.togglePause());

    this.customers = [];
    this.spawnTimer = this.time.addEvent({
      delay: CUSTOMER_SPAWN_DELAY_MS,
      loop: true,
      callback: () => this.spawnCustomer(),
    });
    this.spawnCustomer(); // first customer immediately so the loop is visible right away

    this.events.once("shutdown", () => {
      this.managerTablet.disableInventoryNavigation();
      this.spawnTimer.remove();
    });
  }

  setupCamera() {
    const bounds = this.room.getCameraBounds();
    this.cameras.main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
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
    const bounds = this.room.unlockZone("expansion_a");
    this.cameras.main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    console.log("Unlocked expansion_a; camera bounds now", bounds);
  }

  drawFixture(fixture) {
    const width = fixture.gridDimensions.w * TILE_SIZE;
    const height = fixture.gridDimensions.h * TILE_SIZE;
    const image = this.add
      .image(fixture.x, fixture.y, "shelf_universal_01")
      .setDisplaySize(width, height)
      .setDepth(2);
    this.obstacleGroup.add(image); // solid -- customers walk up to it, not through it
  }

  drawRegister(point) {
    const sprite = this.add
      .image(point.x, point.y, "register_01")
      .setDisplaySize(90, 75)
      .setDepth(2)
      .setInteractive({ useHandCursor: true });
    sprite.on("pointerdown", () => this.openRegisterWindow());
  }

  // Clicking the register re-opens the checkout window if the player closed it (it has no
  // other way to come back otherwise), or just brings it to front if it's already open.
  // Re-opening always restarts that customer's scan progress from scratch, since nothing
  // outside the DOM currently tracks which individual items were already scanned.
  openRegisterWindow() {
    const isHidden = this.checkoutWindow.uiWindow.element.classList.contains("hidden");
    if (!isHidden) {
      this.checkoutWindow.uiWindow.openWindow(); // already open; just focus it
      return;
    }

    const frontCustomer = this.registerLine[0];
    if (!frontCustomer) return; // nobody waiting; nothing to reopen
    this.startCheckout(frontCustomer);
  }

  spawnCustomer() {
    if (this.customers.length >= MAX_CUSTOMERS_IN_STORE) {
      // Store's at capacity -- this customer never comes in at all, not merely delayed.
      this.playerState.customersTurnedAway += 1;
      return;
    }

    const slot = this.fixture.findAvailableSlot();
    if (!slot) return; // out of stock; skip spawn (basic version of bible Step 16)

    const customer = new Customer({
      scene: this,
      fixture: this.fixture,
      shelfStandPoint: this.shelfStandPoint,
      registerPoint: this.registerQueueAnchor,
      exitPoint: this.exitPoint,
      onReserveShelfSlot: () => this.reserveShelfSlot(),
      onReserveQueueSlot: () => this.reserveQueueSlot(),
      onReserveExitSlot: () => this.reserveExitSlot(),
      playerState: this.playerState,
      spawnBounds: this.customerSpawnBounds,
      onJoinQueue: (arrivingCustomer) => this.handleJoinQueue(arrivingCustomer),
      onComplete: (completedCustomer) => {
        this.customers = this.customers.filter(
          (candidate) => candidate !== completedCustomer,
        );
      },
    });
    this.customerGroup.add(customer.sprite);
    this.customers.push(customer);
  }

  // Only the customer at the front of the line (index 0) has their cart shown in the
  // checkout window; everyone else waits in a visible single-file line behind them (a
  // basic version of bible Step 53 -- patience/emote bubbles are still a later pass).
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
    return {
      x: this.registerQueueAnchor.x,
      y: this.registerQueueAnchor.y + this.registerQueueSpacing * index,
    };
  }

  // Same fix, applied to the shelf: spreads multiple simultaneous shoppers out
  // horizontally along the front of it instead of making them all walk to the exact same
  // pixel (shelfStandPoint), which is what let them jam into each other there too.
  reserveShelfSlot() {
    const inFlight = this.customers.filter((c) => c.state === "SEEK_SHELF").length;
    const spacing = 36;
    return {
      x: this.shelfStandPoint.x + spreadOffset(inFlight) * spacing,
      y: this.shelfStandPoint.y,
    };
  }

  // Same fix again, applied to the exit: spreads multiple simultaneous departures out
  // vertically along the exit corridor instead of making them all walk to the exact same
  // pixel (exitPoint), which is what let customers block each other from ever leaving.
  reserveExitSlot() {
    const inFlight = this.customers.filter((c) => c.state === "LEAVING").length;
    const spacing = SPRITE_DISPLAY_HEIGHT + 4;
    return {
      x: this.exitPoint.x,
      y: this.exitPoint.y + spreadOffset(inFlight) * spacing,
    };
  }

  // Assigns each waiting customer a spot strung out below the register (in front of the
  // counter, matching the sprite's facing direction), so they never stand on top of
  // each other.
  layoutRegisterLine() {
    this.registerLine.forEach((customer, index) => {
      const y = this.registerQueueAnchor.y + this.registerQueueSpacing * index;
      customer.setQueueTarget(this.registerQueueAnchor.x, y);
    });
  }

  startCheckout(customer) {
    this.checkoutWindow.openForCustomer(customer.cart, () => {
      customer.completeSale();
      this.customersServedThisShift += 1;
      this.registerLine.shift();
      this.layoutRegisterLine(); // shuffle everyone else forward one spot

      const nextCustomer = this.registerLine[0];
      if (nextCustomer) this.startCheckout(nextCustomer);
    });
  }

  update(time, delta) {
    this.player.update();
    this.customers.forEach((customer) => customer.update(delta));

    this.shiftClock.update(delta);

    // Soft Close (bible Step 11): once hour 12 hits, stop admitting new customers, but the
    // shift itself doesn't end until everyone already inside has actually been served.
    if (this.shiftClock.softClosed && this.spawnTimer.paused === false) {
      this.spawnTimer.paused = true;
    }

    if (this.shiftClock.softClosed && this.customers.length === 0 && !this.shiftEnded) {
      this.endShift();
    }
  }

  // The shift ends silently (bible Step 43) -- no event, just the fact that doors are
  // locked and the last customer has been served. The actual "Finances Tab"/wages/calendar
  // system doesn't exist yet, so this reports only what the vertical slice really tracks.
  endShift() {
    this.shiftEnded = true;
    this.shiftSummaryWindow.show({
      creditsEarned: this.playerState.credits - this.creditsAtShiftStart,
      reputationGained: this.playerState.globalReputation - this.reputationAtShiftStart,
      customersServed: this.customersServedThisShift,
      customersTurnedAway: this.playerState.customersTurnedAway,
    });
  }

  startNextShift() {
    this.shiftClock.startNewShift();
    this.shiftEnded = false;
    this.customersServedThisShift = 0;
    this.playerState.customersTurnedAway = 0;
    this.creditsAtShiftStart = this.playerState.credits;
    this.reputationAtShiftStart = this.playerState.globalReputation;
    this.spawnTimer.paused = false;
  }
}
