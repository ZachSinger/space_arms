// ==========================================
// FILE: ShelfIconDisplay.js
// ==========================================
// Compact category icons and quantities for the shop-floor shelves. One badge represents
// one placement, including sold-out placements kept for restocking.
// Retired: icons can't follow a turned shelf's shape; shelves use ShelfAttentionHighlight.
import { getShelfDisplayGrid } from "./FixtureLayout.js";

export const SHELF_CATEGORY_TEXTURES = Object.freeze({
  Ammunition: "shelf_category_ammunition",
  Apparel: "shelf_category_apparel",
  Armor: "shelf_category_armor",
  Attachment: "shelf_category_attachment",
  Firearm: "shelf_category_firearm",
  Melee: "shelf_category_melee",
  Survival: "shelf_category_survival",
  Tool: "shelf_category_tool",
});

const BADGE_WIDTH = 32;
const BADGE_HEIGHT = 24;
const ROW_HEIGHT = 24;
const OFFSET_Y = 8;
// Icon art is authored at 24x24; drawing it 1:1 keeps every pixel sharp.
const ICON_SIZE = 24;
const COUNT_PIXEL_SIZE = 2;
const COUNT_DIGITS = Object.freeze([
  ["111", "101", "101", "101", "111"],
  ["010", "110", "010", "010", "111"],
  ["111", "001", "111", "100", "111"],
  ["111", "001", "111", "001", "111"],
  ["101", "101", "111", "001", "001"],
  ["111", "100", "111", "001", "111"],
  ["111", "100", "111", "101", "111"],
  ["111", "001", "010", "010", "010"],
  ["111", "101", "111", "101", "111"],
  ["111", "101", "111", "001", "111"],
]);

export function getShelfCountPixelRects(quantity, right, bottom) {
  const digits = String(Math.max(0, quantity));
  const digitWidth = 3 * COUNT_PIXEL_SIZE;
  const digitHeight = 5 * COUNT_PIXEL_SIZE;
  const spacing = COUNT_PIXEL_SIZE;
  const padding = 1;
  const contentWidth = digits.length * digitWidth + (digits.length - 1) * spacing;
  const boxWidth = contentWidth + padding * 2;
  const boxHeight = digitHeight + padding * 2;
  const boxX = right - boxWidth - 1;
  const boxY = bottom - boxHeight - 1;
  const rects = [{
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
    color: 0x05080d,
  }];

  for (let digitIndex = 0; digitIndex < digits.length; digitIndex += 1) {
    const pattern = COUNT_DIGITS[Number(digits[digitIndex])];
    for (let row = 0; row < pattern.length; row += 1) {
      for (let column = 0; column < pattern[row].length; column += 1) {
        if (pattern[row][column] !== "1") continue;
        rects.push({
          x: boxX + padding + digitIndex * (digitWidth + spacing) + column * COUNT_PIXEL_SIZE,
          y: boxY + padding + row * COUNT_PIXEL_SIZE,
          width: COUNT_PIXEL_SIZE,
          height: COUNT_PIXEL_SIZE,
          color: 0xffffff,
        });
      }
    }
  }
  return rects;
}

export function getShelfCategoryTexture(item) {
  const category = item?.tags?.[0];
  if (!Object.hasOwn(SHELF_CATEGORY_TEXTURES, category)) {
    throw new RangeError(`No shelf icon for item category: ${category}`);
  }
  return SHELF_CATEGORY_TEXTURES[category];
}

/**
 * Upright badges fit the rotated floor footprint, independently of item dimensions.
 * @param {{ w: number, h: number }} gridDimensions
 * @param {number} index - placement's reading-order index
 * @param {number} angle - fixture angle in degrees
 */
export function getShelfIconBounds(gridDimensions, index, angle = 0) {
  const sideways = Math.abs(angle / 90) % 2 === 1;
  const grid = getShelfDisplayGrid(sideways
    ? { w: gridDimensions.h, h: gridDimensions.w }
    : gridDimensions);
  if (!Number.isInteger(index) || index < 0 || index >= grid.w * grid.h) {
    throw new RangeError(`Shelf icon index is outside the shelf: ${index}`);
  }
  return {
    x: -(grid.w * BADGE_WIDTH) / 2 + (index % grid.w) * BADGE_WIDTH,
    y: -(grid.h * ROW_HEIGHT) / 2 + Math.floor(index / grid.w) * ROW_HEIGHT,
    width: BADGE_WIDTH,
    height: BADGE_HEIGHT,
  };
}

export class ShelfIconDisplay {
  constructor(scene, fixture, getItem) {
    this.scene = scene;
    this.fixture = fixture;
    this.getItem = getItem;
    this.angle = 0;
    this.container = scene.add.container(fixture.x, fixture.y + OFFSET_Y).setDepth(3);
    this.graphics = scene.add.graphics();
    this.container.add(this.graphics);
    this.entries = new Map();
  }

  setPosition(x, y) {
    this.container.setPosition(x, y + OFFSET_Y);
  }

  // The shelf turns, but the icon-and-count pairs stay upright in every view.
  setAngle(angle) {
    if (this.angle === angle) return;
    this.angle = angle;
    this.sync();
  }

  sync() {
    const placements = [...this.fixture.placements]
      .sort((a, b) => a.gy - b.gy || a.gx - b.gx);
    const badges = placements.map((placement, index) => {
      const item = this.getItem(placement.itemId);
      if (!item) throw new Error(`Unknown shelf item: ${placement.itemId}`);
      const texture = getShelfCategoryTexture(item);
      if (!this.scene.textures.exists(texture)) {
        throw new Error(`Shelf icon texture is not loaded: ${texture}`);
      }
      return {
        placement,
        texture,
        bounds: getShelfIconBounds(this.fixture.gridDimensions, index, this.angle),
      };
    });

    const visible = new Set(placements);
    for (const [placement, entry] of this.entries) {
      if (visible.has(placement)) continue;
      entry.icon.destroy();
      entry.count.destroy();
      this.entries.delete(placement);
    }
    this.graphics.clear();

    for (const { placement, texture, bounds } of badges) {
      let entry = this.entries.get(placement);
      if (!entry) {
        const icon = this.scene.add.image(0, 0, texture).setDisplaySize(ICON_SIZE, ICON_SIZE);
        const count = this.scene.add.graphics();
        entry = { icon, count };
        this.entries.set(placement, entry);
        this.container.add([icon, count]);
      }
      const { x, y, width, height } = bounds;
      this.graphics
        .fillStyle(0x05080d, 0.65)
        .fillRect(x, y, width, height)
        .lineStyle(1, 0x8795a7, 0.65)
        .strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
      entry.icon.setTexture(texture).setPosition(x + ICON_SIZE / 2, y + height / 2);
      entry.count.clear();
      for (const rect of getShelfCountPixelRects(placement.quantity, x + width, y + height)) {
        entry.count.fillStyle(rect.color, 1).fillRect(rect.x, rect.y, rect.width, rect.height);
      }
    }
  }

  destroy() {
    this.container.destroy(true);
    this.entries.clear();
  }
}
