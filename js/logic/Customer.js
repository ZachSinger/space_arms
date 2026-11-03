import { pickRandomCustomerCharacter } from "./CustomerSprites.js";

const SPEED = 120; // px/sec
const CRATE_HIT_REPUTATION_PENALTY = 1;
// Bible Step 52: each customer accepts up to this random markup over the market price.
export const MIN_PRICE_TOLERANCE = 1.0;
export const MAX_PRICE_TOLERANCE = 1.3;
// Safety net: even with real pathfinding, if a customer somehow still can't reach the exit
// (e.g. an edge case the pathfinder didn't anticipate), don't let them block the shift from
// ever ending. They've already been paid/served by this point, so there's no harm in just
// letting them vanish instead of leaving them stuck in place indefinitely.
const LEAVING_TIMEOUT_MS = 6000;
// Same idea, applied to the shelf/register approach legs too: this is deliberately generous
// (far longer than any legitimate walk across this small map) so it only ever fires for a
// genuinely bad/unreachable destination, not just a slow pathfind. A real example this
// caught: a bug in how register queue slots were numbered could compute a destination point
// beyond the room's own wall, permanently wedging a customer there and blocking the shift
// from ever ending (since the store never drops to 0 customers). This is the standard
// "stuck/deadlock detection via lack of progress" pattern -- if an agent isn't getting
// anywhere, abandon the goal rather than trust the destination was valid forever.
const SEEKING_TIMEOUT_MS = 15000;

// Display size every customer sprite is forced to, regardless of a given facing's native
// pixel dimensions (side-profile crops are narrower than front/back ones) -- keeps a
// character's apparent size consistent as it turns instead of visibly popping/resizing.
// Square, not tall-and-thin: the Seventh Generation art's own crops are themselves roughly
// square (~515x520px), unlike the old Sixth Generation art this was originally tuned for --
// forcing the old narrow 28x48 box onto this art stretched every character noticeably.
export const SPRITE_DISPLAY_WIDTH = 46;
export const SPRITE_DISPLAY_HEIGHT = 48;

// Walks to a fixture, grabs a small randomized handful of items (snapshotting each item's
// price per bible Step 6), walks to the register, joins the (visually lined-up) queue, then
// waits for the scene to resolve a player-driven checkout (Customer owns the sale logic; the
// scene only owns when/whether the checkout window is currently visible, and where this
// customer should stand while waiting). Movement between those points uses real grid-based
// pathfinding (see GameScene.findPath / Pathfinder.js) so customers correctly route around
// obstacles like the shelf instead of walking straight at a point and getting stuck.
export class Customer {
  constructor({
    scene,
    fixture,
    shelfStandPoint,
    registerPoint,
    exitPoint,
    onReserveShelfSlot,
    onReserveQueueSlot,
    onReserveExitSlot,
    playerState,
    spawnBounds,
    onJoinQueue,
    onComplete,
  }) {
    this.scene = scene;
    this.fixture = fixture;
    // Where to walk when heading to the shelf -- a point just in front of it, not its exact
    // center, since the shelf is a solid obstacle (a target inside it would never actually
    // be reachable). Falls back to the fixture's own position if not provided.
    this.shelfStandPoint = shelfStandPoint || { x: fixture.x, y: fixture.y };
    this.registerPoint = registerPoint;
    // A single fixed point to walk back to and vanish at once finished here -- real
    // pathfinding means it doesn't need to depend on this customer's current position.
    this.exitPoint = exitPoint || { x: registerPoint.x, y: registerPoint.y };
    // Each of these claims a distinct waypoint near a shared destination (the shelf, the
    // register queue, the exit) so multiple customers converging on the same place around
    // the same time each walk toward their own spot instead of all aiming at the identical
    // pixel and jamming into each other before any of them can actually arrive.
    this.onReserveShelfSlot = onReserveShelfSlot;
    this.onReserveQueueSlot = onReserveQueueSlot;
    this.onReserveExitSlot = onReserveExitSlot;
    this.reservedTarget = null;
    this.playerState = playerState;
    this.onJoinQueue = onJoinQueue;
    this.onComplete = onComplete;

    this.state = "SEEK_SHELF";
    this.cart = []; // [{ itemId, price }]
    this.priceTolerance = Phaser.Math.FloatBetween(MIN_PRICE_TOLERANCE, MAX_PRICE_TOLERANCE);
    this.queueTarget = null; // set by the scene once this customer has a spot in line

    // Path-following state -- see setDestination()/followPath().
    this.path = [];
    this.destination = null;
    this.onArriveAtDestination = null;
    this.isDestroyed = false;

    // spawnBounds is in world (not viewport) pixels -- callers should pass
    // coordinates from within the current unlocked map, since the camera may
    // now show only part of a larger authored room (see RoomLayout.js).
    const bounds = spawnBounds || { xMin: 40, xMax: 120, yMin: 80, yMax: scene.scale.height - 80 };
    const spawnX = Phaser.Math.Between(bounds.xMin, bounds.xMax);
    const spawnY = Phaser.Math.Between(bounds.yMin, bounds.yMax);

    // A randomly-picked character's 4 facing textures (see CustomerSprites.js), swapped as
    // this customer turns to walk in a different direction -- see updateFacing().
    const character = pickRandomCustomerCharacter();
    this.facingTextures = character.facingTextures;
    this.factionId = character.factionId;
    this.currentFacing = "down";
    this.sprite = scene.add
      .image(spawnX, spawnY, this.facingTextures.down)
      .setDisplaySize(SPRITE_DISPLAY_WIDTH, SPRITE_DISPLAY_HEIGHT)
      .setDepth(2);
    scene.physics.add.existing(this.sprite);

    const shelfTarget = this.onReserveShelfSlot ? this.onReserveShelfSlot() : this.shelfStandPoint;
    this.setDestination(shelfTarget.x, shelfTarget.y, () => this.grabItems());
  }

  update(delta = 0) {
    if (this.isDestroyed) return; // guards against being updated the same frame it self-destructed

    switch (this.state) {
      case "SEEK_SHELF":
      case "SEEK_REGISTER":
        this.seekingTimer += delta;
        if (this.seekingTimer > SEEKING_TIMEOUT_MS) {
          // See SEEKING_TIMEOUT_MS -- this destination turned out to be unreachable
          // (shouldn't normally happen, but don't let it block the shift forever).
          console.warn(
            `Customer gave up seeking a destination (state=${this.state}); abandoning and leaving.`,
          );
          this.enterLeaving();
          break;
        }
        this.followPath();
        this.updateFacing();
        break;
      case "QUEUEING":
        this.followPath();
        // Face the register while waiting, rather than whichever way they last happened
        // to be walking -- looks right for a line of people facing the counter.
        this.updateFacing("up");
        break;
      case "LEAVING":
        this.leavingTimer += delta;
        if (this.leavingTimer > LEAVING_TIMEOUT_MS) {
          this.destroy(); // safety net -- see LEAVING_TIMEOUT_MS
          break;
        }
        this.followPath();
        if (!this.isDestroyed) this.updateFacing(); // followPath's arrival may have just destroyed this
        break;
    }
  }

  acceptsPrice(itemId) {
    const marketPrice = this.scene.market.getPrice(itemId);
    return this.scene.getStorePrice(itemId) <= marketPrice * this.priceTolerance;
  }

  // Grabs a small random handful (1-3) of items, picked from whichever slots still have
  // stock at a price this customer accepts, so a single customer's cart can contain
  // several different items -- this is what
  // actually exercises the checkout UI's scattered multi-card scanning (bible Step 54)
  // instead of every customer carrying exactly one unit of the same item. Full guaranteed
  // Primary/Optional shopping lists (bible Step 12) are a later, more deliberate pass.
  grabItems() {
    const desiredCount = Phaser.Math.Between(1, 3);
    let rejectedOnPrice = false;

    for (let i = 0; i < desiredCount; i += 1) {
      const stocked = this.fixture.getAvailableSlots();
      const candidates = stocked.filter((slot) => this.acceptsPrice(slot.itemId));
      if (candidates.length < stocked.length) rejectedOnPrice = true;
      if (candidates.length === 0) break;

      const slot = Phaser.Utils.Array.GetRandom(candidates);
      const itemId = this.fixture.takeItem(slot);
      if (!itemId) continue;

      this.cart.push({ itemId, price: this.scene.getStorePrice(itemId) });
    }

    if (this.cart.length === 0) {
      if (rejectedOnPrice) {
        this.scene.showFloatingText(this.sprite.x, this.sprite.y - 40, "Too expensive!", "#f59e0b");
      }
      // Another customer already in transit beat them to the last units; leave empty-handed
      // rather than queueing for a checkout with nothing to sell.
      this.enterLeaving();
      return;
    }

    this.playerState.notifyListeners();
    this.reservedTarget = this.onReserveQueueSlot
      ? this.onReserveQueueSlot()
      : this.registerPoint;
    this.setDestination(this.reservedTarget.x, this.reservedTarget.y, () => this.joinQueue());
    this.state = "SEEK_REGISTER";
  }

  joinQueue() {
    this.state = "QUEUEING";
    this.queueTarget = { x: this.registerPoint.x, y: this.registerPoint.y };
    this.onJoinQueue(this);
  }

  // Called by the scene whenever the line's layout changes (someone joins, or the front of
  // the line finishes and everyone shuffles forward).
  setQueueTarget(x, y) {
    this.queueTarget = { x, y };
    this.setDestination(x, y, () => {});
  }

  hitByCrate() {
    this.playerState.subReputation(CRATE_HIT_REPUTATION_PENALTY, this.factionId);
    const penalty = CRATE_HIT_REPUTATION_PENALTY;
    this.scene.showFloatingText(
      this.sprite.x,
      this.sprite.y - 40,
      `Store rep -${penalty}${this.factionId ? ` / Faction rep -${penalty}` : ""}`,
      "#ef4444",
    );
  }

  // Called by the scene once the player has scanned every item and clicked Complete Sale.
  completeSale() {
    const total = this.cart.reduce((sum, entry) => sum + entry.price, 0);
    this.playerState.addCredits(total);
    this.playerState.addReputation(1);
    this.enterLeaving();
  }

  enterLeaving() {
    // Reserve before flipping our own state, so this customer doesn't count itself as
    // one of the "others already leaving" (consistent with how reserveShelfSlot/
    // reserveQueueSlot exclude the caller too).
    const exitTarget = this.onReserveExitSlot ? this.onReserveExitSlot() : this.exitPoint;
    this.state = "LEAVING";
    this.leavingTimer = 0;
    this.setDestination(exitTarget.x, exitTarget.y, () => this.destroy());
  }

  // Called once whenever this customer decides on a new place to walk to. Computes a real
  // path via the scene's pathfinder (GameScene.findPath) so movement correctly routes
  // around obstacles. If no path is found (shouldn't normally happen for these fixed,
  // known-reachable points, but degrade gracefully rather than refuse to move at all), falls
  // back to a direct walk -- see followPath().
  setDestination(targetX, targetY, onArrive) {
    this.destination = { x: targetX, y: targetY };
    this.onArriveAtDestination = onArrive;
    this.seekingTimer = 0; // fresh attempt -- see SEEKING_TIMEOUT_MS

    const path = this.scene.findPath?.(this.sprite.x, this.sprite.y, targetX, targetY);
    this.path = path || [];
  }

  // Walks the precomputed path one waypoint at a time. Once every intermediate waypoint has
  // been consumed, finishes with one direct approach to the exact destination point (which
  // may not land precisely on a grid-cell center) before firing the real arrival callback.
  followPath() {
    if (this.path.length > 0) {
      const waypoint = this.path[0];
      this.moveToward(waypoint.x, waypoint.y, () => this.path.shift());
      return;
    }

    this.moveToward(this.destination.x, this.destination.y, () => this.onArriveAtDestination());
  }

  moveToward(targetX, targetY, onArrive) {
    const distance = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, targetX, targetY);

    if (distance < 6) {
      this.sprite.body.setVelocity(0, 0);
      onArrive();
      return;
    }

    const angle = Phaser.Math.Angle.Between(this.sprite.x, this.sprite.y, targetX, targetY);
    this.sprite.body.setVelocity(Math.cos(angle) * SPEED, Math.sin(angle) * SPEED);
  }

  // Swaps the sprite's texture to match either a forced facing (e.g. "up" while queueing,
  // so everyone faces the register) or whichever direction best matches current velocity.
  // No-ops if there's no meaningful movement and no forced facing, so an arrived/idle
  // customer keeps whatever direction they were last actually facing instead of flickering
  // back to a default. Re-applies the fixed display size every time since each facing's
  // source crop has a slightly different native size (see SPRITE_DISPLAY_WIDTH/HEIGHT).
  updateFacing(forcedFacing) {
    let facing = forcedFacing;

    if (!facing) {
      const { x: vx, y: vy } = this.sprite.body.velocity;
      if (Math.abs(vx) < 1 && Math.abs(vy) < 1) return;
      facing =
        Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? "left" : "right") : vy < 0 ? "up" : "down";
    }

    if (facing === this.currentFacing) return;
    this.currentFacing = facing;
    this.sprite
      .setTexture(this.facingTextures[facing])
      .setDisplaySize(SPRITE_DISPLAY_WIDTH, SPRITE_DISPLAY_HEIGHT);
  }

  destroy() {
    this.isDestroyed = true;
    this.sprite.destroy();
    this.onComplete(this);
  }
}
