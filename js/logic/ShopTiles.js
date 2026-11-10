// ==========================================
// FILE: ShopTiles.js
// ==========================================
// Floor and wall art for the sales floor, copied from the ShopA map painted in Tiled
// (img/Tilesets/TiledProject/Tilesets/ShopA.tmx). Each wall cell is a stack of 32px tiles
// from the Research Station "Base" atlas, some flipped or rotated, drawn at 2x.
// The atlas is licensed for local game use only and is never committed (see .gitignore).
// See also: TileRoom.js (which wall cells exist and drawing them).

export const SHOP_ATLAS = {
  key: "research_base_atlas",
  path: "img/Tilesets/Research_Station_FULL_v0.6.0/Art/Atlases/Base_00.png",
};

const SOURCE_TILE = 32; // px
const ATLAS_MARGIN = 4;
const ATLAS_SPACING = 8;
const ATLAS_COLUMNS = 10;

// Tiles are written as in Tiled: the tile number, then H (flipped left-right),
// V (flipped top-bottom) and D (flipped diagonally; with H or V this makes a rotation).
// Each stack lists the map's layers from bottom to top, using one sample cell of ShopA.
const STACKS = {
  floor: ["1"],
  west: ["1", "3HVD", "86", "86HV"], // left side wall, ShopA column 0
  east: ["1", "3D", "86", "86HV"], // right side wall, ShopA column 33
  topUpper: ["3", "86VD", "21"], // back wall, upper half (ShopA row 0)
  topLower: ["1", "21V"], // back wall, lower half (ShopA row 1)
  bottom: ["3V", "86HD", "86VD"], // front wall, ShopA row 12
  passageUpper: ["3", "16"], // the gap in the back wall leading to the backroom
  passageLower: ["1"],
};
const COLUMN_UPPER = "42";
const COLUMN_LOWER = "38";

// The back wall's visible face, in tiles measured down from the top of its upper half.
// Above it is a dark band (atlas rows 0-2) and below it is floor (atlas rows 56-63).
export const SHOP_BACK_WALL_FACE = { top: 3 / SOURCE_TILE, bottom: 56 / SOURCE_TILE };

// Map columns where ShopA has a support column standing in the back wall.
export const SHOP_COLUMN_GX = [2, 8, 15, 18, 25, 30];

export const shopTileKey = (code) => `shop_tile_${code}`;
const keys = (codes) => codes.map(shopTileKey);

export const SHOP_FLOOR_TILE = shopTileKey(STACKS.floor[0]);
export const BACKROOM_PASSAGE_UPPER = keys(STACKS.passageUpper);
export const BACKROOM_PASSAGE_LOWER = keys(STACKS.passageLower);

const ALL_CODES = [...new Set([...Object.values(STACKS).flat(), COLUMN_UPPER, COLUMN_LOWER])];

/**
 * Parse a Tiled-style tile code such as "86HV".
 * @param {string} code
 */
export function parseTileCode(code) {
  const match = /^(\d+)(H?)(V?)(D?)$/.exec(code);
  if (!match) throw new RangeError(`Bad tile code: ${code}`);
  return { tileId: Number(match[1]), flipH: match[2] === "H", flipV: match[3] === "V", diagonal: match[4] === "D" };
}

/**
 * Where a tile sits on the atlas. Tile 1 is the top-left tile.
 * @param {number} tileId
 */
export function atlasSourceRect(tileId) {
  const index = tileId - 1;
  const step = SOURCE_TILE + ATLAS_SPACING;
  return {
    x: ATLAS_MARGIN + (index % ATLAS_COLUMNS) * step,
    y: ATLAS_MARGIN + Math.floor(index / ATLAS_COLUMNS) * step,
    size: SOURCE_TILE,
  };
}

/**
 * The source pixel shown at (x, y) of a flipped tile. Tiled flips diagonally first, then
 * left-right, then top-bottom, so this undoes them in reverse.
 */
export function sourcePixel(x, y, { flipH, flipV, diagonal }, size = SOURCE_TILE) {
  const px = flipH ? size - 1 - x : x;
  const py = flipV ? size - 1 - y : y;
  return diagonal ? [py, px] : [px, py];
}

/**
 * Art for one wall cell of the sales floor, chosen by what's around it so the walls always
 * hug the unlocked area: side walls on the left and right, a two-tile back wall along the
 * top of the map (with ShopA's columns), and a front wall along the bottom.
 * @param {number} gx
 * @param {number} gy
 * @param {(gx: number, gy: number) => boolean} isOpen - true for cells in an unlocked zone
 * @returns {string[]} texture keys, bottom layer first
 */
export function shopWallStack(gx, gy, isOpen) {
  const column = SHOP_COLUMN_GX.includes(gx);
  if (!isOpen(gx - 1, gy)) return keys(STACKS.west);
  if (!isOpen(gx + 1, gy)) return keys(STACKS.east);
  if (!isOpen(gx, gy - 1)) return keys(column ? [...STACKS.topUpper, COLUMN_UPPER] : STACKS.topUpper);
  if (!isOpen(gx, gy - 2)) return keys(column ? [...STACKS.topLower, COLUMN_LOWER] : STACKS.topLower);
  return keys(STACKS.bottom);
}

/**
 * Cut every tile the sales floor uses out of the atlas, flipped as needed, as its own
 * texture. Skips silently if the art pack isn't present on this PC.
 * @param {Phaser.Textures.TextureManager} textures
 * @returns {boolean} true if the atlas was available
 */
export function registerShopTiles(textures) {
  if (!textures.exists(SHOP_ATLAS.key)) return false;
  const atlas = textures.get(SHOP_ATLAS.key).getSourceImage();
  for (const code of ALL_CODES) {
    const key = shopTileKey(code);
    if (textures.exists(key)) continue;
    const tile = parseTileCode(code);
    const { x, y, size } = atlasSourceRect(tile.tileId);
    const canvas = textures.createCanvas(key, size, size);
    const context = canvas.context;
    context.imageSmoothingEnabled = false;
    context.drawImage(atlas, x, y, size, size, 0, 0, size, size);
    const source = context.getImageData(0, 0, size, size);
    const output = context.createImageData(size, size);
    for (let oy = 0; oy < size; oy += 1) {
      for (let ox = 0; ox < size; ox += 1) {
        const [sx, sy] = sourcePixel(ox, oy, tile, size);
        const from = (sy * size + sx) * 4;
        const to = (oy * size + ox) * 4;
        for (let channel = 0; channel < 4; channel += 1) output.data[to + channel] = source.data[from + channel];
      }
    }
    context.putImageData(output, 0, 0);
    canvas.refresh();
    canvas.setFilter(1); // Phaser.Textures.FilterMode.NEAREST: keep pixel art crisp at 64px
  }
  return true;
}
