// ==========================================
// FILE: Crate.js
// ==========================================
// A physical cargo crate for ordered stock or one fixture. Item crates are delivered to
// stock holders; fixture crates are carried and placed through FixturePlacement.
// See also: CratePushing.js (player pushing).

// Sizes and drop-search spacing in px; drag in px/s².
const CRATE_DISPLAY_SIZE = 40;
const CRATE_THROW_MULTIPLIER = 1.5;
const CRATE_DRAG = 480;
const CRATE_BOUNCE = 0.6;
const DROP_SEARCH_STEP = 8;
const THROW_RELEASE_GAP = 4;
// A throw accelerates for this long (ms) up to the peak multiple of walking speed.
export const THROW_ACCELERATION_MS = 160;
const THROW_PEAK_MULTIPLIER = 2.5;

// Player-to-crate/fixture interaction distance (px): forgiving, but not across the room.
export const INTERACT_RANGE = 56;
const DROP_SEARCH_RADIUS = INTERACT_RANGE - DROP_SEARCH_STEP;
const FIXTURE_CRATE_DISPLAY_SIZE = 48;

/**
 * One crate in the world: its contents, sprite, and physics body.
 * Created by deliveries and fixture crating; destroyed when emptied or unpacked.
 */
export class Crate {
  constructor(scene, itemId, quantity, x, y, { kind = "item", typeId = null } = {}) {
    this.scene = scene;
    this.kind = kind;
    this.typeId = kind === "fixture" ? typeId : null;
    this.itemId = kind === "item" ? itemId : null;
    this.quantity = kind === "item" ? quantity : 1;
    this.isCarried = false;
    this.isThrown = false;
    this.isPushed = false;
    this.lockedToPad = false;
    this.launch = null;
    this.throwCarrier = null;
    this.hitCustomers = new Set();

    this.sprite = scene.add
      .image(x, y, kind === "fixture" ? "fixture_crate_01" : "crate_closed_01")
      .setDisplaySize(
        kind === "fixture" ? FIXTURE_CRATE_DISPLAY_SIZE : CRATE_DISPLAY_SIZE,
        kind === "fixture" ? FIXTURE_CRATE_DISPLAY_SIZE : CRATE_DISPLAY_SIZE,
      )
      .setDepth(2);

    scene.crateGroup.add(this.sprite);
    this.sprite.body
      .setAllowGravity(false)
      .setAllowRotation(false)
      .setBounce(CRATE_BOUNCE)
      .setBoundsRectangle(scene.crateBounds)
      .setCollideWorldBounds(true);
  }

  // --- Carrying and dropping ---

  isStationary() {
    const { x, y } = this.sprite.body.velocity;
    return x === 0 && y === 0;
  }

  /**
   * Only a resting crate can be picked up; its body is disabled while carried.
   * @param {Phaser.GameObjects.Sprite} carrierSprite
   */
  pickUp(carrierSprite) {
    if (!this.isStationary()) return false;

    this.isCarried = true;
    this.isThrown = false;
    this.isPushed = false;
    this.stopThrowAcceleration();
    this.throwCarrier = null;
    this.lockedToPad = false;
    this.hitCustomers.clear();
    this.sprite.body.setImmovable(false);
    this.sprite.body.stop();
    this.sprite.body.enable = false;
    this.followCarrier(carrierSprite);
    return true;
  }

  /**
   * True if the crate fits at (x, y): in bounds, off the pad, clear of bodies and carrier.
   * @param {number} x
   * @param {number} y
   * @param {Phaser.GameObjects.Sprite | null} [carrierSprite]
   */
  isDropPositionClear(x, y, carrierSprite = null) {
    const { width, height } = this.sprite.body;
    const left = x - width / 2;
    const top = y - height / 2;
    const right = left + width;
    const bottom = top + height;
    const bounds = this.scene.crateBounds;
    if (left < bounds.left || right > bounds.right || top < bounds.top || bottom > bounds.bottom) {
      return false;
    }

    const pad = this.scene.loadingPadRect;
    if (pad && left < pad.right && right > pad.left && top < pad.bottom && bottom > pad.top) {
      return false;
    }
    if (carrierSprite) {
      const carrier = carrierSprite.getBounds();
      if (left < carrier.right && right > carrier.left && top < carrier.bottom && bottom > carrier.top) {
        return false;
      }
    }

    const bodies = [
      ...this.scene.physics.overlapRect(left, top, width, height, false, true),
      ...(this.scene.restockCrates ?? []).filter((crate) => crate !== this).map((crate) => crate.sprite.body),
    ];
    return !bodies.some((body) => body.enable &&
      left < body.right && right > body.left && top < body.bottom && bottom > body.top);
  }

  /**
   * Nearest clear spot to (x, y), beside the player and never inside their footprint.
   * @param {number} x
   * @param {number} y
   * @param {Phaser.GameObjects.Sprite | null} [carrierSprite]
   * @returns {{ x: number, y: number } | null}
   */
  findDropPosition(x, y, carrierSprite = null) {
    const offsets = [];
    for (let dx = -DROP_SEARCH_RADIUS; dx <= DROP_SEARCH_RADIUS; dx += DROP_SEARCH_STEP) {
      for (let dy = -DROP_SEARCH_RADIUS; dy <= DROP_SEARCH_RADIUS; dy += DROP_SEARCH_STEP) {
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared <= DROP_SEARCH_RADIUS * DROP_SEARCH_RADIUS) {
          offsets.push({ dx, dy, distanceSquared });
        }
      }
    }
    offsets.sort((a, b) => a.distanceSquared - b.distanceSquared);

    for (const { dx, dy } of offsets) {
      const dropX = x + dx;
      const dropY = y + dy;
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
    const { x, y } = this.sprite;
    if (!this.isDropPositionClear(x, y)) return null;
    const carrier = carrierSprite.getBounds();
    const { width, height } = this.sprite.body;
    const clearanceX = (dx > 0 ? carrier.right - x : x - carrier.left) + width / 2;
    const clearanceY = (dy > 0 ? carrier.bottom - y : y - carrier.top) + height / 2;
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
    // Keep the held position and inherited walking velocity: no forward teleport.
    this.drop(this.sprite.x, this.sprite.y, 0, 0, false);
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
   * Per-frame: end the launch boost on timeout/collision; restore depth once clear of thrower.
   * @param {number} delta - ms
   */
  updateThrow(delta) {
    const body = this.sprite.body;
    if (!body.enable || !body.moves) return;
    if (this.launch) {
      this.launch.remainingMs -= delta;
      if (this.launch.remainingMs <= 0 || body.blocked?.none === false || body.touching?.none === false) {
        this.refreshDrag();
      }
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
    this.isCarried = false;
    this.isPushed = false;
    this.throwCarrier = null;
    this.sprite.setDepth(2);
    const body = this.sprite.body;
    body.reset(x, y);
    body.moves = !paused;
    body.enable = true;
    body.setImmovable(false);
    this.lockedToPad = false;

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
   * Penalize a customer at most once per throw.
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
    customer.hitByCrate();
    return true;
  }

  // --- Pad locking and pushing ---

  // A delivered crate stays fixed on its loading pad spot until the player picks it up:
  // it can't be pushed or knocked around, and other crates bounce off it.
  lockToPad() {
    this.stopThrowAcceleration();
    this.throwCarrier = null;
    this.lockedToPad = true;
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

  setPaused(paused) {
    this.sprite.body.moves = !paused && !this.lockedToPad;
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
    };
  }

  serializePayload() {
    return this.kind === "fixture"
      ? { kind: "fixture", typeId: this.typeId }
      : { kind: "item", itemId: this.itemId, quantity: this.quantity };
  }

  applySave(data) {
    // drop() re-applies the throw multiplier, so undo it on the saved velocity.
    this.drop(data.x, data.y, data.velocityX / CRATE_THROW_MULTIPLIER,
      data.velocityY / CRATE_THROW_MULTIPLIER, false);
    if (data.launch) this.startThrowAcceleration(data.launch);
  }

  /**
   * Per-frame while carried: held slightly above the player and drawn over them.
   * @param {Phaser.GameObjects.Sprite} carrierSprite
   */
  followCarrier(carrierSprite) {
    this.sprite.setPosition(carrierSprite.x, carrierSprite.y - 28);
    this.sprite.setDepth(carrierSprite.depth + 1);
  }

  distanceTo(x, y) {
    return Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, x, y);
  }

  destroy() {
    this.sprite.destroy();
  }
}
