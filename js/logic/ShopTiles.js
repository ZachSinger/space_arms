// ==========================================
// FILE: ShopTiles.js
// ==========================================
// Floor and wall art for the sales floor, copied from the ShopA map painted in Tiled
// (img/Tilesets/TiledProject/Tilesets/ShopA.tmx). Each wall cell is a stack of 32px tiles
// from the Research Station "Base" atlas, some flipped or rotated, drawn at 2x. Walls are
// trimmed to their visible art and evenly stretched so they meet the floor grid (see
// BACK_WALL and EDGE_WALLS).
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
// The back wall's lower tiles end in eight rows of floor, which left a strip of floor
// between the wall's trim and the first row fixtures can be placed on. The back wall's two
// tiles of art are joined without that floor (56 rows) and split evenly across its two
// cells, so the trim meets the floor grid with no uneven stretching.
const BACK_WALL_LOWER_ROWS = 24;
const BACK_WALL_CELL_ROWS = (SOURCE_TILE + BACK_WALL_LOWER_ROWS) / 2;
const BACK_WALL = {
  upper: { half: 0, upper: STACKS.topUpper, lower: STACKS.topLower },
  lower: { half: 1, upper: STACKS.topUpper, lower: STACKS.topLower },
  columnUpper: { half: 0, upper: [...STACKS.topUpper, COLUMN_UPPER], lower: [...STACKS.topLower, COLUMN_LOWER] },
  columnLower: { half: 1, upper: [...STACKS.topUpper, COLUMN_UPPER], lower: [...STACKS.topLower, COLUMN_LOWER] },
};
export const shopBackWallKey = (name) => `shop_back_wall_${name}`;

// The side and front walls are 26px thick, centered in their 32px tiles with a 3px strip of
// floor or shadow on each side, which left a gap between the wall and anything placed
// against it. They're cut down to the wall itself and evenly stretched to fill the cell.
const EDGE_WALL_INSET = 3;
const EDGE_WALL_THICKNESS = SOURCE_TILE - EDGE_WALL_INSET * 2;
const EDGE_WALLS = {
  west: { codes: STACKS.west, horizontal: true },
  east: { codes: STACKS.east, horizontal: true },
  bottom: { codes: STACKS.bottom, horizontal: false },
};
export const shopEdgeWallKey = (name) => `shop_edge_wall_${name}`;

// The back wall's visible face, in tiles measured down from the top of its upper half:
// below a dark band (the atlas's first three rows) down to the floor.
export const SHOP_BACK_WALL_FACE = { top: 3 / BACK_WALL_CELL_ROWS, bottom: 2 };

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
  if (!isOpen(gx - 1, gy)) return [shopEdgeWallKey("west")];
  if (!isOpen(gx + 1, gy)) return [shopEdgeWallKey("east")];
  if (!isOpen(gx, gy - 1)) return [shopBackWallKey(column ? "columnUpper" : "upper")];
  if (!isOpen(gx, gy - 2)) return [shopBackWallKey(column ? "columnLower" : "lower")];
  return [shopEdgeWallKey("bottom")];
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
  for (const [name, wall] of Object.entries(BACK_WALL)) registerBackWallCell(textures, name, wall);
  for (const [name, wall] of Object.entries(EDGE_WALLS)) registerEdgeWallCell(textures, name, wall);
  return true;
}

/**
 * One side or front wall cell: its tiles' wall pixels only, without the 3px strips on each
 * side. Copies are 1:1; the cell is stretched to the 64px grid when drawn.
 */
function registerEdgeWallCell(textures, name, { codes, horizontal }) {
  const key = shopEdgeWallKey(name);
  if (textures.exists(key)) return;
  const width = horizontal ? EDGE_WALL_THICKNESS : SOURCE_TILE;
  const height = horizontal ? SOURCE_TILE : EDGE_WALL_THICKNESS;
  const canvas = textures.createCanvas(key, width, height);
  const context = canvas.context;
  context.imageSmoothingEnabled = false;
  const sx = horizontal ? EDGE_WALL_INSET : 0;
  const sy = horizontal ? 0 : EDGE_WALL_INSET;
  for (const code of codes) {
    const tile = textures.get(shopTileKey(code)).getSourceImage();
    context.drawImage(tile, sx, sy, width, height, 0, 0, width, height);
  }
  canvas.refresh();
  canvas.setFilter(1); // Phaser.Textures.FilterMode.NEAREST
}

/**
 * One back wall cell: its half of the upper tiles stacked above the lower tiles' wall rows.
 * Copies are 1:1; the cell is stretched to the 64px grid when drawn.
 */
function registerBackWallCell(textures, name, { half, upper, lower }) {
  const key = shopBackWallKey(name);
  if (textures.exists(key)) return;
  const canvas = textures.createCanvas(key, SOURCE_TILE, BACK_WALL_CELL_ROWS);
  const context = canvas.context;
  context.imageSmoothingEnabled = false;
  const cellTop = half * BACK_WALL_CELL_ROWS;
  const layers = [
    ...upper.map((code) => ({ code, top: 0, rows: SOURCE_TILE })),
    ...lower.map((code) => ({ code, top: SOURCE_TILE, rows: BACK_WALL_LOWER_ROWS })),
  ];
  for (const { code, top, rows } of layers) {
    const from = Math.max(cellTop, top);
    const to = Math.min(cellTop + BACK_WALL_CELL_ROWS, top + rows);
    if (to <= from) continue;
    const tile = textures.get(shopTileKey(code)).getSourceImage();
    context.drawImage(tile, 0, from - top, SOURCE_TILE, to - from, 0, from - cellTop, SOURCE_TILE, to - from);
  }
  canvas.refresh();
  canvas.setFilter(1); // Phaser.Textures.FilterMode.NEAREST
}
