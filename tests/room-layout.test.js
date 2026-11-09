import assert from "node:assert/strict";
import test from "node:test";
import { BACKROOM_UPGRADE_ORDER, EXPANSION_ORDER, getAuthoredGridSize, getBackroomLink, getTotalGridSize, getZone, isBackroomRow } from "../js/logic/RoomLayout.js";

test("the full shop viewport is reserved at 39 by 21 tiles", () => {
  assert.deepEqual(getTotalGridSize(), { gridW: 39, gridH: 21 });
});

test("physical room bounds cover the authored shop and the backroom below it", () => {
  assert.deepEqual(getAuthoredGridSize(), { gridW: 34, gridH: 112 });
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
