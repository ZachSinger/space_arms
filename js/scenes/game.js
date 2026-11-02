import { WindowManager } from "../logic/WindowManager.js";
import { ManagerTablet } from "../logic/ManagerTablet.js";
import { PlayerState } from "../logic/PlayerState.js";
import { HUDController } from "../logic/HUDController.js";
import { Fixture } from "../logic/ShopInventory.js";
import { Customer, SPRITE_DISPLAY_WIDTH, SPRITE_DISPLAY_HEIGHT } from "../logic/Customer.js";
import { Player } from "../logic/Player.js";
import { Crate, INTERACT_RANGE } from "../logic/Crate.js";
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

// How much stock a single ordered crate contains, and what it costs the player (a fraction
// of the item's own retail baseCost -- standing in for a real wholesale/supplier pricing
// model, which doesn't exist yet; see TODO.md). Exported so the Supply tab (ManagerTablet/
// SupplyRenderer) can display the same price it'll actually be charged.
export const RESTOCK_QUANTITY = 5;
export const WHOLESALE_FACTOR = 0.5;

// How close the player has to be standing to actually operate the register -- generous on
// purpose (bigger than Crate's own INTERACT_RANGE, and bigger than the register's own
// footprint) so "reasonably close" always counts, regardless of the exact angle the
// player approaches from (early tuning measured from registerQueueAnchor made a
// straight-on south approach trivially pass, but anything off-angle could easily exceed a
// tighter radius despite looking right next to it).
const REGISTER_INTERACT_RANGE = 130;
const REGISTER_WIDTH = 90;
const REGISTER_HEIGHT = 75;

// How close the player has to be to shelfStandPoint to deliver a carried crate. Kept
// separate from Crate's own INTERACT_RANGE (which governs picking a crate up off the
// Loading Pad, and works fine tight) because shelfStandPoint is one single fixed pixel
// in front of the shelf -- a tight radius around it meant approaching from almost any
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

    // Where the player is teleported to while operating the register (bible-style "behind
    // the counter"), facing south toward it -- there genuinely isn't room to walk there
    // normally (the register sits close against the north wall, see registerPoint's own
    // comment), so this is only ever reached via beginRegisterSession()'s teleport, not
    // WASD. Positioned at the midpoint of whatever sliver of floor exists between the
    // wall's inner edge and the register's own top edge, so it's centered in that gap
    // regardless of exactly how tight it is.
    const wallInnerEdgeY = zonePixelY + TILE_SIZE;
    const registerTopEdgeY = this.registerPoint.y - REGISTER_HEIGHT / 2;
    this.behindRegisterPoint = {
      x: this.registerPoint.x,
      y: (wallInnerEdgeY + registerTopEdgeY) / 2,
    };
    // Whether the player is currently "inside" a register-operating session (teleported
    // behind the counter, input frozen) -- see beginRegisterSession/endRegisterSession.
    this.operatingRegister = false;
    this.playerPositionBeforeRegister = null;

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
    // The register has its own static body (see drawRegister) -- not part of obstacleGroup,
    // since that's shared with customerGroup's collider and customers need to stand almost
    // flush against it to queue. The player has no such constraint.
    this.physics.add.collider(this.player.sprite, this.registerSprite);
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
    this.restockCrates = []; // crates sitting at the Loading Pad, not yet picked up
    this.carriedCrate = null; // the one crate the player is currently hauling, if any

    // Single interact key for both ends of hauling a crate: pick one up near the Loading
    // Pad, then press it again near the shelf to deliver -- see handleInteract().
    this.input.keyboard.on("keydown-E", () => this.handleInteract());

    // Constructed here (not earlier in create()) because its Supply tab reads this.fixture
    // immediately on construction (via SupplyRenderer -> getRestockableItems()) -- it has
    // to already exist.
    this.managerTablet = new ManagerTablet(this.windowManager, this.playerState, this);
    this.input.keyboard.on("keydown-I", () => this.managerTablet.openWindow());

    // Debug-only: proves the expand-the-store mechanism end-to-end until a
    // real purchase UI exists. Remove once that UI is built.
    this.input.keyboard.on("keydown-U", () => this.debugUnlockExpansion());

    // The shift clock's "Manual Toggle" (bible Step 2) -- freezes time entirely so the
    // player can think without pressure, without a variable speed control.
    this.input.keyboard.on("keydown-P", () => this.shiftClock.togglePause());

    this.customers = [];
    // Starts paused -- the store opens for the day only once the player presses START
    // SHIFT on the pre-shift window below (or "START NEXT SHIFT" at the end of a
    // previous one, via startNextShift()), not the instant the scene loads.
    this.spawnTimer = this.time.addEvent({
      delay: CUSTOMER_SPAWN_DELAY_MS,
      loop: true,
      paused: true,
      callback: () => this.spawnCustomer(),
    });

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

  // What ordering RESTOCK_QUANTITY more of this item costs -- shared by the Supply tab
  // (so it can display the real price) and orderRestockCrate (so it charges that same
  // price). See WHOLESALE_FACTOR's comment for why this isn't the item's full retail cost.
  restockCost(item) {
    return Math.round(item.baseCost * WHOLESALE_FACTOR * RESTOCK_QUANTITY);
  }

  // Everything the Supply tab needs to render: every distinct item this fixture is set up
  // to sell, its current on-shelf quantity, and what restocking it would cost. Only items
  // the shelf already stocks can be restocked for now -- introducing a brand new item type
  // to a fixture is Build Mode/fixture reconfiguration, a separate later feature.
  getRestockableItems() {
    const seenItemIds = new Set();
    const entries = [];

    for (const slot of this.fixture.slots) {
      if (seenItemIds.has(slot.itemId)) continue;
      seenItemIds.add(slot.itemId);

      const item = database.getItem(slot.itemId);
      entries.push({ item, quantity: slot.quantity, cost: this.restockCost(item) });
    }

    return entries;
  }

  // Spends credits and spawns a physical crate at the Loading Pad (bible Step 10) -- it
  // isn't actually restocked until the player hauls it to the shelf, see handleInteract().
  // Returns false (no-op) if the player can't afford it or this fixture doesn't stock the
  // requested item at all.
  orderRestockCrate(itemId) {
    const item = database.getItem(itemId);
    if (!item) return false;

    const stocksThisItem = this.fixture.slots.some((slot) => slot.itemId === itemId);
    if (!stocksThisItem) return false;

    const cost = this.restockCost(item);
    if (this.playerState.credits < cost) return false;

    this.playerState.spendCredits(cost);

    // Offset each new crate a little further along the pad so repeated orders don't all
    // stack exactly on top of each other while waiting to be hauled in.
    const offsetIndex = this.restockCrates.length;
    const spawnX = this.loadingPadSpawnPoint.x + (offsetIndex % 3) * 48 - 48;
    const spawnY = this.loadingPadSpawnPoint.y + Math.floor(offsetIndex / 3) * 48;

    const crate = new Crate(this, itemId, RESTOCK_QUANTITY, spawnX, spawnY);
    this.restockCrates.push(crate);
    return true;
  }

  // The single keydown-E handler for all player interactions: delivers a carried crate if
  // holding one, otherwise tries (in order) picking up a nearby crate, exiting the
  // register if already operating it, or entering it if close enough. One shared key
  // rather than separate ones per action since at most one of these is ever actually
  // reachable/relevant at a time in practice.
  handleInteract() {
    if (this.carriedCrate) {
      this.tryDeliverCarriedCrate();
      return;
    }

    if (this.tryPickUpNearestCrate()) return;

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

  // Returns true if a crate was actually picked up, so handleInteract can fall through to
  // trying other interactions (the register) when there's nothing to pick up here.
  tryPickUpNearestCrate() {
    const { x, y } = this.player.sprite;
    let nearest = null;
    let nearestDistance = INTERACT_RANGE;

    for (const crate of this.restockCrates) {
      const distance = crate.distanceTo(x, y);
      if (distance <= nearestDistance) {
        nearest = crate;
        nearestDistance = distance;
      }
    }

    if (!nearest) return false;

    this.restockCrates = this.restockCrates.filter((crate) => crate !== nearest);
    this.carriedCrate = nearest;
    this.carriedCrate.isCarried = true;

    const item = database.getItem(nearest.itemId);
    this.showFloatingText(x, y - 40, `Picked up ${item.name} x${nearest.quantity}`, "#38bdf8");
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
    // Measured from shelfStandPoint (the same "front of the shelf" approach point
    // customers use), not the fixture's raw center -- the shelf itself is a solid
    // obstacle, so the player can never actually stand within INTERACT_RANGE of its
    // center, only of the clear space in front of it.
    const distance = Phaser.Math.Distance.Between(
      this.player.sprite.x,
      this.player.sprite.y,
      this.shelfStandPoint.x,
      this.shelfStandPoint.y,
    );
    if (distance > SHELF_INTERACT_RANGE) {
      this.showFloatingText(
        this.player.sprite.x,
        this.player.sprite.y - 40,
        "Too far from the shelf to deliver",
        "#94a3b8",
      );
      return;
    }

    this.fixture.restock(crate.itemId, crate.quantity);
    const item = database.getItem(crate.itemId);
    this.showFloatingText(
      this.player.sprite.x,
      this.player.sprite.y - 40,
      `Restocked ${item.name} +${crate.quantity}`,
      "#10b981",
    );
    crate.destroy();
    this.carriedCrate = null;
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
      .setDisplaySize(REGISTER_WIDTH, REGISTER_HEIGHT)
      .setDepth(2)
      .setInteractive({ useHandCursor: true });
    sprite.on("pointerdown", () => this.openRegisterWindow());

    // Deliberately NOT added to obstacleGroup (shared with customerGroup's collider) --
    // customers need to stand almost flush against its front edge to queue (see
    // registerQueueAnchor), and a body solid to THEM would block that. The player has no
    // such constraint, so give it its own static body and collide only the player against
    // it (see the player setup below, where this.registerSprite is now available).
    this.physics.add.existing(sprite, true);
    this.registerSprite = sprite;
  }

  // Walking up and pressing E / clicking the register always lets the player step behind
  // the counter (bible-style), regardless of whether there's actually a customer waiting
  // right now -- only the item-scanning window itself is conditional on there being
  // something to scan. If a customer does show up later while already standing there (see
  // handleJoinQueue), the scan window opens automatically. Requires the player to
  // actually be near the register -- now that a real player character exists, operating
  // it from anywhere on the map doesn't make sense anymore.
  openRegisterWindow() {
    if (!this.isPlayerNearRegister()) return;

    this.beginRegisterSession(); // no-ops if already in one

    const frontCustomer = this.registerLine[0];
    if (frontCustomer) this.startCheckout(frontCustomer); // re-renders/refocuses if already open
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

  // Teleports the player behind the register counter, facing it, and takes over completely
  // until the session ends (see endRegisterSession). There's no real floor space to stand
  // there normally -- the sliver of floor between the wall and the register's own top edge
  // (see behindRegisterPoint's comment) is only ~11px, far less than the player's own 40px
  // body height, so standing there necessarily overlaps BOTH solids. Input alone being
  // frozen wouldn't stop Arcade from still trying to separate that overlap every physics
  // step regardless of velocity -- the body itself has to be disabled too, which also
  // conveniently answers "how do we avoid unintended collision problems here" for free (a
  // disabled body does not collide, period). No-ops if already in a session, so callers
  // can call this unconditionally.
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
    this.player.sprite.body.enable = true;
    this.player.inputEnabled = true;
    this.player.teleportTo(
      this.playerPositionBeforeRegister.x,
      this.playerPositionBeforeRegister.y,
    );
    this.playerPositionBeforeRegister = null;
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
    const spacing = SPRITE_DISPLAY_WIDTH + 8;
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
      if (nextCustomer) {
        this.startCheckout(nextCustomer);
      } else {
        // Nothing left to scan -- hide the window, but stay standing behind the counter
        // (does NOT call endRegisterSession(); see its own comment for why).
        this.checkoutWindow.uiWindow.close();
      }
    });
  }

  update(time, delta) {
    this.player.update();
    this.customers.forEach((customer) => customer.update(delta));

    if (this.carriedCrate) {
      this.carriedCrate.followCarrier(this.player.sprite);
    }

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
