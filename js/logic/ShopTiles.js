// ==========================================
// FILE: ShopTiles.js
// ==========================================
// Cuts plain, seamless floor and wall tiles out of the licensed sci-fi tileset, which uses
// RPG Maker MZ's standard autotile layout. Only each autotile's interior fill is used, so
// every cell looks the same and needs no edge or corner matching.
// The source sheets are licensed for local game use only and are never committed (see .gitignore).
// See also: RoomLayout.js (which tiles each zone uses), TileRoom.js (drawing them).

export const SOURCE_TILE = 48; // px, RPG Maker MZ tile size

export const SCIFI_SHEETS = [
  { key: "scifi_a2", path: "img/Tilesets/scifi/scifi-A2.png" },
  { key: "scifi_a4", path: "img/Tilesets/scifi/scifi-A4.png" },
];

// A2 (ground): 8 x 4 autotiles, each 2 tiles wide and 3 tall. The interior fill is the
// tile-sized square centered in the bottom 2x2 block.
export const FLOOR_COUNT = 32;
// A4 (walls): 8 columns, three bands of [ceiling autotile 2x3, wall-face autotile 2x2].
// The interior fill of a wall face is the tile-sized square centered in its 2x2 block.
export const WALL_COUNT = 24;

export const floorTileKey = (index) => `scifi_floor_${index}`;
export const wallTileKey = (index) => `scifi_wall_${index}`;

/**
 * Source rectangle of a ground autotile's interior fill on the A2 sheet.
 * @param {number} index - 0..31, left-to-right then top-to-bottom
 */
export function floorSourceRect(index) {
  const col = index % 8;
  const row = Math.floor(index / 8);
  return { x: col * 96 + 24, y: row * 144 + 72, size: SOURCE_TILE };
}

/**
 * Source rectangle of a wall-face autotile's interior fill on the A4 sheet.
 * @param {number} index - 0..23, left-to-right then top-to-bottom
 */
export function wallSourceRect(index) {
  const col = index % 8;
  const band = Math.floor(index / 8);
  return { x: col * 96 + 24, y: band * 240 + 144 + 24, size: SOURCE_TILE };
}

/**
 * Turn each cut-out square into its own texture so zones can name tiles by key, like the
 * older single-image tiles. Skips silently if a sheet isn't present on this PC.
 * @param {Phaser.Textures.TextureManager} textures
 * @returns {boolean} true if both sheets were available
 */
export function registerShopTiles(textures) {
  if (!SCIFI_SHEETS.every(({ key }) => textures.exists(key))) return false;
  const cut = (sheetKey, key, { x, y, size }) => {
    if (textures.exists(key)) return;
    const canvas = textures.createCanvas(key, size, size);
    canvas.context.imageSmoothingEnabled = false;
    canvas.context.drawImage(textures.get(sheetKey).getSourceImage(), x, y, size, size, 0, 0, size, size);
    canvas.refresh();
    canvas.setFilter(1); // Phaser.Textures.FilterMode.NEAREST: keep pixel art crisp at 64px
  };
  for (let i = 0; i < FLOOR_COUNT; i += 1) cut("scifi_a2", floorTileKey(i), floorSourceRect(i));
  for (let i = 0; i < WALL_COUNT; i += 1) cut("scifi_a4", wallTileKey(i), wallSourceRect(i));
  return true;
}
