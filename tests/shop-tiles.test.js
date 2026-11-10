import assert from "node:assert/strict";
import test from "node:test";
import { atlasSourceRect, parseTileCode, shopTileKey, shopWallStack, sourcePixel } from "../js/logic/ShopTiles.js";

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
  const top = (stack) => stack.at(-1);
  assert.equal(top(shopWallStack(12, 4, isOpen)), shopTileKey("86HV"));
  assert.equal(shopWallStack(12, 0, isOpen)[1], shopTileKey("3HVD"), "corners use the left wall");
  assert.equal(shopWallStack(22, 4, isOpen)[1], shopTileKey("3D"));
  assert.equal(top(shopWallStack(14, 0, isOpen)), shopTileKey("21"));
  assert.equal(top(shopWallStack(14, 1, isOpen)), shopTileKey("21V"));
  assert.equal(top(shopWallStack(15, 0, isOpen)), shopTileKey("42"), "ShopA's column");
  assert.equal(top(shopWallStack(15, 1, isOpen)), shopTileKey("38"));
  assert.equal(top(shopWallStack(14, 8, isOpen)), shopTileKey("86VD"));
});
