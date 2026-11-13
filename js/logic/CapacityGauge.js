// ==========================================
// FILE: CapacityGauge.js
// ==========================================
// A small in-world fill gauge: green shows how full something is over a red background.
// Vertical gauges fill from the bottom; horizontal gauges fill from the left.

const BORDER_COLOR = 0x111827;
const EMPTY_COLOR = 0xdc2626;
const FILL_COLOR = 0x22c55e;

export const GAUGE_SIZES = Object.freeze({
  vertical: Object.freeze({ width: 6, height: 20 }),
  horizontal: Object.freeze({ width: 20, height: 6 }),
});

/**
 * The green part's rectangle inside a gauge whose top-left is (0, 0).
 * @param {"vertical"|"horizontal"} orientation
 * @param {number} fraction - 0 (empty) to 1 (full); clamped
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function gaugeFillRect(orientation, fraction) {
  const size = GAUGE_SIZES[orientation];
  if (!size) throw new RangeError(`Unknown gauge orientation: ${orientation}`);
  const amount = Math.min(Math.max(Number.isFinite(fraction) ? fraction : 0, 0), 1);
  if (orientation === "vertical") {
    const height = Math.round(size.height * amount);
    return { x: 0, y: size.height - height, width: size.width, height };
  }
  return { x: 0, y: 0, width: Math.round(size.width * amount), height: size.height };
}

export class CapacityGauge {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} [options]
   * @param {"vertical"|"horizontal"} [options.orientation]
   * @param {number} [options.originX] - 0 left edge, 0.5 center, 1 right edge
   * @param {number} [options.originY] - 0 top edge, 0.5 center, 1 bottom edge
   * @param {number} [options.depth]
   */
  constructor(scene, { orientation = "vertical", originX = 0.5, originY = 0.5, depth = 3 } = {}) {
    if (!GAUGE_SIZES[orientation]) throw new RangeError(`Unknown gauge orientation: ${orientation}`);
    this.orientation = orientation;
    this.originX = originX;
    this.originY = originY;
    this.fraction = null;
    this.graphics = scene.add.graphics().setDepth(depth);
  }

  /**
   * Redraws only when the fill amount changes.
   * @param {number} used
   * @param {number} capacity
   */
  setValue(used, capacity) {
    const fraction = capacity > 0 ? Math.min(Math.max(used / capacity, 0), 1) : 0;
    if (fraction === this.fraction) return this;
    this.fraction = fraction;
    const { width, height } = GAUGE_SIZES[this.orientation];
    const left = -width * this.originX;
    const top = -height * this.originY;
    const fill = gaugeFillRect(this.orientation, fraction);
    this.graphics.clear()
      .fillStyle(BORDER_COLOR, 1).fillRect(left - 1, top - 1, width + 2, height + 2)
      .fillStyle(EMPTY_COLOR, 1).fillRect(left, top, width, height);
    if (fill.width > 0 && fill.height > 0) {
      this.graphics.fillStyle(FILL_COLOR, 1).fillRect(left + fill.x, top + fill.y, fill.width, fill.height);
    }
    return this;
  }

  setPosition(x, y) {
    this.graphics.setPosition(x, y);
    return this;
  }

  setVisible(visible) {
    if (this.graphics.visible !== visible) this.graphics.setVisible(visible);
    return this;
  }

  destroy() {
    this.graphics.destroy();
  }
}
