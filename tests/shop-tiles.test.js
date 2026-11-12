import assert from "node:assert/strict";
import test from "node:test";
import { SHOP_TILES, SHOP_TILE_ASSETS, shopWallStack } from "../js/logic/ShopTiles.js";
import { BACKROOM_TILES, backroomFloorArt, backroomWallStack } from "../js/logic/BackroomTiles.js";

// Open area: columns 12-22, rows 0-8 (the starting Sales Floor).
const isOpen = (gx, gy) => gx >= 12 && gx <= 22 && gy >= 0 && gy <= 8;

test("every outside wall is the riveted border", () => {
  assert.deepEqual(shopWallStack(12, 4, isOpen), [SHOP_TILES.border], "left side");
  assert.deepEqual(shopWallStack(22, 4, isOpen), [SHOP_TILES.border], "right side");
  assert.deepEqual(shopWallStack(14, 0, isOpen), [SHOP_TILES.border], "top");
  assert.deepEqual(shopWallStack(14, 8, isOpen), [SHOP_TILES.border], "bottom");
  assert.deepEqual(shopWallStack(12, 1, isOpen), [SHOP_TILES.border], "corners stay border");
});

test("the back wall's lower row shows the wall's face, with lights either side of the front door", () => {
  assert.deepEqual(shopWallStack(14, 1, isOpen), [SHOP_TILES.backWall]);
  assert.deepEqual(shopWallStack(15, 1, isOpen, 16), [SHOP_TILES.lightsLeftOfDoor]);
  assert.deepEqual(shopWallStack(17, 1, isOpen, 16), [SHOP_TILES.lightsRightOfDoor]);
  assert.deepEqual(shopWallStack(18, 1, isOpen, 16), [SHOP_TILES.backWall]);
});

test("unlocking a side zone turns the old side wall's face cell into back wall", () => {
  const withWest = (gx, gy) => isOpen(gx, gy) || (gx >= 6 && gx <= 11 && gy >= 0 && gy <= 8);
  assert.deepEqual(shopWallStack(12, 1, withWest), [SHOP_TILES.backWall]);
  assert.deepEqual(shopWallStack(6, 1, withWest), [SHOP_TILES.border]);
});

test("each shop tile loads from the extracted art folder", () => {
  assert.deepEqual(SHOP_TILE_ASSETS.find((asset) => asset.key === SHOP_TILES.border),
    { key: "shop_border", path: "img/Icons_Extracted/Tileset/Shop/shop_border.png" });
  assert.equal(SHOP_TILE_ASSETS.length, Object.keys(SHOP_TILES).length);
});

// Backroom at its starting size: columns 0-5, rows 100-111; walls ring the outside.
const backroomOpen = (gx, gy) => gx >= 0 && gx <= 5 && gy >= 100 && gy <= 111;
const backroomFloor = (gx, gy) => gx >= 1 && gx <= 4 && gy >= 101 && gy <= 110;

test("the backroom's top wall shows its face; every other wall is the black border", () => {
  assert.deepEqual(backroomWallStack(2, 100, backroomOpen), [BACKROOM_TILES.wall]);
  assert.deepEqual(backroomWallStack(0, 100, backroomOpen), [BACKROOM_TILES.border], "corner");
  assert.deepEqual(backroomWallStack(5, 104, backroomOpen), [BACKROOM_TILES.border], "side");
  assert.deepEqual(backroomWallStack(2, 111, backroomOpen), [BACKROOM_TILES.border], "bottom");
});

test("backroom floor is edged where it meets a side or bottom wall", () => {
  assert.equal(backroomFloorArt(2, 104, backroomFloor), BACKROOM_TILES.floor);
  assert.equal(backroomFloorArt(1, 104, backroomFloor), BACKROOM_TILES.floorLeft);
  assert.equal(backroomFloorArt(4, 104, backroomFloor), BACKROOM_TILES.floorRight);
  assert.equal(backroomFloorArt(2, 110, backroomFloor), BACKROOM_TILES.floorBottom);
  assert.equal(backroomFloorArt(1, 110, backroomFloor), BACKROOM_TILES.floorBottomLeft);
  assert.equal(backroomFloorArt(4, 110, backroomFloor), BACKROOM_TILES.floorBottomRight);
  assert.equal(backroomFloorArt(2, 101, backroomFloor), BACKROOM_TILES.floor, "no edge under the top wall");
});
