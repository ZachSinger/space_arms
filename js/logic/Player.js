// ==========================================
// FILE: Player.js
// ==========================================
// The directly controlled shopkeeper: WASD/arrow or controller movement, walking animations, and a trimmed
// collision body. Collides with walls and fixtures but passes through customers.

export const PLAYER_SPRITE = Object.freeze({
  key: "player_mechanic",
  path: "img/Icons_Extracted/Tileset/Characters/player_mechanic.png",
  frameWidth: 96,
  frameHeight: 96,
});

const FACING_ROWS = Object.freeze({ down: 0, left: 1, right: 2, up: 3 });

export function registerPlayerAnimations(anims) {
  for (const [facing, row] of Object.entries(FACING_ROWS)) {
    const key = `player_walk_${facing}`;
    if (anims.exists(key)) continue;
    anims.create({
      key,
      frames: [0, 1, 2, 1].map((column) => ({ key: PLAYER_SPRITE.key, frame: row * 3 + column })),
      frameRate: 8,
      repeat: -1,
    });
  }
}

// px/s; faster than a customer's 120 so direct control doesn't feel sluggish.
const MOVE_SPEED = 160;
const DASH_SPEED = 280;
const MAX_STAMINA = 100;
const STAMINA_DRAIN_PER_SECOND = 25;
const STAMINA_RECOVERY_PER_SECOND = 25;
const STAMINA_RECOVERY_DELAY_MS = 750;
const EXHAUSTION_RECOVERY_STAMINA = 25;

// The sheet's original pixel blocks become two world pixels each.
export const PLAYER_DISPLAY_WIDTH = 64;
export const PLAYER_DISPLAY_HEIGHT = 64;
// Standing character height, excluding the sheet's transparent padding.
export const PLAYER_CHARACTER_HEIGHT = 48;

// px, on-screen collision box. Only the lower body collides, so the player's head can
// overlap a shelf or counter drawn above them, as in most top-down games. The sprite
// canvas has transparent padding, so the box is also trimmed to the narrowest facing.
const BODY_WIDTH = 22;
const BODY_HEIGHT = 20;
// px between the collision box and the bottom of the sprite canvas.
const BODY_BOTTOM_GAP = 4;

export class Player {
  constructor(scene, spawnX, spawnY) {
    this.scene = scene;
    this.currentFacing = "down";

    this.sprite = scene.add
      .sprite(spawnX, spawnY, PLAYER_SPRITE.key, 1)
      .setDisplaySize(PLAYER_DISPLAY_WIDTH, PLAYER_DISPLAY_HEIGHT)
      // Keep the collision box at its old world position despite the taller art canvas.
      .setOrigin(0.5, 0.625)
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
    this.dashKey = scene.input.keyboard.addKey("SHIFT");
    this.maxStamina = MAX_STAMINA;
    this.stamina = MAX_STAMINA;
    this.exhausted = false;
    this.staminaRecoveryDelay = 0;

    // False while an interaction owns positioning (e.g. operating the register). Velocity
    // is zeroed instead of disabling the body, so collisions still work.
    this.inputEnabled = true;
  }

  // Arcade Physics sizes and offsets use unscaled frame pixels.
  applyBodySize() {
    const { scaleX, scaleY } = this.sprite;
    this.sprite.body.setSize(BODY_WIDTH / scaleX, BODY_HEIGHT / scaleY, false);
    this.sprite.body.setOffset(
      (PLAYER_DISPLAY_WIDTH - BODY_WIDTH) / 2 / scaleX,
      (PLAYER_DISPLAY_HEIGHT - BODY_BOTTOM_GAP - BODY_HEIGHT) / scaleY,
    );
  }

  update(delta) {
    const canMove = this.inputEnabled && this.scene.input.keyboard.enabled &&
      this.scene.controlMode.allows("move");
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
    // Null while a menu has the controller.
    const pad = this.scene.getPadMovement?.() ?? null;
    if (vx === 0 && vy === 0 && pad) {
      vx = pad.x;
      vy = pad.y;
    }
    if (!canMove) {
      vx = 0;
      vy = 0;
    }

    let speed = MOVE_SPEED;
    const wantsDash = (vx !== 0 || vy !== 0) && (this.dashKey.isDown || Boolean(pad?.dash));
    if (wantsDash && !this.exhausted && this.stamina > 0) {
      const dashSeconds = Math.min(delta / 1000, this.stamina / STAMINA_DRAIN_PER_SECOND);
      this.stamina = Math.max(0, this.stamina - dashSeconds * STAMINA_DRAIN_PER_SECOND);
      if (delta > 0) speed += (DASH_SPEED - MOVE_SPEED) * dashSeconds / (delta / 1000);
      this.staminaRecoveryDelay = STAMINA_RECOVERY_DELAY_MS;
      this.exhausted = this.stamina === 0;
    } else {
      const recoveryMs = Math.max(0, delta - this.staminaRecoveryDelay);
      this.staminaRecoveryDelay = Math.max(0, this.staminaRecoveryDelay - delta);
      this.stamina = Math.min(MAX_STAMINA,
        this.stamina + recoveryMs / 1000 * STAMINA_RECOVERY_PER_SECOND);
      // Avoid alternating between walking and dashing every frame at an empty bar.
      if (this.exhausted && this.stamina >= EXHAUSTION_RECOVERY_STAMINA) this.exhausted = false;
    }

    // Same top speed in every direction; a half-tilted stick walks slower.
    const magnitude = Math.hypot(vx, vy);
    if (magnitude > 1) {
      vx /= magnitude;
      vy /= magnitude;
    }

    this.sprite.body.setVelocity(vx * speed, vy * speed);
    this.sprite.anims.timeScale = speed / MOVE_SPEED;
    this.updateFacing(vx, vy);
  }

  updateFacing(vx, vy) {
    if (vx === 0 && vy === 0) {
      this.forceFacing(this.currentFacing);
      return;
    }

    const facing = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? "left" : "right") : vy < 0 ? "up" : "down";
    this.currentFacing = facing;
    this.sprite.play(`player_walk_${facing}`, true);
  }

  /**
   * Move instantly with no carried velocity or interpolation (e.g. behind the register).
   * @param {number} x
   * @param {number} y
   */
  teleportTo(x, y) {
    this.sprite.body.reset(x, y);
    this.forceFacing(this.currentFacing);
  }

  forceFacing(facing) {
    if (facing === this.currentFacing && !this.sprite.anims.isPlaying) return;
    this.currentFacing = facing;
    this.sprite.anims.stop();
    this.sprite.setFrame(FACING_ROWS[facing] * 3 + 1);
  }
}
