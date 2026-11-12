// ==========================================
// FILE: BackroomTiles.js
// ==========================================
// Floor and wall art for the backroom, cut from the BackroomA map painted in Tiled
// (img/Tilesets/TiledProject/Tilesets/BackroomA.tmx). Like the sales floor, each game square
// shows 2x2 of the map's 48px tiles. The back wall's face runs along the top; every other
// wall is the black border. Floor squares next to a wall get the floor's dark edge, and a
// striped lip along the bottom wall.
// The art pack is licensed for local game use only and is never committed (see .gitignore).
// See also: TileRoom.js (which wall cells exist and drawing them), ShopTiles.js.

export const BACKROOM_TILES = Object.freeze({
  floor: "backroom_floor",
  floorLeft: "backroom_floor_left",
  floorRight: "backroom_floor_right",
  floorBottom: "backroom_floor_bottom",
  floorBottomLeft: "backroom_floor_bottom_left",
  floorBottomRight: "backroom_floor_bottom_right",
  wall: "backroom_wall",
  border: "backroom_border",
});

// Full paths written out so the production build finds and copies them (see vite.config.js).
export const BACKROOM_TILE_ASSETS = Object.freeze([
  { key: BACKROOM_TILES.floor, path: "img/Icons_Extracted/Tileset/Backroom/backroom_floor.png" },
  { key: BACKROOM_TILES.floorLeft, path: "img/Icons_Extracted/Tileset/Backroom/backroom_floor_left.png" },
  { key: BACKROOM_TILES.floorRight, path: "img/Icons_Extracted/Tileset/Backroom/backroom_floor_right.png" },
  { key: BACKROOM_TILES.floorBottom, path: "img/Icons_Extracted/Tileset/Backroom/backroom_floor_bottom.png" },
  {
    key: BACKROOM_TILES.floorBottomLeft,
    path: "img/Icons_Extracted/Tileset/Backroom/backroom_floor_bottom_left.png",
  },
  {
    key: BACKROOM_TILES.floorBottomRight,
    path: "img/Icons_Extracted/Tileset/Backroom/backroom_floor_bottom_right.png",
  },
  { key: BACKROOM_TILES.wall, path: "img/Icons_Extracted/Tileset/Backroom/backroom_wall.png" },
  { key: BACKROOM_TILES.border, path: "img/Icons_Extracted/Tileset/Backroom/backroom_border.png" },
].map(Object.freeze));

/**
 * Art for one backroom wall cell: the wall's face along the top (the row the exit door sits
 * in), and the black border everywhere else, so it always hugs the unlocked area.
 * @param {number} gx
 * @param {number} gy
 * @param {(gx: number, gy: number) => boolean} isOpen - true for cells in an unlocked zone
 * @returns {string[]} texture keys, bottom layer first
 */
export function backroomWallStack(gx, gy, isOpen) {
  const backWallFace = isOpen(gx - 1, gy) && isOpen(gx + 1, gy) && !isOpen(gx, gy - 1);
  return [backWallFace ? BACKROOM_TILES.wall : BACKROOM_TILES.border];
}

/**
 * Art for one backroom floor cell, edged on the sides that touch a wall.
 * @param {number} gx
 * @param {number} gy
 * @param {(gx: number, gy: number) => boolean} isFloor - true for walkable floor (not a wall)
 * @returns {string}
 */
export function backroomFloorArt(gx, gy, isFloor) {
  const left = !isFloor(gx - 1, gy);
  const right = !left && !isFloor(gx + 1, gy);
  const bottom = !isFloor(gx, gy + 1);
  if (bottom) {
    if (left) return BACKROOM_TILES.floorBottomLeft;
    return right ? BACKROOM_TILES.floorBottomRight : BACKROOM_TILES.floorBottom;
  }
  if (left) return BACKROOM_TILES.floorLeft;
  return right ? BACKROOM_TILES.floorRight : BACKROOM_TILES.floor;
}
