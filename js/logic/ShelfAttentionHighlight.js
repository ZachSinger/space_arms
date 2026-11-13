// ==========================================
// FILE: ShelfAttentionHighlight.js
// ==========================================
// A pulsing outline around a shop-floor shelf that needs restocking. It follows the shelf's
// footprint, so it works in every facing. Red and fast: something on it is sold out.
// Orange and slower: something is below half full (same rule as the Supply tab's "running low").
// Shelves that are fine, or empty because nothing was assigned yet, show nothing.
import { TILE_SIZE } from "./RoomLayout.js";
import { fixtureFootprint } from "./FixtureLayout.js";

export const SHELF_ATTENTION = Object.freeze({
  out: Object.freeze({ color: 0xef4444, periodMs: 500 }),
  low: Object.freeze({ color: 0xf97316, periodMs: 1100 }),
});

// How far the outline grows past the shelf's edge at the top of each pulse, in pixels.
const PULSE_GROWTH = 4;
const GAP = 2;

/**
 * @param {import("./ShelfFixture.js").ShelfFixture} shelf
 * @returns {"out" | "low" | null}
 */
export function getShelfAttention(shelf) {
  let level = null;
  for (const placement of shelf.placements) {
    if (placement.quantity <= 0) return "out";
    if (placement.quantity * 2 < shelf.getPlacementCapacity(placement)) level = "low";
  }
  return level;
}

/**
 * Pulse amount from 0 (resting) to 1 (largest) at a point in time.
 * @param {number} timeMs
 * @param {number} periodMs
 */
export function pulseAmount(timeMs, periodMs) {
  return (1 - Math.cos((timeMs % periodMs) / periodMs * Math.PI * 2)) / 2;
}

export class ShelfAttentionHighlight {
  constructor(scene, fixture) {
    this.scene = scene;
    this.fixture = fixture;
    this.level = null;
    this.graphics = scene.add.graphics().setDepth(3).setVisible(false);
  }

  // Kept for the shelf-display interface; the outline is drawn from the fixture each frame.
  setPosition() {}

  setAngle() {}

  sync() {
    this.level = getShelfAttention(this.fixture);
    if (!this.level) this.graphics.clear().setVisible(false);
  }

  /** @param {number} timeMs - scene time */
  update(timeMs) {
    this.sync();
    if (!this.level) return;
    const { color, periodMs } = SHELF_ATTENTION[this.level];
    const pulse = pulseAmount(timeMs, periodMs);
    const grow = GAP + PULSE_GROWTH * pulse;
    const { w, h } = fixtureFootprint(this.fixture);
    const x = this.fixture.x - w * TILE_SIZE / 2 - grow;
    const y = this.fixture.y - h * TILE_SIZE / 2 - grow;
    const width = w * TILE_SIZE + grow * 2;
    const height = h * TILE_SIZE + grow * 2;
    this.graphics.clear().setVisible(true)
      .lineStyle(6, color, 0.25 + 0.2 * pulse).strokeRect(x - 2, y - 2, width + 4, height + 4)
      .lineStyle(2, color, 0.75 + 0.25 * pulse).strokeRect(x, y, width, height);
  }

  destroy() {
    this.graphics.destroy();
  }
}
