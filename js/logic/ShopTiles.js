// ==========================================
// FILE: ShopTiles.js
// ==========================================
// Floor and wall art for the sales floor, cut from the TileSetB map painted in Tiled
// (img/Tilesets/TiledProject/Maps/TileSetB.tmx). Each game square shows 2x2 of the map's
// 48px tiles, so the room's pixels are the same size as the characters' (96 sheet px -> 64).
// Every wall is the riveted border, except the back wall's lower row, which shows the
// wall's face with the doors set into it.
// The art pack is licensed for local game use only and is never committed (see .gitignore).
// See also: TileRoom.js (which wall cells exist and drawing them).

export const SHOP_TILES = Object.freeze({
  floor: "shop_floor",
  // The floor square just inside the front door.
  doormat: "shop_doormat",
  border: "shop_border",
  backWall: "shop_back_wall",
  // The back wall squares either side of the front door, each with a pair of lights
  // on the side nearest the door.
  lightsLeftOfDoor: "shop_wall_lights_left",
  lightsRightOfDoor: "shop_wall_lights_right",
});

// Full paths written out so the production build finds and copies them (see vite.config.js).
export const SHOP_TILE_ASSETS = Object.freeze([
  { key: SHOP_TILES.floor, path: "img/Icons_Extracted/Tileset/Shop/shop_floor.png" },
  { key: SHOP_TILES.doormat, path: "img/Icons_Extracted/Tileset/Shop/shop_doormat.png" },
  { key: SHOP_TILES.border, path: "img/Icons_Extracted/Tileset/Shop/shop_border.png" },
  { key: SHOP_TILES.backWall, path: "img/Icons_Extracted/Tileset/Shop/shop_back_wall.png" },
  { key: SHOP_TILES.lightsLeftOfDoor, path: "img/Icons_Extracted/Tileset/Shop/shop_wall_lights_left.png" },
  { key: SHOP_TILES.lightsRightOfDoor, path: "img/Icons_Extracted/Tileset/Shop/shop_wall_lights_right.png" },
].map(Object.freeze));

export const SHOP_FLOOR_TILE = SHOP_TILES.floor;

/**
 * Art for one wall cell of the sales floor, chosen by what's around it so the walls always
 * hug the unlocked area: the border on every outside edge, and the wall's face along the
 * back wall's lower row (the row the doors sit in).
 * @param {number} gx
 * @param {number} gy
 * @param {(gx: number, gy: number) => boolean} isOpen - true for cells in an unlocked zone
 * @param {number | null} [storeDoorGX] - the front door's column, which gets lights on each side
 * @returns {string[]} texture keys, bottom layer first
 */
export function shopWallStack(gx, gy, isOpen, storeDoorGX = null) {
  const backWallFace = isOpen(gx - 1, gy) && isOpen(gx + 1, gy) && isOpen(gx, gy - 1) && !isOpen(gx, gy - 2);
  if (!backWallFace) return [SHOP_TILES.border];
  if (storeDoorGX !== null && gx === storeDoorGX - 1) return [SHOP_TILES.lightsLeftOfDoor];
  if (storeDoorGX !== null && gx === storeDoorGX + 1) return [SHOP_TILES.lightsRightOfDoor];
  return [SHOP_TILES.backWall];
}
