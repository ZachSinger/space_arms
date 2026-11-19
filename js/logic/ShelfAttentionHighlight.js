// ==========================================
// FILE: ShelfAttentionHighlight.js
// ==========================================
// A pulsing outline around a shop-floor shelf that holds an item the player can stock from, so
// the player can see where their crates go. Sold-out spaces count: they're saved for that item.
// It follows the shelf's footprint, so it works in every facing.
import { TILE_SIZE } from "./RoomLayout.js";
import { fixtureArtInset, fixtureFootprint } from "./FixtureLayout.js";

export const SHELF_ATTENTION = Object.freeze({ color: 0x4ade80, periodMs: 700 });

// How far the outline grows past the shelf's edge at the top of each pulse, in pixels.
const PULSE_GROWTH = 4;
const GAP = 2;

/**
 * @param {import("./ShelfFixture.js").ShelfFixture} shelf
 * @param {Array<{itemId: string|null, quantity: number}>} stockableCrates
 * @returns {boolean} true if any space on the shelf is for an item in a stockable crate
 */
export function shelfMatchesStockable(shelf, stockableCrates) {
  const stockable = new Set(stockableCrates.filter((crate) => crate.quantity > 0).map((crate) => crate.itemId));
  if (stockable.size === 0) return false;
  return shelf.placements.some((placement) => stockable.has(placement.itemId));
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
    this.active = false;
    this.graphics = scene.add.graphics().setDepth(3).setVisible(false);
  }

  // Kept for the shelf-display interface; the outline is drawn from the fixture each frame.
  setPosition() {}

  setAngle() {}

  sync() {
    this.active = shelfMatchesStockable(this.fixture, this.scene.getStockableCrates?.() ?? []);
    if (!this.active) this.graphics.clear().setVisible(false);
  }

  /** @param {number} timeMs - scene time */
  update(timeMs) {
    this.sync();
    if (!this.active) return;
    const { color, periodMs } = SHELF_ATTENTION;
    const pulse = pulseAmount(timeMs, periodMs);
    const grow = GAP + PULSE_GROWTH * pulse;
    // Hug the visible shelf: its picture is centered on (x, y), minus the see-through margin.
    const { w, h } = fixtureFootprint(this.fixture);
    const inset = fixtureArtInset(this.fixture);
    const x = this.fixture.x + (inset.left - w / 2) * TILE_SIZE - grow;
    const y = this.fixture.y + (inset.top - h / 2) * TILE_SIZE - grow;
    const width = (w - inset.left - inset.right) * TILE_SIZE + grow * 2;
    const height = (h - inset.top - inset.bottom) * TILE_SIZE + grow * 2;
    this.graphics.clear().setVisible(true)
      .lineStyle(6, color, 0.25 + 0.2 * pulse).strokeRect(x - 2, y - 2, width + 4, height + 4)
      .lineStyle(2, color, 0.75 + 0.25 * pulse).strokeRect(x, y, width, height);
  }

  destroy() {
    this.graphics.destroy();
  }
}
