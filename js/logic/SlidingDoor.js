// ==========================================
// FILE: SlidingDoor.js
// ==========================================
// The shop's front entrance: two glass doors side by side. The left one is the way in and
// only opens to let an arriving customer through. The right one is the way out and opens
// for anyone who comes near it. Each door is solid while closed.

export const STORE_DOOR_SPRITE = Object.freeze({
  key: "store_glass_door",
  path: "img/Icons_Extracted/Tileset/Doors/store_glass_door.png",
  frameWidth: 96,
  frameHeight: 96,
});

// Sheet frames in order: closed, opening, nearly open, open.
const CLOSED_FRAME = 0;
const OPEN_FRAME = 3;
const DOOR_FRAME_DURATION_MS = 90;
const DOOR_CLOSE_DELAY_MS = 500;
const DOOR_PROXIMITY_RADIUS = 96;
// Drawn at the same pixel scale as the characters (96 sheet px -> 64 world px).
const DOOR_DISPLAY_SIZE = 64;
// Together the two doors span the shop's two-tile doorway.
const ENTRANCE_OFFSET_X = -DOOR_DISPLAY_SIZE / 2;
const EXIT_OFFSET_X = DOOR_DISPLAY_SIZE / 2;
const DOOR_COLLISION = { width: 52, height: 36 };

class DoorLeaf {
  constructor(scene, { x, y, offsetX, wallGroup }) {
    this.x = x + offsetX;
    this.sensorY = y - 32;
    this.state = "closed";
    this.frameIndex = CLOSED_FRAME;
    this.frameTimer = 0;
    this.closeTimer = 0;

    this.sprite = scene.add
      .sprite(this.x, y, STORE_DOOR_SPRITE.key, CLOSED_FRAME)
      .setOrigin(0.5, 1)
      .setDisplaySize(DOOR_DISPLAY_SIZE, DOOR_DISPLAY_SIZE)
      .setDepth(1.5);

    // Each blocker covers its half of the doorway, from the center line outward.
    this.blocker = scene.add.rectangle(
      x + Math.sign(offsetX) * DOOR_COLLISION.width / 2,
      y - DOOR_COLLISION.height / 2,
      DOOR_COLLISION.width,
      DOOR_COLLISION.height,
      0x000000,
      0,
    );
    wallGroup.add(this.blocker);
    this.blocker.setVisible(false);
  }

  isNear(actor) {
    return Math.hypot(this.x - actor.x, this.sensorY - actor.y) <= DOOR_PROXIMITY_RADIUS;
  }

  update(delta, someoneNear) {
    if (someoneNear) {
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
    this.blocker.body.enable = false;
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
    if (finalState === "closed") this.blocker.body.enable = true;
  }

  destroy() {
    this.sprite.destroy();
    this.blocker.destroy();
  }
}

export class SlidingDoor {
  // `x` is the doorway's center; `y` is where the bottom of the doors lands.
  constructor(scene, { x, y, wallGroup }) {
    this.entrance = new DoorLeaf(scene, { x, y, offsetX: ENTRANCE_OFFSET_X, wallGroup });
    this.exit = new DoorLeaf(scene, { x, y, offsetX: EXIT_OFFSET_X, wallGroup });
    this.entrancePoint = { x: this.entrance.x, y };
    this.exitPoint = { x: this.exit.x, y };
    // Arriving customers hold the entrance open until they've walked clear of it.
    this.arrivals = new Set();
  }

  letIn(actor) {
    this.arrivals.add(actor);
  }

  // `exitActors` are everyone who opens the exit door by walking up to it.
  update(delta, exitActors) {
    for (const actor of this.arrivals) {
      if (actor.active === false || !this.entrance.isNear(actor)) this.arrivals.delete(actor);
    }
    this.entrance.update(delta, this.arrivals.size > 0);
    this.exit.update(delta, exitActors.some((actor) => actor && this.exit.isNear(actor)));
  }

  destroy() {
    this.entrance.destroy();
    this.exit.destroy();
  }
}
