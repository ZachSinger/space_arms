const DOOR_TEXTURE_PREFIX = "research_sliding_door";
const DOOR_FRAME_COUNT = 6;
const DOOR_FRAME_DURATION_MS = 80;
const DOOR_CLOSE_DELAY_MS = 500;
const DOOR_PROXIMITY_RADIUS = 128;
const DOOR_SOURCE_SIZE = 64;
// The door art's visible rows run from the top of row 3 to the bottom of row 62
// (every frame shares them).
const DOOR_VISIBLE_TOP = 3;
const DOOR_VISIBLE_BOTTOM = 63;
const DOOR_COLLISION = { width: 104, height: 36 };

export const SLIDING_DOOR_ASSETS = [
  {
    key: `${DOOR_TEXTURE_PREFIX}_opening_00`,
    path: "img/Tilesets/Research_Station_FULL_v0.6.0/Art/PNG/Interactives/sliding_door/opening_00.png",
  },
  {
    key: `${DOOR_TEXTURE_PREFIX}_opening_01`,
    path: "img/Tilesets/Research_Station_FULL_v0.6.0/Art/PNG/Interactives/sliding_door/opening_01.png",
  },
  {
    key: `${DOOR_TEXTURE_PREFIX}_opening_02`,
    path: "img/Tilesets/Research_Station_FULL_v0.6.0/Art/PNG/Interactives/sliding_door/opening_02.png",
  },
  {
    key: `${DOOR_TEXTURE_PREFIX}_opening_03`,
    path: "img/Tilesets/Research_Station_FULL_v0.6.0/Art/PNG/Interactives/sliding_door/opening_03.png",
  },
  {
    key: `${DOOR_TEXTURE_PREFIX}_opening_04`,
    path: "img/Tilesets/Research_Station_FULL_v0.6.0/Art/PNG/Interactives/sliding_door/opening_04.png",
  },
  {
    key: `${DOOR_TEXTURE_PREFIX}_opening_05`,
    path: "img/Tilesets/Research_Station_FULL_v0.6.0/Art/PNG/Interactives/sliding_door/opening_05.png",
  },
  {
    key: `${DOOR_TEXTURE_PREFIX}_state_closed`,
    path: "img/Tilesets/Research_Station_FULL_v0.6.0/Art/PNG/Interactives/sliding_door/state_closed.png",
  },
  {
    key: `${DOOR_TEXTURE_PREFIX}_state_open`,
    path: "img/Tilesets/Research_Station_FULL_v0.6.0/Art/PNG/Interactives/sliding_door/state_open.png",
  },
];

const openingTexture = (index) =>
  `${DOOR_TEXTURE_PREFIX}_opening_${String(index).padStart(2, "0")}`;

const closedTexture = `${DOOR_TEXTURE_PREFIX}_state_closed`;
const openTexture = `${DOOR_TEXTURE_PREFIX}_state_open`;

export class SlidingDoor {
  // `y` is where the bottom of the door's art lands; `top` is where its top lands.
  constructor(scene, { x, y, top = y - 120, wallGroup }) {
    const scale = (y - top) / (DOOR_VISIBLE_BOTTOM - DOOR_VISIBLE_TOP);
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.state = "closed";
    this.frameIndex = 0;
    this.frameTimer = 0;
    this.closeTimer = 0;

    this.sprite = scene.add
      .image(x, y, closedTexture)
      .setOrigin(0.5, DOOR_VISIBLE_BOTTOM / DOOR_SOURCE_SIZE)
      .setDisplaySize(DOOR_SOURCE_SIZE * scale, DOOR_SOURCE_SIZE * scale)
      .setDepth(1.5);

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
    this.sensorY = y - 32;
  }

  update(delta, actors) {
    const nearby = actors.some((actor) =>
      actor && Math.hypot(this.x - actor.x, this.sensorY - actor.y) <= DOOR_PROXIMITY_RADIUS,
    );

    if (nearby) {
      this.closeTimer = 0;
      if (this.state === "closed" || this.state === "closing") this.beginOpening();
    } else if (this.state === "open") {
      this.closeTimer += delta;
      if (this.closeTimer >= DOOR_CLOSE_DELAY_MS) this.beginClosing();
    }

    if (this.state === "opening") this.advanceOpening(delta);
    else if (this.state === "closing") this.advanceClosing(delta);
  }

  beginOpening() {
    this.state = "opening";
    this.frameTimer = 0;
    this.blocker.body.enable = false;
    if (this.frameIndex === 0) this.sprite.setTexture(openingTexture(0));
  }

  beginClosing() {
    this.state = "closing";
    this.frameIndex = DOOR_FRAME_COUNT - 1;
    this.frameTimer = 0;
    this.sprite.setTexture(openingTexture(this.frameIndex));
  }

  advanceOpening(delta) {
    this.frameTimer += delta;
    while (this.frameTimer >= DOOR_FRAME_DURATION_MS && this.state === "opening") {
      this.frameTimer -= DOOR_FRAME_DURATION_MS;
      if (this.frameIndex < DOOR_FRAME_COUNT - 1) {
        this.frameIndex += 1;
        this.sprite.setTexture(openingTexture(this.frameIndex));
      } else {
        this.state = "open";
        this.closeTimer = 0;
        this.sprite.setTexture(openTexture);
      }
    }
  }

  advanceClosing(delta) {
    this.frameTimer += delta;
    while (this.frameTimer >= DOOR_FRAME_DURATION_MS && this.state === "closing") {
      this.frameTimer -= DOOR_FRAME_DURATION_MS;
      if (this.frameIndex > 0) {
        this.frameIndex -= 1;
        this.sprite.setTexture(openingTexture(this.frameIndex));
      } else {
        this.state = "closed";
        this.sprite.setTexture(closedTexture);
        this.blocker.body.enable = true;
      }
    }
  }

  destroy() {
    this.sprite.destroy();
    this.blocker.destroy();
  }
}
