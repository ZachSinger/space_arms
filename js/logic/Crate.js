// ==========================================
// FILE: Crate.js
// ==========================================
// A physical cargo crate for ordered stock or one fixture. Item crates are delivered to
// stock holders; fixture crates are carried and placed through FixturePlacement.
// See also: CratePushing.js (player pushing).
import items from "../../data/Items.json" with { type: "json" };
import { getCrateItemLimit } from "./ShelfSlotStocking.js";
import { getItemCrateTint } from "./CrateCategory.js";
import { REMOTE_ORDER_CRATE_SPRITES } from "../modules/droneDeliveries/DroneTerminalArt.js";

const ITEMS_BY_ID = new Map(items.map((item) => [item.id, item]));

// Pixel-art crates from the 48px art pack, drawn at the same scale as the floor and walls
// (each 64px game square shows 2x2 of the pack's 48px tiles). Sizes in px; drag in px/s².
export const ITEM_CRATE_SPRITE = Object.freeze({
  key: "crate_item_box", path: "img/Icons_Extracted/Tileset/Fixtures/crate_item_box.png", width: 32, height: 28,
});
export const FIXTURE_CRATE_SPRITE = Object.freeze({
  key: "crate_fixture_slatted", path: "img/Icons_Extracted/Tileset/Fixtures/crate_fixture_slatted.png",
  width: 28, height: 28,
});
// Each crate in a stack (on the floor or in someone's hands) sits this many pixels above the
// one below, so its bottom edge lands where the lower crate's side turns from light to dark.
export const CRATE_STACK_SPACING = 10;
const CRATE_BASE_HEIGHT = 18;
const CRATE_THROW_MULTIPLIER = 1.5;
const CRATE_DRAG = 480;
const CRATE_BOUNCE = 0.6;
const DROP_SEARCH_STEP = 8;
const THROW_RELEASE_GAP = 4;
// A throw accelerates for this long (ms) up to the peak multiple of walking speed.
export const THROW_ACCELERATION_MS = 160;
const THROW_PEAK_MULTIPLIER = 2.5;
const THROW_FALL_GRAVITY = 900;

// Player-to-crate/fixture interaction distance (px): forgiving, but not across the room.
export const INTERACT_RANGE = 56;
// Put-down spots may sit a little past arm's reach, so tight aisles still find room.
const DROP_SEARCH_RADIUS = INTERACT_RANGE + 2 * DROP_SEARCH_STEP;
const FACING_DIRECTIONS = Object.freeze({
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
});
let nextStandaloneCrateId = 1;

// Delivery platforms stop people, but support crates placed on their surface.
export function isCrateObstacle(body) {
  return Boolean(body.enable) && !body.gameObject?.getData?.("allowsCrates");
}

// The space a set-down crate must keep clear of: the carrier's feet (physics body) with a
// small margin, so crates can be set down right beside him; art overlap is depth-sorted.
function carrierFootprint(carrierSprite, margin = 4) {
  const art = carrierSprite.getBounds();
  const feet = carrierSprite.body;
  if (!feet) return art;
  return { left: feet.left - margin, right: feet.right + margin, top: feet.top - margin, bottom: feet.bottom + margin };
}

/**
 * One crate in the world: its contents, sprite, and physics body.
 * Created by deliveries and fixture crating. Hand-stocked crates stay around when empty.
 */
export class Crate {
  constructor(scene, itemId, quantity, x, y, {
    id = null, kind = "item", typeId = null, paint = null, tint = null,
    orderId = null, requiredItems = [], contents = [],
  } = {}) {
    this.scene = scene;
    this.id = id ?? scene.crateSystem?.createId?.() ?? `crate-local-${nextStandaloneCrateId++}`;
    this.kind = kind;
    this.typeId = kind === "fixture" ? typeId : null;
    // A crated shelf or register keeps its color for when it's placed again.
    this.paint = kind === "fixture" ? paint : null;
    this.orderId = kind === "remote-order" ? orderId : null;
    this.requiredItems = kind === "remote-order" ? requiredItems.map((entry) => ({ ...entry })) : [];
    this.contents = kind === "remote-order"
      ? new Map(contents.map(({ itemId: contentId, quantity: amount }) => [contentId, amount]))
      : new Map();
    this.itemId = kind === "item" ? itemId : null;
    this.quantity = kind === "item" ? quantity
      : kind === "remote-order" ? [...this.contents.values()].reduce((sum, amount) => sum + amount, 0)
        : 1;
    this.locationState = { kind: "world" };
    this.incomingDelivery = false;
    this.isThrown = false;
    this.isPushed = false;
    this.launch = null;
    this.flight = null;
    this.throwCarrier = null;
    this.hitCustomers = new Set();

    const art = kind === "fixture" ? FIXTURE_CRATE_SPRITE
      : kind === "remote-order"
        ? this.isRemoteOrderComplete() ? REMOTE_ORDER_CRATE_SPRITES.complete : REMOTE_ORDER_CRATE_SPRITES.incomplete
        : ITEM_CRATE_SPRITE;
    const sprite = kind === "remote-order"
      ? scene.add.sprite(x, y, art.key, 0)
      : scene.add.image(x, y, art.key);
    this.sprite = sprite
      .setDisplaySize(art.width, art.height)
      .setDepth(2);
    if (tint !== null) this.sprite.setTint?.(tint);
    this.remoteOrderLidOpen = false;
    this.inTerminal = false;
    this.remoteOrderShipping = false;
    if (kind === "remote-order" && scene.anims && !scene.anims.exists(art.animation)) {
      for (const appearance of Object.values(REMOTE_ORDER_CRATE_SPRITES)) {
        if (scene.anims.exists(appearance.animation)) continue;
        scene.anims.create({
          key: appearance.animation,
          frames: [0, 1, 2, 3].map((frame) => ({ key: appearance.key, frame })),
          frameRate: 1000 / 60,
          repeat: 0,
        });
        scene.anims.create({
          key: `${appearance.animation}-close`,
          frames: [3, 2, 1, 0].map((frame) => ({ key: appearance.key, frame })),
          frameRate: 1000 / 60,
          repeat: 0,
        });
      }
    }

    scene.crateGroup.add(this.sprite);
    this.sprite.body
      .setSize(art.width / this.sprite.scaleX, CRATE_BASE_HEIGHT / this.sprite.scaleY, false)
      .setAllowGravity(false)
      .setAllowRotation(false)
      .setBounce(CRATE_BOUNCE)
      .setBoundsRectangle(scene.crateBounds)
      .setCollideWorldBounds(true);
    this.setThrowHeight(0);
    this.sprite.body.updateFromGameObject();
  }

  // --- Carrying and dropping ---

  isStationary() {
    const { x, y } = this.sprite.body.velocity;
    return !this.flight && x === 0 && y === 0;
  }

  // A thrown crate becomes "sliding" once its launch boost ends (normally after it clears the
  // thrower): from then on the player bumps into it and can pick it up, like a pushed crate.
  isSliding() {
    return !this.isCarried && !this.lockedToPad && !this.launch && !this.flight &&
      this.sprite.body.enable && !this.isStationary();
  }

  canPickUp() {
    if (this.inTerminal || this.remoteOrderShipping || this.incomingDelivery) return false;
    return this.isPushed || this.isStationary() || this.isSliding();
  }

  get isCarried() {
    return this.locationState?.kind === "carried" || this.locationState?.kind === "crate-stack";
  }

  get lockedToPad() {
    return this.locationState?.kind === "loading-pad";
  }

  canTake(_itemId = null, context = null) {
    const packingOrder = typeof context?.orderId === "string" && context.orderId.length > 0;
    return !this.incomingDelivery && this.kind === "item" && (!this.lockedToPad || packingOrder);
  }

  canPut(itemId) {
    if (this.kind === "remote-order") {
      return this.requiredItems.some((entry) =>
        entry.itemId === itemId && this.getAvailableUnitsFor(itemId) < entry.quantity);
    }
    return this.kind === "item" && (this.quantity === 0 || this.itemId === itemId);
  }

  getLocation() {
    const location = this.locationState ?? { kind: "world" };
    if (location.kind !== "world") return { ...location };
    return {
      kind: "world",
      x: this.sprite?.x ?? null,
      y: this.sprite?.y ?? null,
    };
  }

  getContainerId() {
    return this.id;
  }

  setCarriedBy(holderId) {
    if (typeof holderId !== "string" || holderId.length === 0) {
      throw new TypeError("Carried crates require a holder ID.");
    }
    this.isPushed = false;
    this.locationState = { kind: "carried", holderId };
  }

  getAvailableUnitsFor(itemId, _entry = null, context = null) {
    if (this.kind === "remote-order") return this.contents.get(itemId) ?? 0;
    return this.canTake(itemId, context) && this.itemId === itemId ? this.quantity : 0;
  }

  add(itemId, quantity) {
    if (this.kind === "remote-order") {
      if (!this.canPut(itemId)) return 0;
      const required = this.requiredItems.find((entry) => entry.itemId === itemId).quantity;
      const accepted = Math.min(quantity, required - this.getAvailableUnitsFor(itemId));
      if (accepted <= 0) return 0;
      this.contents.set(itemId, this.getAvailableUnitsFor(itemId) + accepted);
      this.quantity += accepted;
      this.setRemoteOrderAppearance(this.isRemoteOrderComplete());
      return accepted;
    }
    if (!this.canPut(itemId)) return 0;
    this.itemId = itemId;
    const tint = getItemCrateTint(ITEMS_BY_ID.get(itemId)?.tags);
    if (tint !== null) this.sprite?.setTint?.(tint);
    this.quantity += quantity;
    return quantity;
  }

  getRemainingUnitsFor(itemId) {
    if (this.kind === "remote-order") {
      const required = this.requiredItems.find((entry) => entry.itemId === itemId)?.quantity ?? 0;
      return Math.max(0, required - this.getAvailableUnitsFor(itemId));
    }
    if (!this.canPut(itemId)) return 0;
    return Math.max(0, getCrateItemLimit(ITEMS_BY_ID.get(itemId)?.boxSize) - this.quantity);
  }

  remove(itemId, quantity, _entry = null, context = null) {
    if (this.kind === "remote-order") return 0;
    const removed = Math.min(this.getAvailableUnitsFor(itemId, null, context), quantity);
    this.quantity -= removed;
    // The last item out turns it back into a plain, uncolored empty crate.
    if (removed > 0 && this.quantity === 0) {
      this.itemId = null;
      this.sprite?.clearTint?.();
    }
    return removed;
  }

  isRemoteOrderComplete() {
    return this.kind === "remote-order" && this.requiredItems.length > 0 &&
      this.requiredItems.every((entry) => this.getAvailableUnitsFor(entry.itemId) >= entry.quantity);
  }

  setRemoteOrderAppearance(complete) {
    if (this.kind !== "remote-order") return;
    const appearance = complete
      ? REMOTE_ORDER_CRATE_SPRITES.complete
      : REMOTE_ORDER_CRATE_SPRITES.incomplete;
    this.sprite?.anims?.stop?.();
    this.sprite?.setTexture?.(appearance.key, this.remoteOrderLidOpen ? 3 : 0);
  }

  animateRemoteOrderLid(open = true) {
    if (this.kind !== "remote-order") return;
    if (this.remoteOrderLidOpen === open) return;
    this.remoteOrderLidOpen = open;
    const appearance = this.isRemoteOrderComplete()
      ? REMOTE_ORDER_CRATE_SPRITES.complete
      : REMOTE_ORDER_CRATE_SPRITES.incomplete;
    if (this.sprite.anims) this.sprite.anims.play(open ? appearance.animation : `${appearance.animation}-close`, true);
    else this.sprite.setFrame?.(open ? 3 : 0);
  }

  setTerminalStored(stored) {
    if (this.kind !== "remote-order" || this.isCarried) throw new Error("Only an uncarried delivery crate can enter the terminal.");
    this.inTerminal = stored;
    this.sprite.setVisible(!stored);
    const body = this.sprite.body;
    body.stop();
    body.enable = !stored;
    body.moves = !stored && !this.scene.crateSystem?.motionPaused;
    if (!stored) body.reset(this.sprite.x, this.sprite.y);
  }

  resetRemoteOrderContents() {
    if (this.kind !== "remote-order") throw new Error("Only a remote order crate can be reset.");
    this.contents.clear();
    this.quantity = 0;
    this.sprite?.anims?.stop?.();
    this.setRemoteOrderAppearance(false);
  }

  /**
   * Resting, pushed, and sliding crates can be picked up; a crate still being launched cannot.
   * @param {Phaser.GameObjects.Sprite} carrierSprite
   * @param {{ holderId?: string, stackedOnId?: string | null, hidden?: boolean }} [options] -
   *   hidden: the carrier holds it out of sight (robots store crates inside themselves)
   */
  pickUp(carrierSprite, { holderId = "player", stackedOnId = null, hidden = false } = {}) {
    if (!this.canPickUp()) return false;

    if (stackedOnId !== null) this.setStackedOn(stackedOnId);
    else this.setCarriedBy(holderId);
    this.isThrown = false;
    this.isPushed = false;
    this.flight = null;
    this.setThrowHeight(0);
    this.stopThrowAcceleration();
    this.throwCarrier = null;
    this.hitCustomers.clear();
    this.sprite.body.setImmovable(false);
    this.sprite.body.stop();
    this.sprite.body.enable = false;
    this.sprite.setVisible?.(!hidden);
    this.followCarrier(carrierSprite);
    return true;
  }

  setStackedOn(baseCrateId) {
    if (typeof baseCrateId !== "string" || baseCrateId.length === 0) {
      throw new TypeError("Stacked crates require a base crate ID.");
    }
    this.isPushed = false;
    this.locationState = { kind: "crate-stack", baseCrateId };
  }

  /**
   * True if the crate fits at (x, y): in bounds, off the pad, clear of bodies and carrier.
   * @param {number} x
   * @param {number} y
   * @param {Phaser.GameObjects.Sprite | null} [carrierSprite]
   * @param {number} [clearance] - extra px of empty space required around the crate when
   *   checking the pad and other bodies, for spots with nothing near them
   */
  isDropPositionClear(x, y, carrierSprite = null, clearance = 0, carrierMargin = 4) {
    const { left, top, right, bottom } = this.getFloorBounds(x, y);
    const bounds = this.scene.crateBounds;
    if (left < bounds.left || right > bounds.right || top < bounds.top || bottom > bounds.bottom) {
      return false;
    }

    // The grown rectangle keeps the required empty margin; walls don't count against it.
    const clearLeft = left - clearance;
    const clearRight = right + clearance;
    const clearTop = top - clearance;
    const clearBottom = bottom + clearance;
    const pad = this.scene.supply?.padRect;
    if (pad && clearLeft < pad.right && clearRight > pad.left && clearTop < pad.bottom && clearBottom > pad.top) {
      return false;
    }
    if (carrierSprite) {
      const carrier = carrierFootprint(carrierSprite, carrierMargin);
      if (left < carrier.right && right > carrier.left && top < carrier.bottom && bottom > carrier.top) {
        return false;
      }
    }

    const bodies = [
      ...this.scene.physics.overlapRect(
        clearLeft, clearTop, clearRight - clearLeft, clearBottom - clearTop, false, true),
      ...(this.scene.restockCrates ?? []).filter((crate) => crate !== this).map((crate) => crate.sprite.body),
    ];
    return !bodies.some((body) => isCrateObstacle(body) &&
      clearLeft < body.right && clearRight > body.left && clearTop < body.bottom && clearBottom > body.top);
  }

  getFloorBounds(x = this.sprite.x, y = this.sprite.y) {
    const { width, height } = this.sprite.body;
    const bottom = y + this.sprite.displayHeight / 2;
    return { left: x - width / 2, right: x + width / 2, top: bottom - height, bottom };
  }

  /**
   * Nearest clear spot to (x, y), beside the player and never inside their footprint.
   * @param {number} x
   * @param {number} y
   * @param {Phaser.GameObjects.Sprite | null} [carrierSprite]
   * @param {object[]} [reservedRectangles]
   * @param {number} [searchRadius]
   * @param {"up"|"down"|"left"|"right"|null} [facing] - tries straight ahead before anywhere else
   * @returns {{ x: number, y: number } | null}
   */
  findDropPosition(
    x, y, carrierSprite = null, reservedRectangles = [], searchRadius = DROP_SEARCH_RADIUS, facing = null,
  ) {
    const offsets = [];
    const ahead = FACING_DIRECTIONS[facing];
    if (ahead) {
      // The player's feet sit low in his art, so straight ahead may need to go past the usual
      // radius to clear them.
      let reach = searchRadius;
      if (carrierSprite) {
        const carrier = carrierFootprint(carrierSprite);
        const edge = { up: y - carrier.top, down: carrier.bottom - y, left: x - carrier.left, right: carrier.right - x }[facing];
        const base = this.getFloorBounds(0, 0);
        const extent = { up: base.bottom, down: -base.top, left: base.right, right: -base.left }[facing];
        reach = Math.max(reach, Math.ceil((edge + extent) / DROP_SEARCH_STEP) * DROP_SEARCH_STEP);
      }
      for (let distance = 0; distance <= reach; distance += DROP_SEARCH_STEP) {
        offsets.push({ dx: ahead.x * distance, dy: ahead.y * distance, distanceSquared: -1 });
      }
    }
    for (let dx = -searchRadius; dx <= searchRadius; dx += DROP_SEARCH_STEP) {
      for (let dy = -searchRadius; dy <= searchRadius; dy += DROP_SEARCH_STEP) {
        const distanceSquared = dx * dx + dy * dy;
        // With a facing, spots behind the carrier's back are never considered: a crate that
        // can't go down in front or beside just doesn't go down.
        if (ahead && dx * ahead.x + dy * ahead.y < 0) continue;
        if (distanceSquared <= searchRadius * searchRadius && !(ahead && dx * ahead.y === dy * ahead.x &&
          dx * ahead.x + dy * ahead.y >= 0)) {
          offsets.push({ dx, dy, distanceSquared });
        }
      }
    }
    // Straight-ahead spots are -1, so the stable sort keeps them first, nearest to farthest.
    offsets.sort((a, b) => a.distanceSquared - b.distanceSquared);

    // First choice: right against the front of the carrier's feet. This is exactly where a
    // crate he just walked up to and picked up was sitting, so it always fits back there.
    const feet = carrierSprite?.body;
    if (ahead && feet) {
      const base = this.getFloorBounds(0, 0);
      const flush = {
        up: { x, y: feet.top - base.bottom },
        down: { x, y: feet.bottom - base.top },
        left: { x: feet.left - base.right, y },
        right: { x: feet.right - base.left, y },
      }[facing];
      const rect = this.getFloorBounds(flush.x, flush.y);
      const reserved = reservedRectangles.some((r) =>
        rect.left < r.right && rect.right > r.left && rect.top < r.bottom && rect.bottom > r.top);
      if (!reserved && this.isDropPositionClear(flush.x, flush.y, carrierSprite, 0, 0)) return flush;
    }

    for (const { dx, dy } of offsets) {
      const dropX = x + dx;
      const dropY = y + dy;
      const rect = this.getFloorBounds(dropX, dropY);
      if (reservedRectangles.some((reserved) =>
        rect.left < reserved.right && rect.right > reserved.left &&
        rect.top < reserved.bottom && rect.bottom > reserved.top)) continue;
      if (this.isDropPositionClear(dropX, dropY, carrierSprite)) return { x: dropX, y: dropY };
    }
    return null;
  }

  // --- Throwing ---

  /**
   * Validate the initial launch path, without snapping the crate to its far end.
   * @param {Phaser.GameObjects.Sprite} carrierSprite
   * @param {number} velocityX - px/s
   * @param {number} velocityY - px/s
   * @returns {{ x: number, y: number } | null}
   */
  findThrowPosition(carrierSprite, velocityX, velocityY) {
    const speed = Math.hypot(velocityX, velocityY);
    if (!speed) return null;
    const dx = velocityX / speed;
    const dy = velocityY / speed;
    const x = this.sprite.x;
    const y = this.throwGroundY(carrierSprite);
    if (!this.isDropPositionClear(x, y)) return null;
    const carrier = carrierFootprint(carrierSprite);
    const base = this.getFloorBounds(x, y);
    const clearanceX = dx > 0 ? carrier.right - base.left : base.right - carrier.left;
    const clearanceY = dy > 0 ? carrier.bottom - base.top : base.bottom - carrier.top;
    const distance = Math.min(
      dx ? clearanceX / Math.abs(dx) : Infinity,
      dy ? clearanceY / Math.abs(dy) : Infinity,
    ) + THROW_RELEASE_GAP;
    const position = { x: x + dx * distance, y: y + dy * distance };
    if (!this.isDropPositionClear(position.x, position.y, carrierSprite)) return null;
    // Releasing ahead must not skip through an intervening wall, crate, or loading pad.
    for (let step = DROP_SEARCH_STEP; step < distance; step += DROP_SEARCH_STEP) {
      if (!this.isDropPositionClear(x + dx * step, y + dy * step)) return null;
    }
    return position;
  }

  /**
   * Release a carried crate while walking: it starts at the player's speed, then pulls away.
   * @param {Phaser.GameObjects.Sprite} carrierSprite - the player throwing it
   * @param {number} velocityX - px/s
   * @param {number} velocityY - px/s
   */
  startThrow(carrierSprite, velocityX, velocityY) {
    const speed = Math.hypot(velocityX, velocityY);
    if (!speed) throw new Error("A throw requires a nonzero movement speed");
    const groundY = this.throwGroundY(carrierSprite);
    const height = Math.max(0, groundY - this.sprite.y);
    this.drop(this.sprite.x, groundY, 0, 0, false);
    this.flight = height > 0 ? { height, fallSpeed: 0 } : null;
    this.setThrowHeight(height);
    this.isThrown = true;
    this.sprite.body.setVelocity(velocityX, velocityY);
    this.throwCarrier = carrierSprite;
    this.sprite.setDepth(carrierSprite.depth + 1);
    const duration = THROW_ACCELERATION_MS / 1000;
    this.startThrowAcceleration({
      remainingMs: THROW_ACCELERATION_MS,
      accelerationX: velocityX * (THROW_PEAK_MULTIPLIER - 1) / duration,
      accelerationY: velocityY * (THROW_PEAK_MULTIPLIER - 1) / duration,
      maxSpeed: speed * THROW_PEAK_MULTIPLIER,
    });
  }

  throwGroundY(carrierSprite) {
    const feet = carrierSprite.body ?? carrierSprite.getBounds();
    return feet.bottom - this.sprite.displayHeight / 2;
  }

  // Lift only the artwork; the matching body offset keeps collisions on the floor.
  setThrowHeight(height) {
    this.sprite.setOrigin(0.5, 0.5 + height / this.sprite.displayHeight);
    this.sprite.body.setOffset(0,
      (this.sprite.displayHeight - CRATE_BASE_HEIGHT + height) / this.sprite.scaleY);
  }

  startThrowAcceleration(launch) {
    this.launch = { ...launch };
    this.sprite.body.setDrag(0, 0)
      .setAcceleration(launch.accelerationX, launch.accelerationY)
      .setMaxSpeed(launch.maxSpeed);
  }

  stopThrowAcceleration() {
    this.launch = null;
    this.sprite.body.setAcceleration(0, 0).setMaxSpeed(-1);
  }

  /**
   * Per-frame: lower the artwork, end the launch boost, and restore depth clear of the thrower.
   * @param {number} delta - ms
   */
  updateThrow(delta) {
    const body = this.sprite.body;
    if (!body.enable || !body.moves) return;
    if (this.flight) {
      const seconds = delta / 1000;
      this.flight.height = Math.max(0, this.flight.height -
        this.flight.fallSpeed * seconds - THROW_FALL_GRAVITY * seconds * seconds / 2);
      this.flight.fallSpeed += THROW_FALL_GRAVITY * seconds;
      this.setThrowHeight(this.flight.height);
      if (this.flight.height === 0) this.flight = null;
    }
    if (this.throwCarrier) {
      const carrier = this.throwCarrier.getBounds();
      const crate = this.sprite.getBounds();
      // Draw the departing crate above the player until it has physically cleared them.
      if (crate.right <= carrier.left || crate.left >= carrier.right ||
        crate.bottom <= carrier.top || crate.top >= carrier.bottom) {
        this.throwCarrier = null;
        this.sprite.setDepth(2);
      }
    }
    if (this.launch) {
      const collided = body.blocked?.none === false || body.touching?.none === false;
      // Keep boosting past the usual time until the crate clears the thrower, or the player
      // could outrun a crate thrown from overhead and walk underneath it.
      this.launch.remainingMs = Math.max(this.throwCarrier ? 1 : 0, this.launch.remainingMs - delta);
      if (this.launch.remainingMs <= 0 || collided) this.refreshDrag();
    }
  }

  /**
   * Put the crate back into the world; any nonzero velocity makes it a thrown crate.
   * @param {number} x
   * @param {number} y
   * @param {number} velocityX - px/s, scaled by CRATE_THROW_MULTIPLIER
   * @param {number} velocityY - px/s, scaled by CRATE_THROW_MULTIPLIER
   * @param {boolean} paused
   */
  drop(x, y, velocityX, velocityY, paused) {
    this.locationState = { kind: "world" };
    this.isPushed = false;
    this.throwCarrier = null;
    this.flight = null;
    this.setThrowHeight(0);
    this.sprite.setAngle?.(0);
    this.sprite.setDepth(2);
    this.sprite.setVisible?.(true);
    const body = this.sprite.body;
    body.reset(x, y);
    body.updateFromGameObject();
    body.prev.copy(body.position);
    body.prevFrame.copy(body.position);
    body.autoFrame.copy(body.position);
    body.moves = !paused;
    body.enable = true;
    body.setImmovable(false);
    this.isThrown = Math.hypot(velocityX, velocityY) > 0;
    this.hitCustomers.clear();
    body.setVelocity(velocityX * CRATE_THROW_MULTIPLIER, velocityY * CRATE_THROW_MULTIPLIER);
    this.refreshDrag();
  }

  // Scale drag by direction so diagonal motion travels as far as straight motion. Must be
  // re-run whenever a crate-vs-crate bump changes its direction (or starts a resting crate
  // moving), or it would slow along the wrong axis -- or never stop at all.
  refreshDrag() {
    this.stopThrowAcceleration();
    const body = this.sprite.body;
    const { x, y } = body.velocity;
    const speed = Math.hypot(x, y);
    body.setDrag(
      speed ? (CRATE_DRAG * Math.abs(x)) / speed : 0,
      speed ? (CRATE_DRAG * Math.abs(y)) / speed : 0,
    );
  }

  /**
   * Claim a valid customer hit at most once per throw; the scene handles its consequences.
   * @param {import("./Customer.js").Customer} customer
   */
  tryHitCustomer(customer) {
    const body = this.sprite.body;
    if (
      !this.isThrown ||
      this.isCarried ||
      !body.enable ||
      !body.moves ||
      this.isStationary() ||
      customer.isDestroyed ||
      this.hitCustomers.has(customer)
    ) {
      return false;
    }
    this.hitCustomers.add(customer);
    return true;
  }

  // A crate in flight that people stop rather than pass through: the player, staff, customers.
  canHitPerson(personSprite) {
    const body = this.sprite.body;
    return this.isThrown && !this.isCarried && !this.isPushed && body.enable && body.moves &&
      !this.isStationary() && this.throwCarrier !== personSprite && personSprite.body?.enable !== false;
  }

  /**
   * Push the crate out of a person's feet box and bounce it back; the person isn't moved.
   * @param {{ left: number, right: number, top: number, bottom: number, center: { x: number, y: number } }} person
   */
  bounceOffPerson(person) {
    const body = this.sprite.body;
    const overlapX = Math.min(body.right - person.left, person.right - body.left);
    const overlapY = Math.min(body.bottom - person.top, person.bottom - body.top);
    if (overlapX <= 0 || overlapY <= 0) return false;
    const velocity = body.velocity;
    if (overlapX < overlapY) {
      const away = body.center.x >= person.center.x ? 1 : -1;
      this.nudge(away * overlapX, 0);
      if (velocity.x * away < 0) velocity.x = -velocity.x * CRATE_BOUNCE;
    } else {
      const away = body.center.y >= person.center.y ? 1 : -1;
      this.nudge(0, away * overlapY);
      if (velocity.y * away < 0) velocity.y = -velocity.y * CRATE_BOUNCE;
    }
    this.refreshDrag();
    return true;
  }

  // --- Pad locking and pushing ---

  // A delivered crate stays fixed on its loading pad spot until the player picks it up:
  // it can't be pushed or knocked around, and other crates bounce off it.
  lockToPad() {
    this.stopThrowAcceleration();
    this.throwCarrier = null;
    this.isPushed = false;
    this.locationState = { kind: "loading-pad", padId: "loading-pad" };
    this.isThrown = false;
    const body = this.sprite.body;
    body.stop();
    body.setImmovable(true);
    body.moves = false;
  }

  /**
   * Moved by the player walking into it (CratePushing.js); stops when the push stops.
   * @param {{ x: number, y: number }} velocity - px/s
   */
  push(velocity) {
    this.stopThrowAcceleration();
    this.throwCarrier = null;
    this.locationState = { kind: "world" };
    this.sprite.setDepth(2);
    this.isPushed = true;
    this.isThrown = false;
    this.sprite.body.setDrag(0, 0);
    this.sprite.body.setVelocity(velocity.x, velocity.y);
  }

  stopPush() {
    this.isPushed = false;
    this.sprite.body.stop();
  }

  /**
   * Shift the crate without touching its velocity (used to pull apart stuck crates).
   * Body history moves too, so Arcade doesn't treat the shift as motion this frame.
   * @param {number} dx - px
   * @param {number} dy - px
   */
  nudge(dx, dy) {
    const body = this.sprite.body;
    this.sprite.x += dx;
    this.sprite.y += dy;
    for (const point of [body.position, body.prev, body.prevFrame]) {
      point.x += dx;
      point.y += dy;
    }
    body.updateCenter();
  }

  setPaused(paused) {
    this.sprite.body.moves = !paused && !this.lockedToPad && !this.inTerminal;
  }

  // --- Saving ---

  serialize() {
    return {
      ...this.serializePayload(),
      onPad: this.lockedToPad,
      x: this.sprite.x,
      y: this.sprite.y,
      velocityX: this.isPushed ? 0 : this.sprite.body.velocity.x,
      velocityY: this.isPushed ? 0 : this.sprite.body.velocity.y,
      ...(this.launch ? { launch: { ...this.launch } } : {}),
      ...(this.flight ? { flight: { ...this.flight } } : {}),
    };
  }

  serializePayload() {
    const payload = this.kind === "fixture"
      ? { kind: "fixture", typeId: this.typeId, ...(this.paint ? { paint: this.paint } : {}) }
      : this.kind === "remote-order"
        ? {
          kind: "remote-order",
          orderId: this.orderId,
          requiredItems: this.requiredItems.map((entry) => ({ ...entry })),
          contents: [...this.contents].map(([contentId, amount]) => ({ itemId: contentId, quantity: amount })),
          quantity: this.quantity,
          lidOpen: this.remoteOrderLidOpen,
          inTerminal: this.inTerminal,
        }
        : { kind: "item", itemId: this.itemId, quantity: this.quantity };
    return this.id ? { id: this.id, ...payload } : payload;
  }

  applySave(data) {
    this.id = data.id ?? this.id;
    // drop() re-applies the throw multiplier, so undo it on the saved velocity.
    this.drop(data.x, data.y, data.velocityX / CRATE_THROW_MULTIPLIER,
      data.velocityY / CRATE_THROW_MULTIPLIER, false);
    if (data.launch) this.startThrowAcceleration(data.launch);
    if (data.flight) {
      this.flight = { ...data.flight };
      this.isThrown = true;
      this.setThrowHeight(this.flight.height);
    }
    if (this.kind === "remote-order") {
      this.remoteOrderLidOpen = data.lidOpen ?? true;
      this.setRemoteOrderAppearance(this.isRemoteOrderComplete());
      if (data.inTerminal) this.setTerminalStored(true);
    }
  }

  /**
   * Per-frame while carried: held slightly above the player and drawn over them.
   * @param {Phaser.GameObjects.Sprite} carrierSprite
   */
  followCarrier(carrierSprite, stackIndex = 0, holdOffset = 22, spacing = CRATE_STACK_SPACING) {
    this.sprite.setPosition(
      carrierSprite.x,
      carrierSprite.y - holdOffset - stackIndex * spacing,
    );
    this.sprite.setAngle?.(0);
    this.sprite.setDepth(carrierSprite.depth + 1 + stackIndex);
  }

  distanceTo(x, y) {
    return Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, x, y);
  }

  destroy() {
    this.sprite.destroy();
  }
}
