import assert from "node:assert/strict";
import test from "node:test";
import { BACKROOM_UPGRADE_ORDER, EXPANSION_ORDER, SHOP_BACK_WALL_HEIGHT, ZONES, getAuthoredGridSize, getBackroomBounds, getBackroomDoorCell, getBackroomInteriorBounds, getBackroomLink, getLoadingPadBounds, getStoreDoorCell, getTotalGridSize, getZone, isBackroomRow } from "../js/logic/RoomLayout.js";
import { TileRoom } from "../js/logic/TileRoom.js";

test("the navigation key changes when room walkability changes", () => {
  const room = Object.create(TileRoom.prototype);
  const zone = { gridX: 0, gridY: 0, gridW: 4, gridH: 4, locked: false };
  room.zones = [zone];
  room.wallCells = new Map();
  const initial = room.navigationWalkabilityKey();
  assert.equal(room.isWalkable(2, 1), true);
  room.wallCells.set("2,1", {});
  assert.notEqual(room.navigationWalkabilityKey(), initial);
  assert.equal(room.isWalkable(2, 1), false);
  room.wallCells.clear();
  zone.gridW = 2;
  assert.notEqual(room.navigationWalkabilityKey(), initial);
  assert.equal(room.isWalkable(2, 1), false);
  zone.gridW = 4;
  zone.locked = true;
  assert.notEqual(room.navigationWalkabilityKey(), initial);
  assert.equal(room.isWalkable(2, 1), false);
});

test("the full shop viewport is reserved at 39 by 21 tiles", () => {
  assert.deepEqual(getTotalGridSize(), { gridW: 39, gridH: 21 });
});

test("physical room bounds cover the authored shop and the backroom below it", () => {
  assert.deepEqual(getAuthoredGridSize(), { gridW: 34, gridH: 107 });
});

test("the starting sales floor has seven by three usable squares and both doors fit its top wall", () => {
  const floor = getZone("sales_floor");
  assert.equal(floor.gridW - 2, 7);
  assert.equal(floor.gridH - SHOP_BACK_WALL_HEIGHT - 1, 3);
  assert.deepEqual(getStoreDoorCell(), { gx: floor.gridX + 4, gy: floor.gridY + 1 });
  assert.deepEqual(getBackroomDoorCell(), { gx: floor.gridX + 7, gy: floor.gridY + 1 });
});

test("the wider starting backroom leaves an aisle beside the unchanged loading pad", () => {
  const room = getBackroomBounds();
  const floor = getBackroomInteriorBounds();
  const pad = getLoadingPadBounds();
  assert.equal(room.width, 384);
  assert.equal(room.height, 448);
  assert.equal(floor.right - floor.left, 256);
  assert.equal(floor.bottom - floor.top, 320);
  assert.equal(pad.left, floor.left);
  assert.equal(floor.right - pad.right, 128);
  assert.equal(pad.top - floor.top, 192);
  assert.equal(pad.bottom, floor.bottom);
  const zones = ZONES.map((zone) => ({ ...zone }));
  for (const [index, id] of BACKROOM_UPGRADE_ORDER.entries()) {
    zones.find((zone) => zone.id === id).locked = false;
    assert.equal(getBackroomBounds(zones).height, room.height);
    assert.equal(getBackroomBounds(zones).width, room.width + (index + 1) * 128);
    assert.deepEqual(getLoadingPadBounds(), pad);
  }
});

test("sales floor expansions are locked, fit the map, and stay out of the backroom", () => {
  assert.equal(EXPANSION_ORDER.length, 5);
  for (const id of EXPANSION_ORDER) {
    const zone = getZone(id);
    assert.ok(zone.locked && zone.salesFloor && !zone.backroom && zone.cost > 0, id);
    assert.ok(zone.gridX + zone.gridW <= 39 && zone.gridY + zone.gridH <= 21, id);
  }
});

test("the backroom sits apart from the shop, and only its upgrades grow it", () => {
  for (const id of ["storeroom", "loading_pad", ...BACKROOM_UPGRADE_ORDER]) {
    const zone = getZone(id);
    assert.ok(zone.backroom && isBackroomRow(zone.gridY), id);
  }
  assert.ok(BACKROOM_UPGRADE_ORDER.every((id) => getZone(id).locked));
  const link = getBackroomLink();
  assert.equal(isBackroomRow(link.shop.gy), false);
  assert.equal(isBackroomRow(link.backroom.gy), true);
});

test("the sales floor fills the 34 by 13 ShopA map and stays a rectangle after every purchase", () => {
  const owned = [getZone("sales_floor")];
  const isRectangle = (zones) => {
    const minX = Math.min(...zones.map((z) => z.gridX));
    const minY = Math.min(...zones.map((z) => z.gridY));
    const maxX = Math.max(...zones.map((z) => z.gridX + z.gridW));
    const maxY = Math.max(...zones.map((z) => z.gridY + z.gridH));
    const area = zones.reduce((sum, z) => sum + z.gridW * z.gridH, 0);
    return { area, box: (maxX - minX) * (maxY - minY), maxX, maxY, minX, minY };
  };
  for (const id of EXPANSION_ORDER) {
    owned.push(getZone(id));
    const { area, box } = isRectangle(owned);
    assert.equal(area, box, `after ${id}`);
  }
  assert.deepEqual(isRectangle(owned), { area: 442, box: 442, minX: 0, minY: 0, maxX: 34, maxY: 13 });
});
