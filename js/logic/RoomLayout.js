// ==========================================
// FILE: RoomLayout.js
// ==========================================
// Authored shop footprint, in grid tiles, at its maximum expanded size. Locked zones exist
// in the data from the start but are walled off and outside camera bounds until unlocked,
// so the tilemap never has to grow at runtime.
// See also: TileRoom.js (unlockZone).
export const TILE_SIZE = 64; // px

// cost (credits) is a placeholder: no purchase flow checks it yet.
export const ZONES = [
  {
    id: "storeroom",
    name: "Storeroom",
    gridX: 0,
    gridY: 0,
    gridW: 6,
    gridH: 8,
    locked: false,
    floorTile: "floor_concrete_clean_01",
    wallTile: "wall_dark_riveted_01",
  },
  {
    id: "loading_pad",
    name: "Loading Pad",
    // Directly below the Storeroom, open to it on the north. Ordered crates spawn here.
    gridX: 0,
    gridY: 8,
    gridW: 6,
    gridH: 4,
    locked: false,
    floorTile: "floor_grate_01",
    wallTile: "wall_dark_riveted_01",
  },
  {
    id: "sales_floor",
    name: "Sales Floor",
    gridX: 6,
    gridY: 0,
    gridW: 10,
    gridH: 8,
    locked: false,
    salesFloor: true, // customer-facing: registers and shelves may only go in these zones
    floorTile: "floor_light_clean_01",
    wallTile: "wall_light_panel_01",
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
    floorTile: "floor_light_clean_01",
    wallTile: "wall_light_panel_01",
    cost: 5000,
  },
];

export function getZone(id) {
  return ZONES.find((zone) => zone.id === id);
}

/**
 * The shop's public door: in the Sales Floor's north wall, near the left, so the south
 * and east sides stay free for expansion and foot traffic avoids the register line.
 * Customers spawn on the cell just inside (one row south) and leave through it.
 * @returns {{ gx: number, gy: number }}
 */
export function getStoreDoorCell() {
  const salesFloor = getZone("sales_floor");
  return { gx: salesFloor.gridX + 1, gy: salesFloor.gridY };
}

export function getTotalGridSize() {
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
