import { pickRandomCustomerCharacter } from "./CustomerSprites.js";
import { createCustomerBuyList } from "./CustomerBuyLists.js";

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

// Bible Steps 53/12/51: how long a queued customer waits (real ms, paused with the game)
// before leaving angry, and what that costs.
export const PATIENCE_MS = 40000;
const ANGRY_REPUTATION_PENALTY = 1;
// Bubble escalation: [minimum remaining fraction, glyph, fill color].
const PATIENCE_LEVELS = [
  [0.6, "...", 0x22c55e],
  [0.3, "!", 0xf59e0b],
  [0, "!!", 0xef4444],
];

export function getPatienceLevel(fraction) {
  return PATIENCE_LEVELS.findIndex(([minimum]) => fraction > minimum || minimum === 0);
}

// Display size every customer sprite is forced to, regardless of a given facing's native
// pixel dimensions (side-profile crops are narrower than front/back ones) -- keeps a
// character's apparent size consistent as it turns instead of visibly popping/resizing.
// Square, not tall-and-thin: the Seventh Generation art's own crops are themselves roughly
// square (~515x520px), unlike the old Sixth Generation art this was originally tuned for --
// forcing the old narrow 28x48 box onto this art stretched every character noticeably.
export const SPRITE_DISPLAY_WIDTH = 46;
export const SPRITE_DISPLAY_HEIGHT = 48;

// Builds a faction-specific Primary/Optional buy list from assigned shelf item types, visits
// the shelves holding those items, snapshots purchased prices, then queues for player-driven
// checkout. Movement uses real grid-based pathfinding (GameScene.findPath / Pathfinder.js)
// so customers correctly route around fixtures instead of walking straight into them.
export class Customer {
  constructor({
    scene,
    getShoppingPlan,
    registerPoint,
    exitPoint,
    onReserveShelfSlot,
    onReserveQueueSlot,
    onReserveExitSlot,
    playerState,
    spawnBounds,
    factionId,
    onJoinQueue,
    onLeaveAngry,
    onComplete,
  }) {
    this.scene = scene;
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
    this.onLeaveAngry = onLeaveAngry;
    this.onComplete = onComplete;

    this.state = "SEEK_SHELF";
    this.cart = []; // [{ itemId, price }]
    this.priceTolerance = Phaser.Math.FloatBetween(MIN_PRICE_TOLERANCE, MAX_PRICE_TOLERANCE);
    this.queueTarget = null; // set by the scene once this customer has a spot in line
    this.patienceRemainingMs = null; // only ticks once queued -- see joinQueue()
    this.patienceBubble = null;
    this.patienceLevel = -1;

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
    const character = pickRandomCustomerCharacter(factionId);
    this.facingTextures = character.facingTextures;
    this.factionId = character.factionId;
    this.shoppingPlan = getShoppingPlan
      ? getShoppingPlan(this.factionId)
      : createCustomerBuyList(this.factionId, [], () => null);
    this.shelfStops = this.shoppingPlan.shelfStops || [];
    this.shelfStopIndex = 0;
    this.phaseItemIds = [];
    this.primaryBought = new Set();
    this.primaryMissing = new Set();
    this.bonusBought = new Set();
    this.bonusAttempted = new Set();
    this.purchasedFirearms = new Set();
    this.currentFacing = "down";
    this.sprite = scene.add
      .image(spawnX, spawnY, this.facingTextures.down)
      .setDisplaySize(SPRITE_DISPLAY_WIDTH, SPRITE_DISPLAY_HEIGHT)
      .setDepth(2);
    scene.physics.add.existing(this.sprite);

    this.visitNextShelf("primary");
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
        this.updatePatience(delta);
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

  visitNextShelf(phase) {
    this.shoppingPhase = phase;
    const itemIds = phase === "primary"
      ? this.shoppingPlan.primaryItemIds
      : this.getBonusItemIds().filter((itemId) => !this.bonusAttempted.has(itemId));
    if (itemIds.length === 0) {
      this.finishShoppingPhase();
      return;
    }
    this.phaseItemIds = itemIds;
    this.shelfStops = this.shoppingPlan.shelfStops.filter(({ fixture }) =>
      fixture.placements.some((placement) => itemIds.includes(placement.itemId)),
    );
    this.shelfStopIndex = 0;
    this.visitNextShelfStop();
  }

  visitNextShelfStop() {
    if (this.shelfStopIndex >= this.shelfStops.length) {
      this.finishShoppingPhase();
      return;
    }
    const { fixture, standPoint } = this.shelfStops[this.shelfStopIndex];
    this.fixture = fixture;
    const target = this.onReserveShelfSlot
      ? this.onReserveShelfSlot(fixture, this)
      : standPoint;
    this.shelfStopIndex += 1;
    this.setDestination(target.x, target.y, () => this.shopAtCurrentShelf());
  }

  shopAtCurrentShelf() {
    for (const itemId of this.phaseItemIds) {
      if (this.shoppingPhase === "bonus") this.bonusAttempted.add(itemId);
      const placements = this.fixture.placements.filter((placement) =>
        placement.itemId === itemId && placement.quantity > 0,
      );
      if (placements.length === 0) continue;
      if (this.cart.some((entry) => entry.itemId === itemId)) continue;
      if (this.shoppingPhase === "bonus" && this.factionId === "mercenaries" &&
        this.purchasedFirearms.has(this.scene.getItem(itemId)?.tags.find((tag) =>
          ["Pistol", "Rifle", "Heavy"].includes(tag),
        ))) continue;

      const placement = placements.find((candidate) => this.acceptsPrice(itemId));
      if (!placement) {
        this.scene.showFloatingText(
          this.sprite.x,
          this.sprite.y - 40,
          "Too expensive!",
          "#f59e0b",
        );
        continue;
      }

      const takenItemId = this.fixture.takeItem(placement);
      if (!takenItemId) continue;
      this.cart.push({ itemId: takenItemId, price: this.scene.getStorePrice(takenItemId) });
      if (this.shoppingPhase === "primary") this.primaryBought.add(takenItemId);
      else this.bonusBought.add(takenItemId);

      const item = this.scene.getItem(takenItemId);
      if (this.factionId === "mercenaries" && item?.tags.includes("Firearm")) {
        const weaponType = item.tags.find((tag) => ["Pistol", "Rifle", "Heavy"].includes(tag));
        if (weaponType) this.purchasedFirearms.add(weaponType);
      }
    }
    this.visitNextShelfStop();
  }

  getBonusItemIds() {
    const ids = [...this.shoppingPlan.bonusItemIds];
    for (const { itemId: firearmId } of this.cart) {
      if (!this.scene.getItem(firearmId)?.tags.includes("Firearm")) continue;
      ids.push(...(this.shoppingPlan.matchingAmmoIdsByFirearm?.[firearmId] || []));
    }
    return [...new Set(ids)].filter((id) =>
      !this.cart.some((entry) => entry.itemId === id),
    );
  }

  finishShoppingPhase() {
    if (this.shoppingPhase === "primary") {
      if (this.shoppingPlan.primaryItemIds.length === 0) {
        if (this.factionId) {
          const hints = {
            scavengers: "Looking for surplus gear!",
            mercenaries: "Looking for weapons, ammo, or armor!",
            explorers: "Looking for tools or survival gear!",
          };
          this.scene.showFloatingText(
            this.sprite.x,
            this.sprite.y - 40,
            hints[this.factionId],
            "#38bdf8",
          );
        }
        this.enterLeaving();
        return;
      }

      this.primaryMissing = new Set(
        this.shoppingPlan.primaryItemIds.filter((itemId) =>
          !this.primaryBought.has(itemId) &&
          !this.shoppingPlan.shelfStops.some(({ fixture }) =>
            fixture.placements.some((placement) =>
              placement.itemId === itemId && placement.quantity > 0,
            ),
          ),
        ),
      );
      if (this.primaryMissing.size > 0) this.penalizeMissingPrimary();
      if (this.primaryBought.size === 0) {
        this.enterLeaving();
        return;
      }
      this.visitNextShelf("bonus");
      return;
    }

    const additionalBonusIds = this.getBonusItemIds().filter((itemId) =>
      !this.bonusAttempted.has(itemId),
    );
    if (additionalBonusIds.length > 0) {
      this.phaseItemIds = additionalBonusIds;
      this.shelfStops = this.shoppingPlan.shelfStops.filter(({ fixture }) =>
        fixture.placements.some((placement) => additionalBonusIds.includes(placement.itemId)),
      );
      this.shelfStopIndex = 0;
      this.visitNextShelfStop();
      return;
    }

    if (this.cart.length === 0) {
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

  penalizeMissingPrimary() {
    const penalty = 1;
    this.playerState.subReputation(penalty, this.factionId);
    this.scene.showFloatingText(
      this.sprite.x,
      this.sprite.y - 40,
      `Out of stock! Store rep -${penalty}${this.factionId ? ` / Faction rep -${penalty}` : ""}`,
      "#ef4444",
    );
  }

  joinQueue() {
    this.state = "QUEUEING";
    this.queueTarget = { x: this.registerPoint.x, y: this.registerPoint.y };
    this.resetPatience();
    this.onJoinQueue(this);
  }

  resetPatience() {
    this.patienceRemainingMs = PATIENCE_MS;
  }

  // Drains while waiting in line, except while the player is actively ringing them up.
  updatePatience(delta) {
    if (this.patienceRemainingMs == null) return;
    if (!this.scene.isServingCustomer?.(this)) {
      this.patienceRemainingMs = Math.max(0, this.patienceRemainingMs - delta);
    }
    if (this.patienceRemainingMs <= 0) {
      this.leaveAngry();
      return;
    }
    this.drawPatienceBubble();
  }

  drawPatienceBubble() {
    const x = this.sprite.x;
    const y = this.sprite.y - SPRITE_DISPLAY_HEIGHT / 2 - 14;
    if (!this.patienceBubble) {
      const background = this.scene.add.circle(0, 0, 12, 0xffffff).setStrokeStyle(2, 0x000000);
      const glyph = this.scene.add
        .text(0, -1, "", {
          fontFamily: '"Courier New", monospace',
          fontSize: "14px",
          fontStyle: "bold",
          color: "#000000",
        })
        .setOrigin(0.5);
      this.patienceBubble = this.scene.add.container(x, y, [background, glyph]).setDepth(9000);
    }
    this.patienceBubble.setPosition(x, y);

    const level = getPatienceLevel(this.patienceRemainingMs / PATIENCE_MS);
    if (level === this.patienceLevel) return;
    this.patienceLevel = level;
    const [, text, color] = PATIENCE_LEVELS[level];
    const [background, glyph] = this.patienceBubble.list;
    background.setFillStyle(color);
    glyph.setText(text);
  }

  clearPatience() {
    this.patienceRemainingMs = null;
    this.patienceLevel = -1;
    this.patienceBubble?.destroy();
    this.patienceBubble = null;
  }

  // Bible Steps 12/51: abandons the cart (sent to the Go-Backs bin) and costs reputation.
  leaveAngry() {
    const cart = this.cart;
    this.cart = [];
    this.clearPatience();
    this.playerState.subReputation(ANGRY_REPUTATION_PENALTY, this.factionId);
    const penalty = ANGRY_REPUTATION_PENALTY;
    this.scene.showFloatingText(
      this.sprite.x,
      this.sprite.y - 40,
      `Left angry! Store rep -${penalty}${this.factionId ? ` / Faction rep -${penalty}` : ""}`,
      "#ef4444",
    );
    this.onLeaveAngry?.(this, cart);
    this.enterLeaving();
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
    this.playerState.addReputation(1, this.factionId);
    this.clearPatience();
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
    this.clearPatience();
    this.sprite.destroy();
    this.onComplete(this);
  }
}
