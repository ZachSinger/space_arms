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
    id: "loading_pad",
    name: "Loading Pad",
    // Sits directly below the Storeroom (same gridX/gridW), connected by an open
    // walkway north into it -- matches MapExpansionPlan.md's step 2 (an unlocked-by-
    // default, exterior-coded zone adjacent to the Storeroom for ordered crates to spawn
    // in, hauled inside from there). Reuses the Storeroom's own industrial tile set
    // (riveted walls, plain concrete) rather than needing new art -- this doesn't need to
    // look dramatically different, just read as "the loading dock," not the sales floor.
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
