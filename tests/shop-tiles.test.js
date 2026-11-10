import assert from "node:assert/strict";
import test from "node:test";
import {
  SHOP_ATLAS, SHOP_BACK_WALL_FACE, atlasSourceRect, parseTileCode, registerShopTiles,
  shopBackWallKey, shopEdgeWallKey, shopTileKey, shopWallStack, sourcePixel,
} from "../js/logic/ShopTiles.js";
import { SHOP_BACK_WALL_HEIGHT } from "../js/logic/RoomLayout.js";

test("tiles are cut from the 32px atlas with its 4px margin and 8px spacing", () => {
  assert.deepEqual(atlasSourceRect(1), { x: 4, y: 4, size: 32 });
  assert.deepEqual(atlasSourceRect(21), { x: 4, y: 84, size: 32 });
  assert.deepEqual(atlasSourceRect(86), { x: 204, y: 324, size: 32 });
});

test("tile codes read Tiled's flips, and flipped pixels come from the right source pixel", () => {
  assert.deepEqual(parseTileCode("86HVD"), { tileId: 86, flipH: true, flipV: true, diagonal: true });
  assert.deepEqual(parseTileCode("3"), { tileId: 3, flipH: false, flipV: false, diagonal: false });
  assert.throws(() => parseTileCode("x"));
  const none = { flipH: false, flipV: false, diagonal: false };
  assert.deepEqual(sourcePixel(1, 2, none), [1, 2]);
  assert.deepEqual(sourcePixel(0, 0, { ...none, flipH: true }), [31, 0]);
  assert.deepEqual(sourcePixel(0, 0, { ...none, flipV: true }), [0, 31]);
  // Diagonal plus left-right is a quarter turn clockwise: the top-left corner moves to the top right.
  assert.deepEqual(sourcePixel(31, 0, { flipH: true, flipV: false, diagonal: true }), [0, 0]);
});

test("wall art hugs the open area: sides, a two-tile back wall with columns, and a front wall", () => {
  // Open area: columns 12-22, rows 0-8 (the starting Sales Floor).
  const isOpen = (gx, gy) => gx >= 12 && gx <= 22 && gy >= 0 && gy <= 8;
  assert.deepEqual(shopWallStack(12, 4, isOpen), [shopEdgeWallKey("west")]);
  assert.deepEqual(shopWallStack(12, 0, isOpen), [shopEdgeWallKey("west")], "corners use the left wall");
  assert.deepEqual(shopWallStack(22, 4, isOpen), [shopEdgeWallKey("east")]);
  assert.deepEqual(shopWallStack(14, 0, isOpen), [shopBackWallKey("upper")]);
  assert.deepEqual(shopWallStack(14, 1, isOpen), [shopBackWallKey("lower")]);
  assert.deepEqual(shopWallStack(15, 0, isOpen), [shopBackWallKey("columnUpper")], "ShopA's column");
  assert.deepEqual(shopWallStack(15, 1, isOpen), [shopBackWallKey("columnLower")]);
  assert.deepEqual(shopWallStack(14, 8, isOpen), [shopEdgeWallKey("bottom")]);
});

function registerWithFakeTextures() {
  const canvases = new Map();
  const textures = {
    exists: (key) => key === SHOP_ATLAS.key || canvases.has(key),
    get: (key) => ({ getSourceImage: () => (key === SHOP_ATLAS.key ? {} : { key }) }),
    createCanvas(key, width, height) {
      const canvas = {
        width,
        height,
        draws: [],
        context: {
          drawImage(image, ...rect) { canvas.draws.push({ key: image.key, rect }); },
          getImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }),
          createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          putImageData() {},
        },
        refresh() {},
        setFilter() {},
      };
      canvases.set(key, canvas);
      return canvas;
    },
  };

  assert.equal(registerShopTiles(textures), true);
  return canvases;
}

// drawImage(source x, y, w, h, dest x, y, w, h): rows are copied 1:1, never resized.
const draw = (canvas, code) => canvas.draws.find((entry) => entry.key === shopTileKey(code))?.rect;

test("the back wall's two cells split its wall art evenly, leaving out the tiles' floor rows", () => {
  const canvases = registerWithFakeTextures();
  const upper = canvases.get(shopBackWallKey("upper"));
  const lower = canvases.get(shopBackWallKey("lower"));
  assert.deepEqual([upper.width, upper.height, lower.width, lower.height], [32, 28, 32, 28]);  assert.deepEqual(draw(upper, "21"), [0, 0, 32, 28, 0, 0, 32, 28]);
  assert.equal(draw(upper, "21V"), undefined);
  assert.deepEqual(draw(lower, "21"), [0, 28, 32, 4, 0, 0, 32, 4]);
  assert.deepEqual(draw(lower, "21V"), [0, 0, 32, 24, 0, 4, 32, 24], "the lower tile's floor rows are left out");
  assert.deepEqual(draw(canvases.get(shopBackWallKey("columnLower")), "38"), [0, 0, 32, 24, 0, 4, 32, 24]);
  assert.equal(draw(lower, "38"), undefined);
  assert.equal(SHOP_BACK_WALL_FACE.bottom, SHOP_BACK_WALL_HEIGHT,
    "the wall and door reach the first row fixtures can be placed on");
});

test("side and front walls leave out the 3px strips beside the wall, so fixtures sit flush", () => {
  const canvases = registerWithFakeTextures();
  const west = canvases.get(shopEdgeWallKey("west"));
  const east = canvases.get(shopEdgeWallKey("east"));
  const bottom = canvases.get(shopEdgeWallKey("bottom"));
  assert.deepEqual([west.width, west.height, east.width, east.height], [26, 32, 26, 32]);
  assert.deepEqual([bottom.width, bottom.height], [32, 26]);
  assert.deepEqual(draw(west, "86HV"), [3, 0, 26, 32, 0, 0, 26, 32]);
  assert.deepEqual(draw(east, "3D"), [3, 0, 26, 32, 0, 0, 26, 32]);
  assert.deepEqual(draw(bottom, "86VD"), [0, 3, 32, 26, 0, 0, 32, 26]);
});
