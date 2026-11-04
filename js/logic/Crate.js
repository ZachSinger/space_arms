// ==========================================
// FILE: Crate.js
// ==========================================
// A physical cargo crate for ordered stock or one fixture. Item crates are delivered to
// stock holders; fixture crates are carried and placed through FixturePlacement.
const CRATE_DISPLAY_SIZE = 40;
const CRATE_THROW_MULTIPLIER = 1.5;
const CRATE_DRAG = 180;
const CRATE_BOUNCE = 0.6;
const DROP_SEARCH_STEP = 8;

// How far away (in px) the player can be from a crate/fixture to interact with it --
// generous enough to not require pixel-perfect positioning, tight enough that it doesn't
// trigger from across the room.
export const INTERACT_RANGE = 56;
const DROP_SEARCH_RADIUS = INTERACT_RANGE - DROP_SEARCH_STEP;
const FIXTURE_CRATE_DISPLAY_SIZE = 48;

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

  isStationary() {
    const { x, y } = this.sprite.body.velocity;
    return x === 0 && y === 0;
  }

  pickUp(carrierSprite) {
    if (!this.isStationary()) return false;

    this.isCarried = true;
    this.isThrown = false;
    this.isPushed = false;
    this.lockedToPad = false;
    this.hitCustomers.clear();
    this.sprite.body.setImmovable(false);
    this.sprite.body.stop();
    this.sprite.body.enable = false;
    this.followCarrier(carrierSprite);
    return true;
  }

  // Find the closest clear spot within pickup range: the crate is wider than the player,
  // so dropping exactly at the player's feet can otherwise embed it in a wall.
  findDropPosition(x, y) {
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

    const { width, height } = this.sprite.body;
    const bounds = this.scene.crateBounds;
    const pad = this.scene.loadingPadRect;
    for (const { dx, dy } of offsets) {
      const dropX = x + dx;
      const dropY = y + dy;
      const left = dropX - width / 2;
      const top = dropY - height / 2;
      const right = left + width;
      const bottom = top + height;
      if (left < bounds.left || right > bounds.right || top < bounds.top || bottom > bounds.bottom) {
        continue;
      }
      // Only deliveries land on the loading pad; a picked-up crate can't go back.
      if (pad && left < pad.right && right > pad.left && top < pad.bottom && bottom > pad.top) {
        continue;
      }

      const crateBodies = (this.scene.restockCrates ?? [])
        .filter((crate) => crate !== this)
        .map((crate) => crate.sprite.body);
      const bodies = [
        ...this.scene.physics.overlapRect(left, top, width, height, false, true),
        ...crateBodies,
      ];
      const blocked = bodies.some(
        (body) =>
          body.enable &&
          left < body.right &&
          right > body.left &&
          top < body.bottom &&
          bottom > body.top,
      );
      if (!blocked) return { x: dropX, y: dropY };
    }
    return null;
  }

  drop(x, y, velocityX, velocityY, paused) {
    this.isCarried = false;
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
    const body = this.sprite.body;
    const { x, y } = body.velocity;
    const speed = Math.hypot(x, y);
    body.setDrag(
      speed ? (CRATE_DRAG * Math.abs(x)) / speed : 0,
      speed ? (CRATE_DRAG * Math.abs(y)) / speed : 0,
    );
  }

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

  // A delivered crate stays fixed on its loading pad spot until the player picks it up:
  // it can't be pushed or knocked around, and other crates bounce off it.
  lockToPad() {
    this.lockedToPad = true;
    this.isThrown = false;
    const body = this.sprite.body;
    body.stop();
    body.setImmovable(true);
    body.moves = false;
  }

  // Moved by the player walking into it (see CratePushing.js). Unlike a throw, a pushed
  // crate stops the moment the push stops.
  push(velocity) {
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

  serialize() {
    return {
      ...this.serializePayload(),
      onPad: this.lockedToPad,
      x: this.sprite.x,
      y: this.sprite.y,
      velocityX: this.isPushed ? 0 : this.sprite.body.velocity.x,
      velocityY: this.isPushed ? 0 : this.sprite.body.velocity.y,
    };
  }

  serializePayload() {
    return this.kind === "fixture"
      ? { kind: "fixture", typeId: this.typeId }
      : { kind: "item", itemId: this.itemId, quantity: this.quantity };
  }

  applySave(data) {
    this.drop(data.x, data.y, data.velocityX / CRATE_THROW_MULTIPLIER,
      data.velocityY / CRATE_THROW_MULTIPLIER, false);
  }

  // Called every frame while being carried, to keep it visually "attached" to the player --
  // rendered slightly above and at a higher depth so it reads as held up, not standing on
  // the floor next to them.
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
