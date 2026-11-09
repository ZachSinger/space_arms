import assert from "node:assert/strict";
import test from "node:test";
import { STARTING_FIXTURES, fixtureAccessCells, fixtureCells, fixtureFacing, fixtureFootprint, cellKey, getFixtureType, migrateFixtureEntry, validateFixtureLayout, fixtureInteractionDistance } from "../js/logic/FixtureLayout.js";
import { FixturePlacement } from "../js/logic/FixturePlacement.js";
import { TileRoom } from "../js/logic/TileRoom.js";
import { findGridPath } from "../js/logic/Pathfinder.js";
import { getZone, getStoreDoorCell, getBackroomLink, TILE_SIZE } from "../js/logic/RoomLayout.js";

test("shelf crates cannot enter placement mode in the backroom", () => {
  const messages = [];
  const crate = { kind: "fixture", typeId: "shelf_starter_2x1" };
  const placement = Object.create(FixturePlacement.prototype);
  placement.scene = {
    canRearrangeFixtures: () => true,
    carriedCrate: crate,
    playerInBackroom: true,
    showShopMessage: (message) => messages.push(message),
  };
  placement.start = () => assert.fail("Shelf placement should not start in the backroom.");

  assert.equal(placement.beginFromCrate(crate), false);
  assert.equal(placement.scene.carriedCrate, crate);
  assert.deepEqual(messages, ["Shelves can only be placed on the sales floor."]);
});

test("storage crates can still enter placement mode in the backroom", () => {
  const crate = { kind: "fixture", typeId: "locker_single" };
  const placement = Object.create(FixturePlacement.prototype);
  placement.scene = {
    canRearrangeFixtures: () => true,
    carriedCrate: crate,
    playerInBackroom: true,
  };
  let started = false;
  placement.start = () => { started = true; return true; };

  assert.equal(placement.beginFromCrate(crate), true);
  assert.equal(started, true);
});

test("shelf crates can enter placement mode from the sales floor", () => {
  const crate = { kind: "fixture", typeId: "shelf_starter_2x1" };
  const placement = Object.create(FixturePlacement.prototype);
  placement.scene = {
    canRearrangeFixtures: () => true,
    carriedCrate: crate,
    playerInBackroom: false,
  };
  let started = false;
  placement.start = () => { started = true; return true; };

  assert.equal(placement.beginFromCrate(crate), true);
  assert.equal(started, true);
});

test("fixture interaction covers its entire front but not its sides or back", () => {
  const shelf = { type: "shelf_universal", gx: 9, gy: 2 };
  const left = 9 * TILE_SIZE;
  const right = 12 * TILE_SIZE;
  const front = 4 * TILE_SIZE;
  for (const x of [left, left + TILE_SIZE, right - 1]) {
    assert.equal(fixtureInteractionDistance(shelf, { x, y: front + 20 }), 20);
  }
  assert.equal(fixtureInteractionDistance(shelf, { x: left - 1, y: front + 20 }), Infinity);
  assert.equal(fixtureInteractionDistance(shelf, { x: right, y: front + 20 }), Infinity);
  assert.equal(fixtureInteractionDistance(shelf, { x: left + 20, y: front - 1 }), Infinity);
});

function createRoom() {
  const scene = {
    add: { image: () => ({
      setDisplaySize() { return this; },
      setDepth() { return this; },
    }) },
    physics: { add: { staticGroup: () => ({ add() {}, remove() {} }) } },
  };
  const room = new TileRoom(scene);
  const entrance = getStoreDoorCell();
  room.openDoorway(entrance.gx, entrance.gy, "door");
  room.addBackroomDoors();
  const link = getBackroomLink();
  const doorwayCells = new Set([
    cellKey(entrance),
    `${entrance.gx},${entrance.gy + 1}`,
    cellKey(link.shop),
    cellKey(link.backroom),
  ]);
  const reservedCells = new Set(doorwayCells);
  const pad = getZone("loading_pad");
  for (let gy = pad.gridY + 1; gy < pad.gridY + pad.gridH - 1; gy += 1) {
    for (let gx = pad.gridX + 1; gx < pad.gridX + pad.gridW - 1; gx += 1) {
      reservedCells.add(`${gx},${gy}`);
    }
  }
  return {
    room, entrance, reservedCells, doorwayCells, links: [[link.shop, link.backroom]],
    isWalkable: (gx, gy) => room.isWalkable(gx, gy),
  };
}

// New games start with no shelves, so most layout tests add one clear of the front door.
const TEST_SHELF = { id: "fixture_demo_01", type: "shelf_starter_2x1", gx: 9, gy: 5 };
const initialLayout = () => [TEST_SHELF, ...STARTING_FIXTURES].map((entry) => ({ ...entry }));

const moved = (id, gx, gy) => initialLayout().map((entry) => entry.id === id ? { ...entry, gx, gy } : entry);

test("a new game starts with lockers and a register but no shelves", () => {
  assert.equal(STARTING_FIXTURES.some((entry) => getFixtureType(entry.type).kind === "shelf"), false);
  assert.equal(STARTING_FIXTURES.filter((entry) => getFixtureType(entry.type).kind === "storage").length, 2);
  assert.equal(STARTING_FIXTURES.filter((entry) => getFixtureType(entry.type).kind === "register").length, 1);
  const result = validateFixtureLayout(STARTING_FIXTURES, createRoom());
  assert.equal(result.valid, true, result.reason);
});

test("the starting layout has accessible fronts, a register back, and six queue positions", () => {
  const options = createRoom();
  const result = validateFixtureLayout(initialLayout(), options);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.access.size, 4);
  assert.equal(result.queueCells.length, 6);
  assert.equal(new Set(result.queueCells.map(cellKey)).size, 6);
  for (const cell of result.queueCells) {
    assert.equal(result.blockedCells.has(cellKey(cell)), false);
    assert.equal(options.reservedCells.has(cellKey(cell)), false);
  }
  assert.equal(result.blockedCells.has("12,2"), true);
});

const touches = (a, b) => Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy) === 1;

test("the register line runs straight out from the counter until blocked, then turns toward the door", () => {
  const options = createRoom();
  const result = validateFixtureLayout(initialLayout(), options);
  const cells = result.queueCells;
  const first = cells[0];
  result.queueCells.slice(1).forEach((cell, index) => {
    assert.ok(touches(cell, cells[index]), `spot ${index + 2} touches spot ${index + 1}`);
  });
  const turn = cells.findIndex((cell) => cell.gx !== first.gx);
  assert.ok(turn > 1, "at least two spots run straight out");
  cells.slice(0, turn).forEach((cell, index) => assert.equal(cell.gy, first.gy + index));
  const corner = cells[turn - 1];
  const beyond = { gx: corner.gx, gy: corner.gy + 1 };
  assert.ok(!options.isWalkable(beyond.gx, beyond.gy) || result.blockedCells.has(cellKey(beyond)),
    "the line only turns once the straight path is blocked");
  const doorDistance = (cell) =>
    Math.abs(cell.gx - options.entrance.gx) + Math.abs(cell.gy - options.entrance.gy);
  assert.ok(doorDistance(cells[turn]) < doorDistance(corner), "the turn heads toward the door");
});

test("a boxed-in line still bends around obstacles one step at a time", () => {
  // A shelf beside the second spot blocks the line's turn toward the door.
  const layout = initialLayout().map((entry) =>
    entry.id === "fixture_demo_01" ? { ...entry, gx: 11, gy: 5 } : entry);
  const result = validateFixtureLayout(layout, createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.queueCells.length, 6);
  result.queueCells.slice(1).forEach((cell, index) => {
    assert.ok(touches(cell, result.queueCells[index]));
  });
  assert.ok(result.queueCells.every((cell) => !["11,5", "12,5"].includes(cellKey(cell))));
});

// Shelves wall off both sides of the space in front of the register (and its left side), so
// the only way to the counter is around the bottom of the shop and up a shelf-lined aisle.
const gauntletLayout = () => [...STARTING_FIXTURES.map((entry) => ({ ...entry })),
  { id: "gauntlet_top_left", type: "shelf_starter_2x1", gx: 11, gy: 2, rotation: 1 },
  { id: "gauntlet_left", type: "shelf_starter_2x1", gx: 11, gy: 4, rotation: 3 },
  { id: "gauntlet_right", type: "shelf_starter_2x1", gx: 14, gy: 4, rotation: 1 },
];

test("a shelf-lined checkout aisle is allowed and the line forms single file through it", () => {
  const options = createRoom();
  const result = validateFixtureLayout(gauntletLayout(), options);
  assert.equal(result.valid, true, result.reason);
  const cells = result.queueCells;
  assert.deepEqual(cells.slice(0, 3), [{ gx: 13, gy: 4 }, { gx: 13, gy: 5 }, { gx: 13, gy: 6 }]);
  cells.slice(1).forEach((cell, index) => assert.ok(touches(cell, cells[index])));
  assert.ok(cells.every((cell) => !result.blockedCells.has(cellKey(cell))));
});

test("customers can walk into the checkout aisle to every spot in line, and back out to the door", () => {
  const options = createRoom();
  const result = validateFixtureLayout(gauntletLayout(), options);
  const canWalk = (gx, gy) => options.isWalkable(gx, gy) && !result.blockedCells.has(`${gx},${gy}`);
  const inside = { gx: options.entrance.gx, gy: options.entrance.gy + 1 };
  for (const cell of result.queueCells) {
    const path = findGridPath(inside, cell, canWalk);
    assert.ok(path, `route from the door to ${cellKey(cell)}`);
    assert.ok(path.every((step) => canWalk(step.gx, step.gy)));
  }
  // The aisle is closed at the top, so the route in has to come up from the bottom row.
  const toCounter = findGridPath(inside, result.queueCells[0], canWalk);
  assert.ok(toCounter.some((step) => step.gy === 6));
  assert.ok(findGridPath(result.queueCells[0], inside, canWalk), "route from the counter back to the door");
});

test("fixtures can move without mutating the old layout", () => {
  const original = initialLayout();
  const result = validateFixtureLayout(moved("fixture_demo_01", 11, 5), createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.deepEqual(original[0], TEST_SHELF);
  assert.equal(validateFixtureLayout(moved("register", 12, 3), createRoom()).valid, true);
  assert.equal(validateFixtureLayout(moved("storage_demo_01", 6, 4), createRoom()).valid, true);
  assert.equal(validateFixtureLayout(moved("storage_demo_01", 3, 104), createRoom()).valid, true);
});

test("placement rejects walls, locked rooms, overlaps, blocked fronts, and obstructed register backs", () => {
  for (const [id, gx, gy] of [
    ["fixture_demo_01", 0, 0],
    ["fixture_demo_01", 16, 2],
    ["fixture_demo_01", 1, 1],
    ["storage_demo_02", 1, 3],
    ["register", 12, 1],
    ["fixture_demo_01", 7, 7],
  ]) {
    assert.equal(validateFixtureLayout(moved(id, gx, gy), createRoom()).valid, false, `${id} at ${gx},${gy}`);
  }
});

test("placement preserves doors, both sides of the backroom entrance, the loading pad, and player or crate space", () => {
  const options = createRoom();
  assert.equal(validateFixtureLayout(moved("storage_demo_01", 2, 109), options).valid, false);
  const link = getBackroomLink();
  for (const { gx, gy } of [link.shop, link.backroom]) {
    const blockedEntrance = validateFixtureLayout(moved("storage_demo_01", gx, gy), options);
    assert.equal(blockedEntrance.valid, false, `backroom entrance at ${gx},${gy}`);
    assert.match(blockedEntrance.reason, /entrances/);
  }
  options.occupiedRectangles = [{ left: 720, right: 760, top: 330, bottom: 370 }];
  const result = validateFixtureLayout(moved("fixture_demo_01", 11, 5), options);
  assert.equal(result.valid, false);
  assert.match(result.reason, /player or crate/);
});

test("a fixture's front squares can never sit in a doorway", () => {
  const options = createRoom();
  let checked = 0;
  for (const doorway of options.doorwayCells) {
    const [doorGX, doorGY] = doorway.split(",").map(Number);
    for (let rotation = 0; rotation < 4; rotation += 1) {
      for (let gy = doorGY - 3; gy <= doorGY + 3; gy += 1) {
        for (let gx = doorGX - 3; gx <= doorGX + 3; gx += 1) {
          const placement = { ...TEST_SHELF, gx, gy, rotation };
          if (!fixtureAccessCells(placement).some((cell) => cellKey(cell) === doorway)) continue;
          if (fixtureCells(placement).some((cell) => options.reservedCells.has(cellKey(cell)) ||
            !options.isWalkable(cell.gx, cell.gy))) continue;
          const layout = initialLayout().map((entry) => entry.id === TEST_SHELF.id ? placement : entry);
          const result = validateFixtureLayout(layout, options);
          assert.equal(result.valid, false, `front in doorway ${doorway} from ${gx},${gy} turned ${rotation}`);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 0, "no placement faced into a doorway");
});

test("shelves can be placed near the front door if they preserve the route to the register", () => {
  const result = validateFixtureLayout(moved("fixture_demo_01", 9, 1), createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.equal(validateFixtureLayout(moved("fixture_demo_01", 6, 1), createRoom()).valid, false);
});

test("otherwise valid layouts cannot leave an isolated floor pocket", () => {
  const options = createRoom();
  for (const [gx, gy] of [[2, 106], [1, 105], [1, 107]]) options.room.addWall(gx, gy, "wall", true);
  const result = validateFixtureLayout(initialLayout(), options);
  assert.equal(result.valid, false);
  assert.match(result.reason, /cuts off/);
});

test("expansion unlock preserves authored walls and does not unlock a new game's rooms", () => {
  const { room } = createRoom();
  room.unlockZone("expansion_a");
  assert.equal(room.isWalkable(5, 2), false);
  assert.equal(room.isWalkable(6, 3), true);
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
  assert.equal(fixtureCells(initialLayout()[0]).length, 2);
});

test("the store door is in the sales floor's top wall, leaving the bottom wall free", () => {
  const sales = getZone("sales_floor");
  const door = getStoreDoorCell();
  assert.equal(door.gy, sales.gridY);
  assert.ok(door.gx > sales.gridX && door.gx < sales.gridX + sales.gridW - 1);
  const { room } = createRoom();
  assert.equal(room.isWalkable(door.gx, door.gy), true);
  for (let gx = sales.gridX; gx < sales.gridX + sales.gridW; gx += 1) {
    assert.equal(room.isWalkable(gx, sales.gridY + sales.gridH - 1), false, `bottom wall at ${gx}`);
  }
});

test("layouts can hold any number of fixtures, but exactly one register", () => {
  const withExtraShelf = [
    ...initialLayout(),
    { id: "shelf_universal_2", type: "shelf_universal", gx: 6, gy: 4 },
  ];
  const result = validateFixtureLayout(withExtraShelf, createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.access.has("shelf_universal_2"), true);

  const withoutShelf = initialLayout().filter((entry) => getFixtureType(entry.type).kind !== "shelf");
  assert.equal(validateFixtureLayout(withoutShelf, createRoom()).valid, true);

  const noRegister = initialLayout().filter((entry) => entry.type !== "register_basic");
  assert.match(validateFixtureLayout(noRegister, createRoom()).reason, /exactly one register/);
  const unknownType = initialLayout();
  unknownType[0] = { ...unknownType[0], type: "nope" };
  assert.equal(validateFixtureLayout(unknownType, createRoom()).valid, false);
});

test("entries saved before fixture types existed are migrated by id", () => {
  assert.deepEqual(migrateFixtureEntry({ id: "fixture_demo_01", gx: 7, gy: 2 }),
    { id: "fixture_demo_01", gx: 7, gy: 2, type: "shelf_universal" });
  assert.deepEqual(migrateFixtureEntry({ id: "storage_demo_02", gx: 4, gy: 1 }),
    { id: "storage_demo_02", gx: 4, gy: 1, type: "locker_single" });
  assert.deepEqual(migrateFixtureEntry({ id: "mystery", gx: 0, gy: 0 }), { id: "mystery", gx: 0, gy: 0 });
});

test("the compact shelf occupies two floor tiles", () => {
  const starter = getFixtureType(TEST_SHELF.type);
  assert.deepEqual({ w: starter.w, h: starter.h }, { w: 2, h: 1 });
});

const turned = (id, gx, gy, rotation) =>
  initialLayout().map((entry) => entry.id === id ? { ...entry, gx, gy, rotation } : entry);

test("turning a fixture swaps its footprint and moves its front clockwise", () => {
  const shelf = { type: "shelf_starter_2x1", gx: 9, gy: 4 };
  assert.deepEqual(fixtureFootprint({ ...shelf, rotation: 1 }), { w: 1, h: 2 });
  assert.deepEqual(["down", "left", "up", "right"],
    [0, 1, 2, 3].map((rotation) => fixtureFacing({ ...shelf, rotation })));
  assert.deepEqual(fixtureAccessCells({ ...shelf, rotation: 0 }), [{ gx: 9, gy: 5 }, { gx: 10, gy: 5 }]);
  assert.deepEqual(fixtureAccessCells({ ...shelf, rotation: 1 }), [{ gx: 8, gy: 4 }, { gx: 8, gy: 5 }]);
  assert.deepEqual(fixtureAccessCells({ ...shelf, rotation: 2 }), [{ gx: 9, gy: 3 }, { gx: 10, gy: 3 }]);
  assert.deepEqual(fixtureAccessCells({ ...shelf, rotation: 3 }), [{ gx: 10, gy: 4 }, { gx: 10, gy: 5 }]);
  assert.deepEqual(fixtureAccessCells({ ...shelf, rotation: 1 }, true), [{ gx: 10, gy: 4 }, { gx: 10, gy: 5 }]);
  assert.deepEqual(fixtureCells({ ...shelf, rotation: 3 }), [{ gx: 9, gy: 4 }, { gx: 9, gy: 5 }]);
});

test("the E key reaches a turned fixture only from its new front", () => {
  const leftFacing = { type: "shelf_starter_2x1", gx: 9, gy: 4, rotation: 1 };
  const left = 9 * TILE_SIZE;
  assert.equal(fixtureInteractionDistance(leftFacing, { x: left - 20, y: 4 * TILE_SIZE + 10 }), 20);
  assert.equal(fixtureInteractionDistance(leftFacing, { x: left + 20, y: 6 * TILE_SIZE + 10 }), Infinity);
  const upFacing = { type: "shelf_starter_2x1", gx: 9, gy: 4, rotation: 2 };
  assert.equal(fixtureInteractionDistance(upFacing, { x: left + 10, y: 4 * TILE_SIZE - 15 }), 15);
  assert.equal(fixtureInteractionDistance(upFacing, { x: left + 10, y: 5 * TILE_SIZE + 15 }), Infinity);
});

test("turned shelves can line the bottom and side walls", () => {
  const sales = getZone("sales_floor");
  const bottomRow = sales.gridY + sales.gridH - 2;
  const rightColumn = sales.gridX + sales.gridW - 2;
  // Facing down into the bottom wall is useless; turned to face up it works.
  assert.equal(validateFixtureLayout(moved("fixture_demo_01", 9, bottomRow), createRoom()).valid, false);
  const bottom = validateFixtureLayout(turned("fixture_demo_01", 9, bottomRow, 2), createRoom());
  assert.equal(bottom.valid, true, bottom.reason);
  // Against the right wall, facing left into the room.
  const side = validateFixtureLayout(turned("fixture_demo_01", rightColumn, 5, 1), createRoom());
  assert.equal(side.valid, true, side.reason);
  // Facing right, into that same wall, it can't be used.
  assert.equal(validateFixtureLayout(turned("fixture_demo_01", rightColumn, 5, 3), createRoom()).valid, false);
  // Two shelves along the wall don't block each other.
  const lined = initialLayout().map((entry) => {
    if (entry.id === "register") return { ...entry, gx: 9, gy: 2 };
    if (entry.id === "fixture_demo_01") return { ...entry, gx: rightColumn, gy: 3, rotation: 1 };
    return entry;
  });
  lined.push({ id: "shelf_2", type: "shelf_starter_2x1", gx: rightColumn, gy: 5, rotation: 1 });
  const result = validateFixtureLayout(lined, createRoom());
  assert.equal(result.valid, true, result.reason);
});

test("a turned register needs both its new front and back clear, and its line forms in front", () => {
  // Facing left: customers line up to its left; the cashier stands on its right.
  const result = validateFixtureLayout(turned("register", 12, 3, 1), createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.queueCells.length, 6);
  assert.deepEqual(result.queueCells[0], { gx: 11, gy: 4 });
  assert.ok(result.queueCells.every((cell) => cell.gx <= 11));
  // Against the right wall there's nowhere behind it for the cashier.
  const blocked = validateFixtureLayout(turned("register", 13, 3, 1), createRoom());
  assert.equal(blocked.valid, false);
  assert.match(blocked.reason, /front and back/);
});

test("invalid rotations are rejected", () => {
  for (const rotation of [4, -1, 0.5, "1"]) {
    assert.equal(validateFixtureLayout(turned("fixture_demo_01", 9, 5, rotation), createRoom()).valid, false);
  }
});

test("registers and shelves stay on the sales floor; storage can go anywhere", () => {
  for (const [id, gx, gy] of [["register", 1, 104], ["fixture_demo_01", 1, 104]]) {
    const result = validateFixtureLayout(moved(id, gx, gy), createRoom());
    assert.equal(result.valid, false, `${id} at ${gx},${gy}`);
    assert.match(result.reason, /sales floor/);
  }
  assert.equal(validateFixtureLayout(moved("storage_demo_01", 1, 104), createRoom()).valid, true);
  assert.equal(validateFixtureLayout(moved("storage_demo_01", 6, 4), createRoom()).valid, true);

  // Older saves with a register in the back still load so it can be moved out.
  const legacy = validateFixtureLayout(moved("register", 1, 104), { ...createRoom(), requireSalesFloor: false });
  assert.equal(legacy.valid, true, legacy.reason);
});

test("the backroom only connects to the shop through its door pair", () => {
  const options = createRoom();
  const link = getBackroomLink();
  const walkable = (gx, gy) => options.room.isWalkable(gx, gy);
  assert.equal(findGridPath(options.entrance, link.backroom, walkable), null);
  assert.ok(findGridPath(options.entrance, link.shop, walkable));
  assert.ok(findGridPath(link.backroom, { gx: 2, gy: 109 }, walkable));
  const unlinked = validateFixtureLayout(initialLayout(), { ...options, links: [] });
  assert.equal(unlinked.valid, false);
  assert.match(unlinked.reason, /LOCKER accessible/);
});
