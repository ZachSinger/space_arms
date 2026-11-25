import { BACKROOM_TILES } from "../logic/BackroomTiles.js";
import { SHOP_TILES } from "../logic/ShopTiles.js";

const TILE_PIXELS = 96;
const ROOM_TILES = new Set([...Object.values(SHOP_TILES), ...Object.values(BACKROOM_TILES)]);

export function roomArtTexture(key) {
  return ROOM_TILES.has(key) ? `room-art-${key}` : key;
}

function rect(ctx, color, x, y, width, height) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

function floor(ctx, backroom) {
  const c = backroom
    ? { base: "#394664", face: "#414e6c", highlight: "#52627e", shadow: "#303b56", bolt: "#7b899e" }
    : { base: "#40497a", face: "#454f80", highlight: "#526194", shadow: "#36416d", bolt: "#7989b4" };
  rect(ctx, c.base, 0, 0, 32, 32);
  rect(ctx, c.shadow, 0, 0, 32, 1);
  rect(ctx, c.shadow, 0, 0, 1, 32);
  rect(ctx, c.highlight, 1, 1, 30, 1);
  rect(ctx, c.highlight, 1, 2, 1, 28);
  rect(ctx, c.shadow, 1, 30, 30, 1);
  rect(ctx, c.shadow, 30, 2, 1, 28);
  rect(ctx, c.face, 3, 3, 26, 26);
  rect(ctx, c.highlight, 3, 3, 26, 1);
  rect(ctx, c.highlight, 3, 4, 1, 24);
  rect(ctx, c.shadow, 4, 28, 25, 1);
  rect(ctx, c.shadow, 28, 4, 1, 24);
  for (const x of [5, 26]) {
    for (const y of [5, 26]) {
      rect(ctx, c.shadow, x, y, 2, 2);
      rect(ctx, c.bolt, x, y, 1, 1);
    }
  }
  if (backroom) {
    rect(ctx, c.shadow, 15, 5, 1, 22);
    rect(ctx, c.highlight, 16, 5, 1, 22);
    for (const y of [9, 15, 21]) {
      rect(ctx, c.highlight, 7, y, 3, 1);
      rect(ctx, c.highlight, 22, y, 3, 1);
    }
  } else {
    rect(ctx, c.highlight, 8, 8, 6, 1);
    rect(ctx, c.highlight, 18, 23, 5, 1);
  }
}

function wall(ctx, backroom) {
  const c = backroom
    ? { base: "#798cab", face: "#8498b7", light: "#abbad2", edge: "#526681", dark: "#293b55" }
    : { base: "#899bd0", face: "#96a9dc", light: "#bdcaf0", edge: "#6378ac", dark: "#394c78" };
  rect(ctx, c.base, 0, 0, 32, 32);
  rect(ctx, c.dark, 0, 0, 32, 2);
  rect(ctx, c.light, 0, 2, 32, 1);
  rect(ctx, c.dark, 0, 29, 32, 3);
  rect(ctx, c.edge, 0, 27, 32, 2);
  rect(ctx, c.edge, 0, 3, 2, 24);
  rect(ctx, c.dark, 31, 3, 1, 24);
  rect(ctx, c.edge, 4, 5, 24, 19);
  rect(ctx, c.light, 5, 6, 22, 1);
  rect(ctx, c.face, 5, 7, 22, 15);
  rect(ctx, c.dark, 5, 22, 22, 1);
  rect(ctx, c.edge, 7, 18, 18, 1);
  rect(ctx, c.light, 7, 17, 18, 1);
  rect(ctx, c.edge, 21, 10, 4, 1);
  rect(ctx, c.edge, 21, 12, 4, 1);
  for (const x of [2, 29]) {
    for (const y of [5, 24]) {
      rect(ctx, c.dark, x, y, 1, 1);
      rect(ctx, c.light, x, y - 1, 1, 1);
    }
  }
}

function border(ctx, backroom) {
  const c = backroom
    ? { base: "#0d1327", panel: "#172139", edge: "#2b3a58", light: "#435470" }
    : { base: "#101735", panel: "#182348", edge: "#2d3d6c", light: "#4b5c8c" };
  rect(ctx, c.base, 0, 0, 32, 32);
  for (const x of [0, 16]) {
    for (const y of [0, 16]) {
      rect(ctx, c.edge, x, y, 16, 1);
      rect(ctx, c.edge, x, y, 1, 16);
      rect(ctx, c.panel, x + 2, y + 2, 12, 12);
      rect(ctx, c.light, x + 3, y + 3, 1, 1);
      rect(ctx, c.edge, x + 3, y + 12, 1, 1);
      rect(ctx, c.edge, x + 12, y + 3, 1, 1);
      rect(ctx, c.edge, x + 12, y + 12, 1, 1);
      rect(ctx, c.edge, x + 5, y + 6, 6, 1);
      rect(ctx, c.edge, x + 5, y + 8, 6, 1);
    }
  }
}

// The Room Painter tool (scripts/room-painter) draws these to show the game's current look.
export { floor as drawRoomFloor, wall as drawRoomWall, border as drawRoomBorder };

function sourcePixels(scene, key, cache) {
  if (cache.has(key)) return cache.get(key);
  if (!scene.textures.exists(key)) throw new Error(`Missing room artwork: ${key}`);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TILE_PIXELS;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error(`Could not read room artwork: ${key}`);
  ctx.drawImage(scene.textures.get(key).getSourceImage(), 0, 0);
  const pixels = ctx.getImageData(0, 0, TILE_PIXELS, TILE_PIXELS).data;
  cache.set(key, pixels);
  return pixels;
}

// Keep the authored doorway lights, mat and backroom edge stripes over the new surfaces.
function copyDetails(scene, ctx, baseKey, variantKey, cache) {
  const base = sourcePixels(scene, baseKey, cache);
  const variant = sourcePixels(scene, variantKey, cache);
  const image = ctx.getImageData(0, 0, TILE_PIXELS, TILE_PIXELS);
  for (let i = 0; i < variant.length; i += 4) {
    if (variant[i] === base[i] && variant[i + 1] === base[i + 1] &&
      variant[i + 2] === base[i + 2] && variant[i + 3] === base[i + 3]) continue;
    image.data.set(variant.subarray(i, i + 4), i);
  }
  ctx.putImageData(image, 0, 0);
}

export function ensureRoomArtTextures(scene) {
  const sources = new Map();
  const entries = [
    { key: SHOP_TILES.floor, draw: (ctx) => floor(ctx, false) },
    { key: SHOP_TILES.doormat, draw: (ctx) => floor(ctx, false), base: SHOP_TILES.floor },
    { key: SHOP_TILES.border, draw: (ctx) => border(ctx, false) },
    { key: SHOP_TILES.backWall, draw: (ctx) => wall(ctx, false) },
    { key: SHOP_TILES.lightsLeftOfDoor, draw: (ctx) => wall(ctx, false), base: SHOP_TILES.backWall },
    { key: SHOP_TILES.lightsRightOfDoor, draw: (ctx) => wall(ctx, false), base: SHOP_TILES.backWall },
    { key: BACKROOM_TILES.floor, draw: (ctx) => floor(ctx, true) },
    ...[
      BACKROOM_TILES.floorLeft, BACKROOM_TILES.floorRight, BACKROOM_TILES.floorBottom,
      BACKROOM_TILES.floorBottomLeft, BACKROOM_TILES.floorBottomRight,
    ].map((key) => ({ key, draw: (ctx) => floor(ctx, true), base: BACKROOM_TILES.floor })),
    { key: BACKROOM_TILES.wall, draw: (ctx) => wall(ctx, true) },
    { key: BACKROOM_TILES.border, draw: (ctx) => border(ctx, true) },
  ];
  for (const { key, draw, base } of entries) {
    const textureKey = roomArtTexture(key);
    if (scene.textures.exists(textureKey)) continue;
    const texture = scene.textures.createCanvas(textureKey, TILE_PIXELS, TILE_PIXELS);
    const ctx = texture.context;
    ctx.save();
    ctx.scale(3, 3);
    draw(ctx);
    ctx.restore();
    if (base) copyDetails(scene, ctx, base, key, sources);
    texture.refresh().setFilter(1);
  }
}
