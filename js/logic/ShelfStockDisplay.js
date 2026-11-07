// ==========================================
// FILE: ShelfStockDisplay.js
// ==========================================
// Draws a shelf's stock stacks on the shop floor as category-colored boxes with quantity
// labels, redrawing only when the shelf's placements change.
import { TILE_SIZE } from "./RoomLayout.js";
import { SHELF_VISUAL_SLOTS_PER_TILE } from "./FixtureLayout.js";

// Keyed by an item's first tag.
const CATEGORY_COLORS = Object.freeze({
  Ammunition: 0xd99b38,
  Apparel: 0x4c8ecb,
  Armor: 0x7774c9,
  Attachment: 0xb47acb,
  Firearm: 0xc65353,
  Melee: 0xd47743,
  Survival: 0x58a66b,
  Tool: 0x43a4a0,
});

export function getShelfCategoryColor(item) {
  return CATEGORY_COLORS[item?.tags?.[0]] ?? 0x8090a0;
}

/**
 * A stack's rect in px, relative to the shelf's center.
 * @param {{ w: number, h: number }} gridDimensions - shelf size in tiles
 * @param {{ gx: number, gy: number, w: number, h: number }} placement - in display slots
 */
export function getShelfStackBounds(gridDimensions, placement) {
  const cellSize = TILE_SIZE / SHELF_VISUAL_SLOTS_PER_TILE;
  return {
    x: -(gridDimensions.w * TILE_SIZE) / 2 + placement.gx * cellSize,
    y: -(gridDimensions.h * TILE_SIZE) / 2 + placement.gy * cellSize,
    width: placement.w * cellSize,
    height: placement.h * cellSize,
  };
}

export class ShelfStockDisplay {
  constructor(scene, fixture, getItem) {
    this.scene = scene;
    this.fixture = fixture;
    this.getItem = getItem;
    this.container = scene.add.container(fixture.x, fixture.y).setDepth(3);
    this.graphics = scene.add.graphics();
    this.container.add(this.graphics);
    this.labels = new Map();
    this.signature = null;
  }

  setPosition(x, y) {
    this.container.setPosition(x, y);
  }

  // Turns the stock boxes with the shelf, but keeps quantity labels upright and readable.
  setAngle(angle) {
    this.container.setAngle(angle);
    for (const label of this.labels.values()) label.setAngle(-angle);
  }

  // Redraw if the placements changed since the last call; reuse labels per placement.
  sync() {
    const { placements } = this.fixture;
    const signature = placements.map((placement) =>
      `${placement.itemId}:${placement.gx},${placement.gy},${placement.w},${placement.h},${placement.quantity}`,
    ).join("|");
    if (signature === this.signature) return;
    this.signature = signature;
    this.graphics.clear();

    const visibleLabels = new Set();
    for (const placement of placements) {
      const item = this.getItem(placement.itemId);
      if (!item) continue;
      const bounds = getShelfStackBounds(this.fixture.gridDimensions, placement);
      const inset = 2; // px gap between neighboring stacks
      const x = bounds.x + inset;
      const y = bounds.y + inset;
      const width = Math.max(1, bounds.width - inset * 2);
      const height = Math.max(1, bounds.height - inset * 2);

      this.graphics
        .fillStyle(getShelfCategoryColor(item), 0.9)
        .fillRect(x, y, width, height)
        .fillStyle(0x111827, 0.95)
        .fillRect(x + 2, y + 2, width - 4, height - 4);

      let label = this.labels.get(placement);
      if (!label) {
        label = this.scene.add.text(0, 0, "", {
          fontFamily: "Courier New, monospace",
          fontSize: "13px",
          fontStyle: "bold",
          color: "#ffffff",
          padding: { x: 2, y: 2 },
        }).setOrigin(0.5);
        this.labels.set(placement, label);
        this.container.add(label);
      }
      label.setAngle(-this.container.angle);
      label.setText(`x${Math.max(0, placement.quantity)}`);
      label.setColor("#ffffff");
      label.setPosition(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      label.setVisible(true);
      visibleLabels.add(placement);
    }

    for (const [placement, label] of this.labels) {
      if (visibleLabels.has(placement)) continue;
      if (placements.includes(placement)) {
        label.setVisible(false);
      } else {
        label.destroy();
        this.labels.delete(placement);
      }
    }
  }

  destroy() {
    this.container.destroy(true);
    this.labels.clear();
  }
}
