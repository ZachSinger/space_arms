// ==========================================
// FILE: RoomLayout.js
// ==========================================
// World-cell size used by shop geometry, independent of the licensed art's source pixels.
// The full map reserves room for every planned expansion, even before those zones are built.
// See also: TileRoom.js (unlockZone).
import { floorTileKey, wallTileKey } from "./ShopTiles.js";

export const TILE_SIZE = 64; // px
export const MAX_MAP_GRID_WIDTH = 39;
export const MAX_MAP_GRID_HEIGHT = 21;

// Licensed sci-fi tiles for customer-facing zones; debug keys T/H cycle these in-game.
export const SALES_FLOOR_TILE = floorTileKey(0);
export const SALES_WALL_TILE = wallTileKey(0);

// The backroom (Storeroom + Loading Pad) is its own little map, shown in a window over the
// shop while the player is inside it. It sits far below the shop so the shop camera never
// sees it; the two areas connect only through their doors (see getBackroomDoorCell).
export const BACKROOM_GRID_Y = 100;
const BACKROOM_FLOOR_TILE = "floor_concrete_clean_01";
const BACKROOM_WALL_TILE = "wall_dark_riveted_01";
export const BACKROOM_DOOR_TILE = "door_blast_keypad_01";

// Expansion costs are paid in credits; all expansions also require a shop level.
export const ZONES = [
  {
    id: "storeroom",
    name: "Storeroom",
    gridX: 0,
    gridY: BACKROOM_GRID_Y,
    gridW: 6,
    gridH: 8,
    locked: false,
    backroom: true,
    floorTile: BACKROOM_FLOOR_TILE,
    wallTile: BACKROOM_WALL_TILE,
  },
  {
    id: "loading_pad",
    name: "Loading Pad",
    // Directly below the Storeroom, open to it on the north. Ordered crates spawn here.
    gridX: 0,
    gridY: BACKROOM_GRID_Y + 8,
    gridW: 6,
    gridH: 4,
    locked: false,
    backroom: true,
    floorTile: "floor_grate_01",
    wallTile: BACKROOM_WALL_TILE,
  },
  // Backroom upgrades, bought in this order. Each widens the backroom (and its window).
  {
    id: "backroom_upgrade_a",
    name: "Backroom Upgrade A",
    gridX: 6,
    gridY: BACKROOM_GRID_Y,
    gridW: 4,
    gridH: 12,
    locked: true,
    backroom: true,
    floorTile: BACKROOM_FLOOR_TILE,
    wallTile: BACKROOM_WALL_TILE,
    cost: 4000,
    requiredShopLevel: 13,
  },
  {
    id: "backroom_upgrade_b",
    name: "Backroom Upgrade B",
    gridX: 10,
    gridY: BACKROOM_GRID_Y,
    gridW: 4,
    gridH: 12,
    locked: true,
    backroom: true,
    floorTile: BACKROOM_FLOOR_TILE,
    wallTile: BACKROOM_WALL_TILE,
    cost: 6000,
    requiredShopLevel: 20,
  },
  {
    id: "backroom_upgrade_c",
    name: "Backroom Upgrade C",
    gridX: 14,
    gridY: BACKROOM_GRID_Y,
    gridW: 4,
    gridH: 12,
    locked: true,
    backroom: true,
    floorTile: BACKROOM_FLOOR_TILE,
    wallTile: BACKROOM_WALL_TILE,
    cost: 9000,
    requiredShopLevel: 27,
  },
  {
    id: "sales_floor",
    name: "Sales Floor",
    // Its west column is the wall facing the West expansion, where the backroom's wall stood.
    gridX: 5,
    gridY: 0,
    gridW: 11,
    gridH: 8,
    locked: false,
    salesFloor: true, // customer-facing: registers and shelves may only go in these zones
    floorTile: SALES_FLOOR_TILE,
    wallTile: SALES_WALL_TILE,
  },
  {
    id: "expansion_a",
    name: "Sales Floor Expansion A",
    gridX: 16,
    gridY: 0,
    gridW: 6,
    gridH: 8,
    locked: true,
    salesFloor: true,
    floorTile: SALES_FLOOR_TILE,
    wallTile: SALES_WALL_TILE,
    cost: 5000,
    requiredShopLevel: 9,
  },
  // Where the backroom used to stand, west of the starting Sales Floor.
  {
    id: "expansion_west",
    name: "Sales Floor Expansion West",
    gridX: 0,
    gridY: 0,
    gridW: 5,
    gridH: 8,
    locked: true,
    salesFloor: true,
    floorTile: SALES_FLOOR_TILE,
    wallTile: SALES_WALL_TILE,
    cost: 4000,
    requiredShopLevel: 5,
  },
  {
    id: "expansion_b",
    name: "Sales Floor Expansion B",
    gridX: 22,
    gridY: 0,
    gridW: 6,
    gridH: 8,
    locked: true,
    salesFloor: true,
    floorTile: SALES_FLOOR_TILE,
    wallTile: SALES_WALL_TILE,
    cost: 7500,
    requiredShopLevel: 17,
  },
  {
    id: "expansion_c",
    name: "Sales Floor Expansion C",
    gridX: 16,
    gridY: 8,
    gridW: 12,
    gridH: 5,
    locked: true,
    salesFloor: true,
    floorTile: SALES_FLOOR_TILE,
    wallTile: SALES_WALL_TILE,
    cost: 10000,
    requiredShopLevel: 24,
  },
  {
    id: "expansion_d",
    name: "Sales Floor Expansion D",
    gridX: 28,
    gridY: 0,
    gridW: 6,
    gridH: 13,
    locked: true,
    salesFloor: true,
    floorTile: SALES_FLOOR_TILE,
    wallTile: SALES_WALL_TILE,
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

/**
 * The Sales Floor's door to the backroom: in its north wall, near the right, clear of the
 * public door. Pressing E in front of it moves the player to the backroom's exit.
 * @returns {{ gx: number, gy: number }}
 */
export function getBackroomDoorCell() {
  const salesFloor = getZone("sales_floor");
  return { gx: salesFloor.gridX + salesFloor.gridW - 2, gy: salesFloor.gridY };
}

/**
 * The backroom's way back out: in the Storeroom's north wall. Pressing E in front of it returns the
 * player to the Sales Floor, just inside the backroom door.
 * @returns {{ gx: number, gy: number }}
 */
export function getBackroomExitCell() {
  const storeroom = getZone("storeroom");
  return { gx: storeroom.gridX + 4, gy: storeroom.gridY };
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
 * The shop's public door: in the Sales Floor's north wall, near the left, so the south
 * and east sides stay free for expansion and foot traffic avoids the register line.
 * Customers spawn on the cell just inside (one row south) and leave through it.
 * @returns {{ gx: number, gy: number }}
 */
export function getStoreDoorCell() {
  const salesFloor = getZone("sales_floor");
  return { gx: salesFloor.gridX + 2, gy: salesFloor.gridY };
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
