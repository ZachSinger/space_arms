// ==========================================
// FILE: ShelfItemDisplay.js
// ==========================================
// Draws each shelf placement on down-facing shelves using the same item, grid position,
// and quantity/capacity shown in the shelf window.
import { TILE_SIZE } from "./RoomLayout.js";
import { getFixtureType } from "./FixtureLayout.js";
import { getBudgetShelfArtForType } from "./BudgetShelfArt.js";
import { getShelfBoxes } from "./ShelfBoxLayout.js";
import { getItemCrateCategory } from "./CrateCategory.js";

const PIXEL_ART_FILTER = 1;
const SHELF_AREAS = Object.freeze({
  budget: Object.freeze({ left: 28 / 384, right: 364 / 384, top: 48 / 192, bottom: 172 / 192 }),
  legacy: Object.freeze({ left: 0.06, right: 0.94, top: 0.08, bottom: 0.92 }),
});
const IMAGE_INSET = 4 / 48;
const ITEM_TEXTURE_PREFIX = "shelf_item_";
const ITEM_IMAGE_LOADS = new WeakMap();

export function getShelfItemTextureKey(itemId) {
  return `${ITEM_TEXTURE_PREFIX}${itemId}`;
}

function getShelfArea(type) {
  const art = getBudgetShelfArtForType(getFixtureType(type));
  if (art) {
    return {
      left: art.columns[0][0] / art.width,
      right: art.columns.at(-1)[1] / art.width,
      top: art.rows[0][0] / art.height,
      bottom: art.rows.at(-1)[1] / art.height,
    };
  }
  if (type?.startsWith("shelf_budget_")) return SHELF_AREAS.budget;
  return SHELF_AREAS.legacy;
}

/**
 * Bounds for one placement, in world pixels relative to the shelf center.
 * @param {{ w: number, h: number }} gridDimensions - shelf size in floor tiles
 * @param {{ w: number, h: number }} displayGrid - shelf-window grid dimensions
 * @param {{ gx: number, gy: number, w: number, h: number }} placement
 * @param {{ left: number, right: number, top: number, bottom: number }} area
 */
export function getShelfItemBounds(gridDimensions, displayGrid, placement, area) {
  const left = -gridDimensions.w * TILE_SIZE / 2 + gridDimensions.w * TILE_SIZE * area.left;
  const top = -gridDimensions.h * TILE_SIZE / 2 + gridDimensions.h * TILE_SIZE * area.top;
  const cellWidth = gridDimensions.w * TILE_SIZE * (area.right - area.left) / displayGrid.w;
  const cellHeight = gridDimensions.h * TILE_SIZE * (area.bottom - area.top) / displayGrid.h;
  return {
    x: left + placement.gx * cellWidth,
    y: top + placement.gy * cellHeight,
    width: placement.w * cellWidth,
    height: placement.h * cellHeight,
  };
}

function requestItemTexture(scene, item, onReady) {
  const key = getShelfItemTextureKey(item.id);
  if (scene.textures.exists(key)) return key;
  if (!item.image) return null;

  let state = ITEM_IMAGE_LOADS.get(scene);
  if (!state) {
    state = { pending: new Map(), failed: new Set() };
    ITEM_IMAGE_LOADS.set(scene, state);
  }
  if (state.failed.has(key)) return null;
  if (state.pending.has(key)) {
    state.pending.get(key).add(onReady);
    return null;
  }

  if (typeof Image === "undefined") {
    throw new Error("Cannot load shelf item images outside a browser.");
  }
  const image = new Image();
  state.pending.set(key, new Set([onReady]));
  image.onload = () => {
    const callbacks = state.pending.get(key);
    state.pending.delete(key);
    if (!scene.textures.exists(key)) {
      scene.textures.addImage(key, image).setFilter(PIXEL_ART_FILTER);
    }
    for (const callback of callbacks ?? []) callback();
  };
  image.onerror = () => {
    state.pending.delete(key);
    state.failed.add(key);
    console.error(`Unable to load shelf item image "${item.image}" for ${item.name}.`);
  };
  image.src = item.image;
  return null;
}

export class ShelfItemDisplay {
  constructor(scene, fixture, getItem) {
    this.scene = scene;
    this.fixture = fixture;
    this.getItem = getItem;
    this.entries = new Map();
    this.boxImages = [];
    this.destroyed = false;
    this.container = scene.add.container(fixture.x, fixture.y).setDepth(2.5);
    this.graphics = scene.add.graphics();
    this.container.add(this.graphics);
    this.setAngle((fixture.rotation ?? 0) * 90);
  }

  setPosition(x, y) {
    this.container.setPosition(x, y);
  }

  setAngle(angle) {
    const normalized = ((angle % 360) + 360) % 360;
    this.container.setVisible(normalized === 0);
    if (normalized === 0) this.sync();
  }

  sync() {
    if (this.destroyed || !this.container.visible) return;
    if (this.fixture.handsOn) {
      this.syncBoxes();
      return;
    }
    const { displayGrid, gridDimensions, type, placements } = this.fixture;
    const area = getShelfArea(type);
    const visible = new Set(placements);
    this.graphics.clear();

    for (const [placement, entry] of this.entries) {
      if (visible.has(placement)) continue;
      entry.image?.destroy();
      entry.count.destroy();
      this.entries.delete(placement);
    }

    for (const placement of placements) {
      const item = this.getItem(placement.itemId);
      if (!item) throw new Error(`Unknown shelf item: ${placement.itemId}`);
      const bounds = getShelfItemBounds(gridDimensions, displayGrid, placement, area);
      const paddingX = bounds.width / placement.w * IMAGE_INSET;
      const paddingY = bounds.height / placement.h * IMAGE_INSET;
      this.graphics
        .fillStyle(0x090d16, 0.8)
        .fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
        .lineStyle(1, 0x8795a7, 0.75)
        .strokeRect(bounds.x + 0.5, bounds.y + 0.5, bounds.width - 1, bounds.height - 1);

      let entry = this.entries.get(placement);
      if (!entry) {
        const count = this.scene.add.text(0, 0, "", {
          fontFamily: "Courier New, monospace",
          fontSize: "6px",
          fontStyle: "bold",
          color: "#e2e8f0",
          backgroundColor: "rgba(0, 0, 0, 0.7)",
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
        }).setOrigin(1, 1);
        entry = { image: null, count };
        this.entries.set(placement, entry);
        this.container.add(count);
      }

      const textureKey = requestItemTexture(this.scene, item, () => {
        if (!this.destroyed) this.sync();
      });
      if (textureKey) {
        if (!entry.image) {
          entry.image = this.scene.add.image(0, 0, textureKey);
          this.container.add(entry.image);
        } else {
          entry.image.setTexture(textureKey);
        }
        const source = this.scene.textures.get(textureKey).getSourceImage();
        const imageWidth = Math.max(0, bounds.width - paddingX * 2);
        const imageHeight = Math.max(0, bounds.height - paddingY * 2);
        entry.image
          .setPosition(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
          .setScale(Math.min(imageWidth / source.width, imageHeight / source.height))
          .setAlpha(placement.quantity > 0 ? 1 : 0.35);
      } else if (entry.image) {
        entry.image.setVisible(false);
      }

      entry.count
        .setText(`${Math.max(0, placement.quantity)}/${this.fixture.getPlacementCapacity(placement)}`)
        .setPosition(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1)
        .setVisible(true);
      entry.image?.setVisible(Boolean(textureKey));
      this.container.bringToTop(entry.count);
    }
  }

  syncBoxes() {
    const signature = JSON.stringify(this.fixture.placements);
    if (this.boxSignature === signature) return;
    this.boxSignature = signature;
    for (const image of this.boxImages) image.destroy();
    this.boxImages = [];
    const art = getBudgetShelfArtForType(getFixtureType(this.fixture.type));
    const scale = this.fixture.gridDimensions.w * TILE_SIZE / art.width;
    const left = -art.width * scale / 2;
    const top = -art.height * scale / 2;
    for (const placement of this.fixture.placements) {
      const item = this.getItem(placement.itemId);
      if (!item) throw new Error(`Unknown shelf item: ${placement.itemId}`);
      for (const box of getShelfBoxes(art, placement.gx, placement.gy, item.boxSize, placement.quantity)) {
        const image = this.scene.add.image(left + box.x * scale, top + box.y * scale,
          `shelf_box_${getItemCrateCategory(item.tags)}`)
          .setOrigin(0, 0).setDisplaySize(box.width * scale, box.height * scale);
        if (box.back) image.setTint(0x8a8a9a);
        this.container.add(image);
        this.boxImages.push(image);
      }
    }
  }

  destroy() {
    this.destroyed = true;
    this.container.destroy(true);
    this.entries.clear();
  }
}
