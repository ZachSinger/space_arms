import assert from "node:assert/strict";
import test from "node:test";
import { BACKROOM_UPGRADE_ORDER, EXPANSION_ORDER, ZONES, getAuthoredGridSize, getBackroomBounds, getBackroomInteriorBounds, getBackroomLink, getLoadingPadBounds, getTotalGridSize, getZone, isBackroomRow } from "../js/logic/RoomLayout.js";

test("the full shop viewport is reserved at 39 by 21 tiles", () => {
  assert.deepEqual(getTotalGridSize(), { gridW: 39, gridH: 21 });
});

test("physical room bounds cover the authored shop and the backroom below it", () => {
  assert.deepEqual(getAuthoredGridSize(), { gridW: 34, gridH: 106 });
});

test("the compact backroom is half as tall and its bottom floor is exactly the loading pad", () => {
  const room = getBackroomBounds();
  const floor = getBackroomInteriorBounds();
  const pad = getLoadingPadBounds();
  assert.equal(room.height, 768 / 2);
  assert.equal(floor.right - floor.left, 128);
  assert.equal(pad.left, floor.left);
  assert.equal(pad.right, floor.right);
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
  assert.deepEqual(EXPANSION_ORDER.map((id) => getZone(id).requiredShopLevel), [5, 9, 17, 24, 30]);
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
  assert.deepEqual(BACKROOM_UPGRADE_ORDER.map((id) => getZone(id).requiredShopLevel), [13, 20, 27]);
  assert.deepEqual(BACKROOM_UPGRADE_ORDER.map((id) => getZone(id).cost), [4000, 6000, 9000]);
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
