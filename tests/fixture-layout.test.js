import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_SPECS, fixtureCells, cellKey, validateFixtureLayout } from "../js/logic/FixtureLayout.js";
import { TileRoom } from "../js/logic/TileRoom.js";
import { getZone } from "../js/logic/RoomLayout.js";

function createRoom() {
  const scene = {
    add: { image: () => ({
      setDisplaySize() { return this; },
      setDepth() { return this; },
    }) },
    physics: { add: { staticGroup: () => ({ add() {}, remove() {} }) } },
  };
  const room = new TileRoom(scene);
  const sales = getZone("sales_floor");
  const storage = getZone("storeroom");
  const entrance = { gx: sales.gridX + 2, gy: sales.gridY + sales.gridH - 1 };
  room.openDoorway(entrance.gx, entrance.gy, "door");
  const door = { gx: storage.gridX + storage.gridW - 1, gy: storage.gridY + 3 };
  for (let gy = storage.gridY; gy < storage.gridY + storage.gridH; gy += 1) {
    room.addWall(door.gx, gy, "wall", true);
  }
  room.openDoorway(door.gx, door.gy, "door");
  const reservedCells = new Set([cellKey(entrance), `${entrance.gx},${entrance.gy - 1}`, cellKey(door)]);
  const pad = getZone("loading_pad");
  for (let gy = pad.gridY + 1; gy < pad.gridY + pad.gridH - 1; gy += 1) {
    for (let gx = pad.gridX + 1; gx < pad.gridX + pad.gridW - 1; gx += 1) {
      reservedCells.add(`${gx},${gy}`);
    }
  }
  return { room, entrance, reservedCells, isWalkable: (gx, gy) => room.isWalkable(gx, gy) };
}

const initialLayout = () => FIXTURE_SPECS.map(({ id, gx, gy }) => ({ id, gx, gy }));

const moved = (id, gx, gy) => initialLayout().map((entry) => entry.id === id ? { id, gx, gy } : entry);

test("the starting layout has accessible fronts, a register back, and six queue positions", () => {
  const options = createRoom();
  const result = validateFixtureLayout(initialLayout(), options);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.access.size, 5);
  assert.equal(result.queueCells.length, 6);
  assert.equal(new Set(result.queueCells.map(cellKey)).size, 6);
  for (const cell of result.queueCells) {
    assert.equal(result.blockedCells.has(cellKey(cell)), false);
    assert.equal(options.reservedCells.has(cellKey(cell)), false);
  }
  assert.equal(result.blockedCells.has("12,2"), true);
});

test("fixtures can move without mutating the old layout", () => {
  const original = initialLayout();
  const result = validateFixtureLayout(moved("fixture_demo_01", 8, 1), createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.deepEqual(original[0], { id: "fixture_demo_01", gx: 7, gy: 2 });
  assert.equal(validateFixtureLayout(moved("register", 12, 3), createRoom()).valid, true);
  assert.equal(validateFixtureLayout(moved("storage_demo_01", 6, 4), createRoom()).valid, true);
});

test("placement rejects walls, locked rooms, overlaps, blocked fronts, and obstructed register backs", () => {
  for (const [id, gx, gy] of [
    ["fixture_demo_01", 0, 0],
    ["fixture_demo_01", 16, 2],
    ["fixture_demo_01", 1, 1],
    ["storage_demo_03", 1, 3],
    ["register", 12, 1],
    ["fixture_demo_01", 7, 5],
  ]) {
    assert.equal(validateFixtureLayout(moved(id, gx, gy), createRoom()).valid, false, `${id} at ${gx},${gy}`);
  }
});

test("placement preserves doors, the loading pad, and player or crate space", () => {
  const options = createRoom();
  assert.equal(validateFixtureLayout(moved("storage_demo_01", 2, 9), options).valid, false);
  assert.equal(validateFixtureLayout(moved("storage_demo_01", 8, 6), options).valid, false);
  options.occupiedRectangles = [{ left: 580, right: 620, top: 80, bottom: 120 }];
  const result = validateFixtureLayout(moved("fixture_demo_01", 8, 1), options);
  assert.equal(result.valid, false);
  assert.match(result.reason, /player or crate/);
});

test("otherwise valid layouts cannot leave an isolated floor pocket", () => {
  const options = createRoom();
  for (const [gx, gy] of [[2, 6], [1, 5], [1, 7]]) options.room.addWall(gx, gy, "wall", true);
  const result = validateFixtureLayout(initialLayout(), options);
  assert.equal(result.valid, false);
  assert.match(result.reason, /cuts off/);
});

test("expansion unlock preserves authored walls and does not unlock a new game's rooms", () => {
  const { room } = createRoom();
  room.unlockZone("expansion_a");
  assert.equal(room.isWalkable(5, 2), false);
  assert.equal(room.isWalkable(5, 3), true);
  assert.equal(room.isWalkable(17, 2), true);
  assert.equal(new TileRoom(room.scene).isWalkable(17, 2), false);
  assert.equal(getZone("expansion_a").locked, true);
});

test("malformed layouts cannot bypass placement validation", () => {
  assert.equal(validateFixtureLayout([], createRoom()).valid, false);
  assert.equal(validateFixtureLayout(moved("fixture_demo_01", 7.5, 2), createRoom()).valid, false);
  const duplicate = initialLayout();
  duplicate[1] = { ...duplicate[0] };
  assert.equal(validateFixtureLayout(duplicate, createRoom()).valid, false);
  assert.equal(fixtureCells(initialLayout()[0]).length, 6);
});
