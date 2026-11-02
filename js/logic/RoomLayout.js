// ==========================================
// FILE: RoomLayout.js
// ==========================================
// Authored shop footprint, in grid tiles. This defines the *maximum* possible
// expanded store up front: every zone's tiles exist in the data from the start,
// but "locked" zones are walled off and excluded from the camera's scrollable
// bounds until unlocked (see TileRoom.unlockZone). This avoids ever needing to
// grow the tilemap at runtime -- expanding the store just means revealing and
// opening up a zone that was already there.
export const TILE_SIZE = 64;

// cost is a placeholder for a future "buy expansion" UI; no economy/purchase
// flow exists yet, so unlocking currently has no real cost check attached.
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
    id: "sales_floor",
    name: "Sales Floor",
    gridX: 6,
    gridY: 0,
    gridW: 10,
    gridH: 8,
    locked: false,
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
    floorTile: "floor_light_clean_01",
    wallTile: "wall_light_panel_01",
    cost: 5000,
  },
];

export function getZone(id) {
  return ZONES.find((zone) => zone.id === id);
}

export function getTotalGridSize() {
  const maxX = Math.max(...ZONES.map((zone) => zone.gridX + zone.gridW));
  const maxY = Math.max(...ZONES.map((zone) => zone.gridY + zone.gridH));
  return { gridW: maxX, gridH: maxY };
}

// Finds which zone owns a given grid cell, or null if the cell isn't covered
// by any authored zone.
export function zoneAt(gridX, gridY) {
  return (
    ZONES.find(
      (zone) =>
        gridX >= zone.gridX &&
        gridX < zone.gridX + zone.gridW &&
        gridY >= zone.gridY &&
        gridY < zone.gridY + zone.gridH,
    ) || null
  );
}
