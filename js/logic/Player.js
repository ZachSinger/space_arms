// ==========================================
// FILE: Player.js
// ==========================================
import { pickPlayerCharacterTextures } from "./CustomerSprites.js";

// Faster than a customer's own walk SPEED (120, see Customer.js) so directly controlling
// the player doesn't feel sluggish next to the NPCs walking around them.
const MOVE_SPEED = 160;

// Matches Customer.js's own display size (square, not tall-and-thin -- see that file's
// comment) so the player reads as the same "scale of person" as every customer on the
// floor -- only visually distinct via tint (see below).
export const PLAYER_DISPLAY_WIDTH = 46;
export const PLAYER_DISPLAY_HEIGHT = 48;

// Temporary: no dedicated player sprite exists yet (see TODO.md), so this reuses one
// customer character's art (pickPlayerCharacterTextures -- deterministic, not random) and
// tints it a bright cyan matching the UI's own accent color, so the player is instantly
// recognizable among a crowd of otherwise-identical-style NPCs.
const PLAYER_TINT = 0x38bdf8;

const INV_SQRT2 = 0.7071067811865476; // 1/sqrt(2), for normalizing diagonal movement

// The bible's Step 30/58: the player has no dynamic collision with customers (everyone
// glides through each other -- see GameScene, which deliberately never colliders the
// player's sprite against customerGroup), but does collide with walls/fixtures like
// everyone else, and always renders above everything else on the floor (setDepth(9999))
// so it's never visually hidden.
export class Player {
  constructor(scene, spawnX, spawnY) {
    this.scene = scene;
    this.facingTextures = pickPlayerCharacterTextures();
    this.currentFacing = "down";

    this.sprite = scene.add
      .image(spawnX, spawnY, this.facingTextures.down)
      .setDisplaySize(PLAYER_DISPLAY_WIDTH, PLAYER_DISPLAY_HEIGHT)
      .setTint(PLAYER_TINT)
      .setDepth(9999);
    scene.physics.add.existing(this.sprite);

    this.cursors = scene.input.keyboard.createCursorKeys();
    this.wasd = scene.input.keyboard.addKeys({
      up: "W",
      down: "S",
      left: "A",
      right: "D",
    });
  }

  update() {
    const left = this.cursors.left.isDown || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up = this.cursors.up.isDown || this.wasd.up.isDown;
    const down = this.cursors.down.isDown || this.wasd.down.isDown;

    let vx = 0;
    let vy = 0;
    if (left) vx -= 1;
    if (right) vx += 1;
    if (up) vy -= 1;
    if (down) vy += 1;

    // Normalize diagonal movement -- without this, moving at 45 degrees would add up to
    // sqrt(2)x speed instead of matching the cardinal-direction speed.
    if (vx !== 0 && vy !== 0) {
      vx *= INV_SQRT2;
      vy *= INV_SQRT2;
    }

    this.sprite.body.setVelocity(vx * MOVE_SPEED, vy * MOVE_SPEED);
    this.updateFacing(vx, vy);
  }

  // Unlike Customer.updateFacing, there's no "forced facing" case -- the player always
  // faces whichever way they're actually currently moving, or keeps their last facing
  // while standing still.
  updateFacing(vx, vy) {
    if (vx === 0 && vy === 0) return;

    const facing = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? "left" : "right") : vy < 0 ? "up" : "down";
    if (facing === this.currentFacing) return;

    this.currentFacing = facing;
    this.sprite
      .setTexture(this.facingTextures[facing])
      .setDisplaySize(PLAYER_DISPLAY_WIDTH, PLAYER_DISPLAY_HEIGHT)
      .setTint(PLAYER_TINT);
  }
}
