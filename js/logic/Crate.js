// ==========================================
// FILE: Crate.js
// ==========================================
// A physical, hauled unit of ordered stock (bible Step 10: "Ordered stock spawns as
// physical crates on an outdoor Loading Pad. Crates must be hauled inside via chained
// anchor pathfinding"). For now the player uses E to pick up/deliver and Q to drop.
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

export class Crate {
  constructor(scene, itemId, quantity, x, y) {
    this.scene = scene;
    this.itemId = itemId;
    this.quantity = quantity;
    this.isCarried = false;
    this.isThrown = false;
    this.hitCustomers = new Set();

    this.sprite = scene.add
      .image(x, y, "crate_closed_01")
      .setDisplaySize(CRATE_DISPLAY_SIZE, CRATE_DISPLAY_SIZE)
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
    this.hitCustomers.clear();
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

      const bodies = this.scene.physics.overlapRect(left, top, width, height, false, true);
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

    // Scale drag by direction so diagonal throws travel as far as straight throws.
    const speed = Math.hypot(velocityX, velocityY);
    this.isThrown = speed > 0;
    this.hitCustomers.clear();
    body.setDrag(
      speed ? (CRATE_DRAG * Math.abs(velocityX)) / speed : 0,
      speed ? (CRATE_DRAG * Math.abs(velocityY)) / speed : 0,
    );
    body.setVelocity(velocityX * CRATE_THROW_MULTIPLIER, velocityY * CRATE_THROW_MULTIPLIER);
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

  setPaused(paused) {
    this.sprite.body.moves = !paused;
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
