// ==========================================
// FILE: Player.js
// ==========================================
// The directly controlled shopkeeper: WASD/arrow movement, facing textures, and a trimmed
// collision body. Collides with walls and fixtures but passes through customers.
import { pickPlayerCharacterTextures } from "./CustomerSprites.js";

// px/s; faster than a customer's 120 so direct control doesn't feel sluggish.
const MOVE_SPEED = 160;

// px; same as a customer, so the player reads as the same scale of person.
export const PLAYER_DISPLAY_WIDTH = 46;
export const PLAYER_DISPLAY_HEIGHT = 48;

// px, on-screen collision box. The sprite canvas has lots of transparent padding, so the
// body is trimmed to the narrowest facing's visible content.
const BODY_WIDTH = 22;
const BODY_HEIGHT = 40;

// Placeholder art is a customer sprite (see TODO.md), tinted the UI accent cyan so the
// player stands out from the crowd.
const PLAYER_TINT = 0x38bdf8;

const INV_SQRT2 = 0.7071067811865476; // 1/sqrt(2)

export class Player {
  constructor(scene, spawnX, spawnY) {
    this.scene = scene;
    this.facingTextures = pickPlayerCharacterTextures();
    this.currentFacing = "down";

    this.sprite = scene.add
      .image(spawnX, spawnY, this.facingTextures.down)
      .setDisplaySize(PLAYER_DISPLAY_WIDTH, PLAYER_DISPLAY_HEIGHT)
      .setTint(PLAYER_TINT)
      // Always drawn above everything on the floor.
      .setDepth(9999);
    scene.physics.add.existing(this.sprite);
    this.applyBodySize();

    this.cursors = scene.input.keyboard.createCursorKeys();
    this.wasd = scene.input.keyboard.addKeys({
      up: "W",
      down: "S",
      left: "A",
      right: "D",
    });

    // False while an interaction owns positioning (e.g. operating the register). Velocity
    // is zeroed instead of disabling the body, so collisions still work.
    this.inputEnabled = true;
  }

  // body.setSize() works in unscaled frame pixels, and each facing has a different frame
  // width, so divide by the current scale to keep a constant on-screen box. Re-apply on
  // every texture change.
  applyBodySize() {
    this.sprite.body.setSize(BODY_WIDTH / this.sprite.scaleX, BODY_HEIGHT / this.sprite.scaleY);
  }

  update() {
    if (!this.inputEnabled || !this.scene.controlMode.allows("move")) {
      this.sprite.body.setVelocity(0, 0);
      return;
    }

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

    // Keep diagonal speed equal to cardinal speed.
    if (vx !== 0 && vy !== 0) {
      vx *= INV_SQRT2;
      vy *= INV_SQRT2;
    }

    this.sprite.body.setVelocity(vx * MOVE_SPEED, vy * MOVE_SPEED);
    this.updateFacing(vx, vy);
  }

  updateFacing(vx, vy) {
    if (vx === 0 && vy === 0) return;

    const facing = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? "left" : "right") : vy < 0 ? "up" : "down";
    this.forceFacing(facing);
  }

  /**
   * Move instantly with no carried velocity or interpolation (e.g. behind the register).
   * @param {number} x
   * @param {number} y
   */
  teleportTo(x, y) {
    this.sprite.body.reset(x, y);
  }

  forceFacing(facing) {
    if (facing === this.currentFacing) return;

    this.currentFacing = facing;
    this.sprite
      .setTexture(this.facingTextures[facing])
      .setDisplaySize(PLAYER_DISPLAY_WIDTH, PLAYER_DISPLAY_HEIGHT)
      .setTint(PLAYER_TINT);
    this.applyBodySize();
  }
}
