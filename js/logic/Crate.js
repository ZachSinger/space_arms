// ==========================================
// FILE: Crate.js
// ==========================================
// A physical, hauled unit of ordered stock (bible Step 10: "Ordered stock spawns as
// physical crates on an outdoor Loading Pad. Crates must be hauled inside via chained
// anchor pathfinding"). For this first procurement slice, hauling is player-driven (walk
// up, press E to pick up; walk to a fixture, press E to deliver; Q to drop on the floor)
// rather than full
// automated anchor-chain pathfinding -- see TODO.md for what's still simplified here
// (no backroom intermediate storage stage, no employee auto-hauling yet).
const CRATE_DISPLAY_SIZE = 40;

// How far away (in px) the player can be from a crate/fixture to interact with it --
// generous enough to not require pixel-perfect positioning, tight enough that it doesn't
// trigger from across the room.
export const INTERACT_RANGE = 56;

export class Crate {
  constructor(scene, itemId, quantity, x, y) {
    this.scene = scene;
    this.itemId = itemId;
    this.quantity = quantity;
    this.isCarried = false;

    this.sprite = scene.add
      .image(x, y, "crate_closed_01")
      .setDisplaySize(CRATE_DISPLAY_SIZE, CRATE_DISPLAY_SIZE)
      .setDepth(2);
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
