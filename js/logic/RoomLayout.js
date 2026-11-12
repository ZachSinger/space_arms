// ==========================================
// FILE: RoomLayout.js
// ==========================================
// World-cell size used by shop geometry, independent of the licensed art's source pixels.
// The full map reserves room for every planned expansion, even before those zones are built.
// See also: TileRoom.js (unlockZone).
import { SHOP_FLOOR_TILE } from "./ShopTiles.js";
import { BACKROOM_TILES } from "./BackroomTiles.js";

export const TILE_SIZE = 64; // px
export const MAX_MAP_GRID_WIDTH = 39;
export const MAX_MAP_GRID_HEIGHT = 21;

// The backroom (Storeroom + Loading Pad) is its own little map, shown in a window over the
// shop while the player is inside it. It sits far below the shop so the shop camera never
// sees it; the two areas connect only through their doors (see getBackroomDoorCell).
// Its floor and walls use the BackroomA map's art (see BackroomTiles.js).
export const BACKROOM_GRID_Y = 100;
const BACKROOM_FLOOR_TILE = BACKROOM_TILES.floor;
export const LOADING_PAD_WIDTH = 128;
export const LOADING_PAD_HEIGHT = 128;
const BACKROOM_GRID_WIDTH = LOADING_PAD_WIDTH / TILE_SIZE + 2;

// Expansion costs are paid in credits; all expansions also require a shop level.
// Sales-floor zones together fill the 34x13 ShopA map. Bought in order, each one keeps the
// shop a rectangle, and their walls use TileSetB's art (see ShopTiles.js).
export const ZONES = [
  {
    id: "storeroom",
    name: "Storeroom",
    gridX: 0,
    gridY: BACKROOM_GRID_Y,
    gridW: BACKROOM_GRID_WIDTH,
    gridH: 3,
    locked: false,
    backroom: true,
    floorTile: BACKROOM_FLOOR_TILE,
  },
  {
    id: "loading_pad",
    name: "Loading Pad",
    // Directly below the Storeroom, open to it on the north. Ordered crates spawn here.
    gridX: 0,
    gridY: BACKROOM_GRID_Y + 3,
    gridW: BACKROOM_GRID_WIDTH,
    gridH: 3,
    locked: false,
    backroom: true,
    floorTile: BACKROOM_FLOOR_TILE,
  },
  // Backroom upgrades, bought in this order. Each widens the backroom (and its window).
  {
    id: "backroom_upgrade_a",
    name: "Backroom Upgrade A",
    gridX: BACKROOM_GRID_WIDTH,
    gridY: BACKROOM_GRID_Y,
    gridW: 2,
    gridH: 6,
    locked: true,
    backroom: true,
    floorTile: BACKROOM_FLOOR_TILE,
    cost: 4000,
    requiredShopLevel: 13,
  },
  {
    id: "backroom_upgrade_b",
    name: "Backroom Upgrade B",
    gridX: BACKROOM_GRID_WIDTH + 2,
    gridY: BACKROOM_GRID_Y,
    gridW: 2,
    gridH: 6,
    locked: true,
    backroom: true,
    floorTile: BACKROOM_FLOOR_TILE,
    cost: 6000,
    requiredShopLevel: 20,
  },
  {
    id: "backroom_upgrade_c",
    name: "Backroom Upgrade C",
    gridX: BACKROOM_GRID_WIDTH + 4,
    gridY: BACKROOM_GRID_Y,
    gridW: 2,
    gridH: 6,
    locked: true,
    backroom: true,
    floorTile: BACKROOM_FLOOR_TILE,
    cost: 9000,
    requiredShopLevel: 27,
  },
  // The top center of the ShopA map: the store's front door and the backroom door are both in its back wall.
  {
    id: "sales_floor",
    name: "Sales Floor",
    gridX: 12,
    gridY: 0,
    gridW: 11,
    gridH: 9,
    locked: false,
    salesFloor: true, // customer-facing: registers and shelves may only go in these zones
    floorTile: SHOP_FLOOR_TILE,
  },
  {
    id: "expansion_west",
    name: "Sales Floor Expansion West",
    gridX: 6,
    gridY: 0,
    gridW: 6,
    gridH: 9,
    locked: true,
    salesFloor: true,
    floorTile: SHOP_FLOOR_TILE,
    cost: 4000,
    requiredShopLevel: 5,
  },
  {
    id: "expansion_a",
    name: "Sales Floor Expansion A",
    gridX: 23,
    gridY: 0,
    gridW: 6,
    gridH: 9,
    locked: true,
    salesFloor: true,
    floorTile: SHOP_FLOOR_TILE,
    cost: 5000,
    requiredShopLevel: 9,
  },
  // Runs under the West expansion, the Sales Floor, and Expansion A.
  {
    id: "expansion_b",
    name: "Sales Floor Expansion B",
    gridX: 6,
    gridY: 9,
    gridW: 23,
    gridH: 4,
    locked: true,
    salesFloor: true,
    floorTile: SHOP_FLOOR_TILE,
    cost: 7500,
    requiredShopLevel: 17,
  },
  {
    id: "expansion_c",
    name: "Sales Floor Expansion C",
    gridX: 0,
    gridY: 0,
    gridW: 6,
    gridH: 13,
    locked: true,
    salesFloor: true,
    floorTile: SHOP_FLOOR_TILE,
    cost: 10000,
    requiredShopLevel: 24,
  },
  {
    id: "expansion_d",
    name: "Sales Floor Expansion D",
    gridX: 29,
    gridY: 0,
    gridW: 5,
    gridH: 13,
    locked: true,
    salesFloor: true,
    floorTile: SHOP_FLOOR_TILE,
    cost: 12500,
    requiredShopLevel: 30,
  },
];

// Sales-floor expansions in the order the player buys them.
export const EXPANSION_ORDER = ["expansion_west", "expansion_a", "expansion_b", "expansion_c", "expansion_d"];

// Backroom upgrades in the order the player buys them.
export const BACKROOM_UPGRADE_ORDER = [
  "backroom_upgrade_a", "backroom_upgrade_b", "backroom_upgrade_c",
];

export function getZone(id) {
  return ZONES.find((zone) => zone.id === id);
}

// The shop's back wall is two tiles tall; doors sit in its lower row, next to the floor.
export const SHOP_BACK_WALL_HEIGHT = 2;

/**
 * The Sales Floor's door to the backroom: a glass door in the back wall, near the right of
 * the Sales Floor. Pressing E in front of it moves the player to the backroom's exit.
 * @returns {{ gx: number, gy: number }}
 */
export function getBackroomDoorCell() {
  const salesFloor = getZone("sales_floor");
  return { gx: salesFloor.gridX + salesFloor.gridW - 2, gy: salesFloor.gridY + SHOP_BACK_WALL_HEIGHT - 1 };
}

/**
 * The backroom's way back out: a glass door at the right end of the Storeroom's back wall
 * (the backroom's top-right when it's its starting size). Pressing E in front of it returns the
 * player to the Sales Floor, just inside the backroom door.
 * @returns {{ gx: number, gy: number }}
 */
export function getBackroomExitCell() {
  const storeroom = getZone("storeroom");
  return { gx: storeroom.gridX + 2, gy: storeroom.gridY };
}

export function getBackroomBounds(zones = ZONES) {
  const unlocked = zones.filter((zone) => zone.backroom && !zone.locked);
  const x = Math.min(...unlocked.map((zone) => zone.gridX)) * TILE_SIZE;
  const y = Math.min(...unlocked.map((zone) => zone.gridY)) * TILE_SIZE;
  const right = Math.max(...unlocked.map((zone) => zone.gridX + zone.gridW)) * TILE_SIZE;
  const bottom = Math.max(...unlocked.map((zone) => zone.gridY + zone.gridH)) * TILE_SIZE;
  return { x, y, width: right - x, height: bottom - y };
}

export function getBackroomInteriorBounds(zones = ZONES) {
  const bounds = getBackroomBounds(zones);
  return {
    left: bounds.x + TILE_SIZE, top: bounds.y + TILE_SIZE,
    right: bounds.x + bounds.width - TILE_SIZE, bottom: bounds.y + bounds.height - TILE_SIZE,
  };
}

export function getLoadingPadBounds() {
  const storeroom = getZone("storeroom");
  const left = (storeroom.gridX + 1) * TILE_SIZE;
  const bottom = (BACKROOM_GRID_Y + 5) * TILE_SIZE;
  return { left, right: left + LOADING_PAD_WIDTH, top: bottom - LOADING_PAD_HEIGHT, bottom };
}

/**
 * The floor cells just inside each door, which a walk between the shop and the backroom
 * passes through (both doors are in north walls, so one step south).
 * @returns {{ shop: { gx: number, gy: number }, backroom: { gx: number, gy: number } }}
 */
export function getBackroomLink() {
  const door = getBackroomDoorCell();
  const exit = getBackroomExitCell();
  return { shop: { gx: door.gx, gy: door.gy + 1 }, backroom: { gx: exit.gx, gy: exit.gy + 1 } };
}

/**
 * True for any point in the backroom's part of the world, built or not.
 * @param {number} gridY
 */
export function isBackroomRow(gridY) {
  return gridY >= BACKROOM_GRID_Y - 1;
}

/**
 * The shop's public door: one double door in the back wall that customers both arrive and
 * leave through. Customers spawn just inside it (one row south).
 * @returns {{ gx: number, gy: number }}
 */
export function getStoreDoorCell() {
  const salesFloor = getZone("sales_floor");
  return { gx: salesFloor.gridX + 4, gy: salesFloor.gridY + SHOP_BACK_WALL_HEIGHT - 1 };
}

/** Every cell of the store's doorway (it's one cell wide). */
export function getStoreDoorCells() {
  return [getStoreDoorCell()];
}

export function getTotalGridSize() {
  return { gridW: MAX_MAP_GRID_WIDTH, gridH: MAX_MAP_GRID_HEIGHT };
}

/**
 * Bounding size of the zones currently authored in ZONES, including locked zones.
 * Use this for physical bounds that should not extend into future, unbuilt zones.
 */
export function getAuthoredGridSize() {
  const maxX = Math.max(...ZONES.map((zone) => zone.gridX + zone.gridW));
  const maxY = Math.max(...ZONES.map((zone) => zone.gridY + zone.gridH));
  return { gridW: maxX, gridH: maxY };
}

/**
 * Find which zone owns a grid cell.
 * @param {number} gridX
 * @param {number} gridY
 * @param {object[]} zones
 * @returns {object | null} null if no authored zone covers the cell
 */
export function zoneAt(gridX, gridY, zones = ZONES) {
  return (
    zones.find(
      (zone) =>
        gridX >= zone.gridX &&
        gridX < zone.gridX + zone.gridW &&
        gridY >= zone.gridY &&
        gridY < zone.gridY + zone.gridH,
    ) || null
  );
}
