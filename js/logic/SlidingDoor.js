// ==========================================
// FILE: SlidingDoor.js
// ==========================================
// Animated doors set into the shop's back wall, drawn at the characters' pixel size
// (96 sheet px -> 64 world px). The front door is a single double door that customers
// both arrive and leave through: it opens for an arriving customer, a leaving customer,
// or the player when they come near, and is solid while closed. The backroom's glass
// door only animates; the wall behind it stays solid (E moves the player through).

// Full paths written out so the production build finds and copies them (see vite.config.js).
export const STORE_DOOR_SPRITE = Object.freeze({
  key: "store_double_door",
  path: "img/Icons_Extracted/Tileset/Doors/store_double_door.png",
  frameWidth: 96,
  frameHeight: 96,
});

export const BACKROOM_DOOR_SPRITE = Object.freeze({
  key: "backroom_glass_door",
  path: "img/Icons_Extracted/Tileset/Doors/backroom_glass_door.png",
  frameWidth: 96,
  frameHeight: 96,
});

// Sheet frames in order: closed, opening, nearly open, open.
const CLOSED_FRAME = 0;
const OPEN_FRAME = 3;
const DOOR_FRAME_DURATION_MS = 90;
const DOOR_CLOSE_DELAY_MS = 500;
const DOOR_PROXIMITY_RADIUS = 96;
const DOOR_DISPLAY_SIZE = 64;
// Fills the one-cell doorway along the bottom of the door.
const DOOR_COLLISION = { width: 64, height: 36 };

export class AnimatedDoor {
  /**
   * `x` is the door's center; `y` is where its bottom lands. With a `wallGroup`, the door
   * is solid while closed.
   */
  constructor(scene, { x, y, sprite, wallGroup = null }) {
    this.x = x;
    this.sensorY = y - DOOR_DISPLAY_SIZE / 2;
    this.state = "closed";
    this.frameIndex = CLOSED_FRAME;
    this.frameTimer = 0;
    this.closeTimer = 0;

    this.sprite = scene.add
      .sprite(x, y, sprite.key, CLOSED_FRAME)
      .setOrigin(0.5, 1)
      .setDisplaySize(DOOR_DISPLAY_SIZE, DOOR_DISPLAY_SIZE)
      .setDepth(1.5);

    this.blocker = null;
    if (wallGroup) {
      this.blocker = scene.add.rectangle(
        x,
        y - DOOR_COLLISION.height / 2,
        DOOR_COLLISION.width,
        DOOR_COLLISION.height,
        0x000000,
        0,
      );
      wallGroup.add(this.blocker);
      this.blocker.setVisible(false);
    }
  }

  isNear(actor) {
    return Math.hypot(this.x - actor.x, this.sensorY - actor.y) <= DOOR_PROXIMITY_RADIUS;
  }

  update(delta, shouldOpen) {
    if (shouldOpen) {
      this.closeTimer = 0;
      if (this.state === "closed" || this.state === "closing") this.beginOpening();
    } else if (this.state === "open") {
      this.closeTimer += delta;
      if (this.closeTimer >= DOOR_CLOSE_DELAY_MS) this.beginClosing();
    }

    if (this.state === "opening") this.advance(delta, 1, OPEN_FRAME, "open");
    else if (this.state === "closing") this.advance(delta, -1, CLOSED_FRAME, "closed");
  }

  beginOpening() {
    this.state = "opening";
    this.frameTimer = 0;
    if (this.blocker) this.blocker.body.enable = false;
  }

  beginClosing() {
    this.state = "closing";
    this.frameTimer = 0;
  }

  advance(delta, step, lastFrame, finalState) {
    this.frameTimer += delta;
    while (this.frameTimer >= DOOR_FRAME_DURATION_MS && this.frameIndex !== lastFrame) {
      this.frameTimer -= DOOR_FRAME_DURATION_MS;
      this.frameIndex += step;
      this.sprite.setFrame(this.frameIndex);
    }
    if (this.frameIndex !== lastFrame) return;
    this.state = finalState;
    this.closeTimer = 0;
    if (finalState === "closed" && this.blocker) this.blocker.body.enable = true;
  }

  destroy() {
    this.sprite.destroy();
    this.blocker?.destroy();
  }
}

export class SlidingDoor {
  // `x` is the doorway's center; `y` is where the bottom of the door lands.
  constructor(scene, { x, y, wallGroup }) {
    this.door = new AnimatedDoor(scene, { x, y, sprite: STORE_DOOR_SPRITE, wallGroup });
    // Where customers walk in from and back out to.
    this.doorwayPoint = { x, y };
    // Arriving customers hold the door open until they've walked clear of it.
    this.arrivals = new Set();
  }

  get state() {
    return this.door.state;
  }

  letIn(actor) {
    this.arrivals.add(actor);
  }

  // `nearbyActors` are everyone who opens the door by walking up to it.
  update(delta, nearbyActors) {
    for (const actor of this.arrivals) {
      if (actor.active === false || !this.door.isNear(actor)) this.arrivals.delete(actor);
    }
    const someoneNear = nearbyActors.some((actor) => actor && this.door.isNear(actor));
    this.door.update(delta, this.arrivals.size > 0 || someoneNear);
  }

  destroy() {
    this.door.destroy();
  }
}
