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

// The extracted sprite's own canvas has a lot of transparent padding around the actual
// character (measured directly from alien_01's PNGs: real visible content is only ~45-55%
// of the full display width and ~85% of the display height) -- using the full display size
// for the collision body made it feel like there was a large invisible buffer around the
// player. These are the desired FINAL on-screen (world-space) body dimensions, trimmed to
// fit within the narrowest of the 4 facings' real content bounds -- see applyBodySize()
// for why this can't just be passed straight to body.setSize().
const BODY_WIDTH = 22;
const BODY_HEIGHT = 40;

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
    this.applyBodySize();

    this.cursors = scene.input.keyboard.createCursorKeys();
    this.wasd = scene.input.keyboard.addKeys({
      up: "W",
      down: "S",
      left: "A",
      right: "D",
    });

    // Frozen while "inside" an interaction that takes over player positioning entirely
    // (currently: operating the register -- see GameScene.beginRegisterSession()). WASD
    // is ignored and velocity forced to zero while this is false, rather than disabling
    // the physics body itself, so the body stays fully active for anything else that might
    // still need it.
    this.inputEnabled = true;
  }

  // Body.setSize() takes its width/height in the texture FRAME's own native (pre-scale)
  // space, not final on-screen pixels -- Phaser then multiplies by the sprite's current
  // scaleX/scaleY to get the actual collision box. Since every facing's source crop has a
  // slightly different native width (side-profile crops are narrower than front/back
  // ones -- same reason SPRITE_DISPLAY_WIDTH/HEIGHT force a fixed display size over them),
  // setDisplaySize() gives each facing a different scaleX/scaleY too. Dividing the desired
  // *world-space* BODY_WIDTH/HEIGHT by the current scale cancels that back out, so the
  // actual on-screen collision box stays a constant 22x40 regardless of which facing's
  // texture is currently active. Must be re-applied every time the texture changes (see
  // updateFacing()), not just once at construction.
  applyBodySize() {
    this.sprite.body.setSize(BODY_WIDTH / this.sprite.scaleX, BODY_HEIGHT / this.sprite.scaleY);
  }

  update() {
    if (!this.inputEnabled) {
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
    this.forceFacing(facing);
  }

  // Instantly moves the player (e.g. snapping them behind the register counter, or back
  // to wherever they were standing before -- see GameScene.beginRegisterSession/
  // endRegisterSession). Uses the body's own teleport so velocity doesn't carry over and
  // Arcade doesn't try to interpolate through anything in between.
  teleportTo(x, y) {
    this.sprite.body.reset(x, y);
  }

  // Swaps the facing texture directly -- shared by updateFacing() (derived from movement)
  // and anything that needs to set it explicitly, like forcing the player to visibly face
  // the register counter while operating it.
  forceFacing(facing) {
    if (facing === this.currentFacing) return;

    this.currentFacing = facing;
    this.sprite
      .setTexture(this.facingTextures[facing])
      .setDisplaySize(PLAYER_DISPLAY_WIDTH, PLAYER_DISPLAY_HEIGHT)
      .setTint(PLAYER_TINT);
    this.applyBodySize(); // this facing's native frame size differs, so scaleX/Y just changed
  }
}
