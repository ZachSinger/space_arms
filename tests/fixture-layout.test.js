import assert from "node:assert/strict";
import test from "node:test";
import { STARTING_FIXTURES, FIXTURE_POSITION_STEP, FIXTURE_SNAP_STEP, fixtureAccessCells, fixtureAtWorldPoint, fixtureBounds, fixtureCells, fixtureFacing, fixtureFootprint, fixtureFrontClearance, fixturesOverlap, fixtureStandingSpot, cellKey, getFixtureType, isFixturePosition, migrateFixtureEntry, snapFixturePosition, validateFixtureLayout, fixtureInteractionDistance } from "../js/logic/FixtureLayout.js";
import { FixturePlacement } from "../js/logic/FixturePlacement.js";
import { FixturePlacementGrid } from "../js/logic/FixturePlacementGrid.js";
import { TileRoom } from "../js/logic/TileRoom.js";
import { findGridPath } from "../js/logic/Pathfinder.js";
import { getZone, getStoreDoorCell, getStoreDoorCells, getBackroomLink, getBackroomInteriorBounds, getLoadingPadBounds, TILE_SIZE } from "../js/logic/RoomLayout.js";

test("shelf crates cannot enter placement mode in the backroom", () => {
  const messages = [];
  const crate = { kind: "fixture", typeId: "shelf_budget_2x4" };
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
  const crate = { kind: "fixture", typeId: "shelf_budget_2x4" };
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

test("the fixture placement preview uses the size for its current facing", () => {
  const placement = Object.create(FixturePlacement.prototype);
  const spec = getFixtureType("shelf_budget_2x2");
  const rotations = [];
  const outlines = [];
  placement.spec = spec;
  placement.original = null;
  placement.statusElement = {};
  placement.scene = {
    fixtures: { nextId: () => "preview" },
    checkFixturePlacement: () => ({ valid: true, reason: "Click to place." }),
    sizeFacingArt: (ghost, receivedSpec, rotation) => {
      assert.equal(receivedSpec, spec);
      rotations.push(rotation);
      ghost.setDisplaySize(TILE_SIZE, TILE_SIZE);
    },
  };
  placement.graphics = {
    clear() { outlines.length = 0; return this; },
    fillStyle() { return this; },
    lineStyle() { return this; },
    fillRect() { return this; },
    strokeRect(...bounds) { outlines.push(bounds); return this; },
  };
  placement.ghost = {
    setPosition() { return this; },
    setTexture(key) { this.texture = key; return this; },
    setAngle(angle) { this.angle = angle; return this; },
    setDisplaySize(width, height) { this.width = width; this.height = height; return this; },
  };
  for (let rotation = 0; rotation < 4; rotation++) {
    placement.rotation = rotation;
    placement.updatePreviewAt(5 * TILE_SIZE, 5 * TILE_SIZE);
    assert.equal(placement.ghost.texture, spec.facingTextures[fixtureFacing({ rotation })]);
    assert.equal(placement.ghost.angle, 0);
    assert.equal(placement.ghost.width, TILE_SIZE);
    assert.equal(placement.ghost.height, TILE_SIZE);
    const bounds = fixtureBounds(placement.placement);
    const front = fixtureFrontClearance(placement.placement);
    assert.deepEqual(outlines, [
      [bounds.left * TILE_SIZE, bounds.top * TILE_SIZE,
        (bounds.right - bounds.left) * TILE_SIZE, (bounds.bottom - bounds.top) * TILE_SIZE],
      [front.left * TILE_SIZE, front.top * TILE_SIZE,
        (front.right - front.left) * TILE_SIZE, (front.bottom - front.top) * TILE_SIZE],
    ], "the preview follows the shelf exactly, without separate floor-square boxes");
  }
  assert.deepEqual(rotations, [0, 1, 2, 3]);
});

test("each budget shelf width fits its sections and stays on the placement grid when turned", () => {
  const widths = { 2: 1.125, 3: 1.625, 4: 2 };
  for (const levels of [2, 3]) {
    for (const columns of [2, 3, 4]) {
      const type = `shelf_budget_${levels}x${columns}`;
      const w = widths[columns];
      assert.deepEqual(fixtureFootprint({ type, rotation: 0 }), { w, h: 1 });
      assert.deepEqual(fixtureFootprint({ type, rotation: 1 }), { w: 1, h: w });
      assert.equal(w % FIXTURE_SNAP_STEP, 0);
    }
  }
});

test("the single-locker placement preview matches the smaller in-game art", () => {
  const placement = Object.create(FixturePlacement.prototype);
  const ghost = {
    setDisplaySize(width, height) { this.width = width; this.height = height; return this; },
    setAlpha() { return this; },
    setDepth() { return this; },
  };
  const original = {
    id: "moving", type: "locker_single", x: 96, y: 128, sprite: { setAlpha() {} },
  };
  const placed = [];
  placement.scene = {
    endRegisterSession() {},
    fixtures: {
      displayName: () => "LOCKER",
      layout: () => [
        { id: "moving", type: "locker_single", gx: 1, gy: 1, rotation: 0 },
        { id: "shelf", type: "shelf_budget_2x4", gx: 9, gy: 2, rotation: 0 },
        { id: "register", type: "register_basic", gx: 13, gy: 3, rotation: 0 },
      ],
    },
    player: { sprite: { body: { stop() {} } } },
    restockCrates: [],
    add: { image: () => ghost },
  };
  placement.cancel = () => {};
  placement.refreshPreview = () => {};
  placement.nameElement = {};
  placement.graphics = { setVisible() {} };
  placement.placedGraphics = {
    clear() { placed.length = 0; return this; },
    setVisible(visible) { this.visible = visible; return this; },
    fillStyle() { return this; },
    lineStyle() { return this; },
    fillRect() { return this; },
    strokeRect(...bounds) { placed.push(bounds); return this; },
  };
  placement.uiWindow = { openWindow() {} };

  placement.start("locker_single", original, null);
  assert.deepEqual([ghost.width, ghost.height], [36, 68]);
  assert.equal(placement.placedGraphics.visible, true);
  assert.deepEqual(placed, [
    [9 * TILE_SIZE, 2 * TILE_SIZE, 2 * TILE_SIZE, TILE_SIZE],
    [13 * TILE_SIZE, 3 * TILE_SIZE, TILE_SIZE, TILE_SIZE],
  ], "other fixtures show only their solid bodies, not their blue standing areas");
});

test("fixture interaction covers its entire front but not its sides or back", () => {
  const shelf = { type: "shelf_budget_2x4", gx: 9, gy: 2 };
  const left = 9 * TILE_SIZE;
  const right = 11 * TILE_SIZE;
  const front = 3 * TILE_SIZE;
  for (const x of [left, left + TILE_SIZE, right - 1]) {
    assert.equal(fixtureInteractionDistance(shelf, { x, y: front + 20 }), 20);
  }
  assert.equal(fixtureInteractionDistance(shelf, { x: left - 1, y: front + 20 }), Infinity);
  assert.equal(fixtureInteractionDistance(shelf, { x: right, y: front + 20 }), Infinity);
  assert.equal(fixtureInteractionDistance(shelf, { x: left + 20, y: front - 1 }), Infinity);
});

function createRoom() {
  const scene = {
    add: { image: (x, y) => ({
      x, y,
      setDisplaySize(width, height) { this.width = width; this.height = height; return this; },
      setOrigin() { return this; },
      setCrop() { return this; },
      setDepth() { return this; },
      setTexture() { return this; },
      destroy() {},
    }) },
    physics: { add: { staticGroup: () => ({ add() {}, remove() {} }) } },
  };
  const room = new TileRoom(scene);
  const entrance = getStoreDoorCell();
  for (const cell of getStoreDoorCells()) room.openDoorway(cell.gx, cell.gy, "door");
  room.addBackroomDoors();
  const link = getBackroomLink();
  const doorwayCells = new Set([
    ...getStoreDoorCells().flatMap((cell) => [cellKey(cell), `${cell.gx},${cell.gy + 1}`]),
    cellKey(link.shop),
    cellKey(link.backroom),
  ]);
  const reservedCells = new Set(doorwayCells);
  return {
    room, entrance, reservedCells, doorwayCells, links: [[link.shop, link.backroom]],
    get backroomBounds() { return getBackroomInteriorBounds(room.zones); },
    reservedRectangles: [getLoadingPadBounds()],
    isWalkable: (gx, gy) => room.isWalkable(gx, gy),
    isWall: (gx, gy) => {
      const wall = room.wallCells.get(`${gx},${gy}`);
      return Boolean(wall && !wall.door);
    },
  };
}

// New games start with no shelves, so most layout tests add one clear of the front door.
const TEST_SHELF = { id: "fixture_demo_01", type: "shelf_budget_2x4", gx: 16, gy: 6 };
const initialLayout = () => [TEST_SHELF, ...STARTING_FIXTURES].map((entry) => ({ ...entry }));

const moved = (id, gx, gy) => initialLayout().map((entry) => entry.id === id ? { ...entry, gx, gy } : entry);

function createPlacementGridGraphics() {
  return {
    rectangles: [],
    setDepth() { return this; },
    setVisible(visible) { this.visible = visible; return this; },
    clear() { this.rectangles.length = 0; return this; },
    fillStyle(...style) { this.style = style; return this; },
    fillRect(...rect) { this.rectangles.push(rect); return this; },
    destroy() {},
  };
}

function finishPlacementGrid(grid) {
  grid.update();
  let frames = 0;
  while (grid.scan && frames++ < 1000) grid.update();
  assert.equal(grid.scan, null, "the placement grid finishes checking the visible area");
}

function gridCoversPoint(graphics, x, y) {
  return graphics.rectangles.some(([left, top, width, height]) =>
    x >= left && x <= left + width && y >= top && y <= top + height);
}

test("fixture placement snaps to 8-pixel increments and still accepts saved 2-pixel positions", () => {
  for (const type of ["shelf_budget_3x3", "locker_single"]) {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const placement = fixtureAtWorldPoint({ type, rotation }, 117, 203);
      assert.equal((placement.gx * TILE_SIZE) % 8, 0);
      assert.equal((placement.gy * TILE_SIZE) % 8, 0);
    }
  }
  assert.equal(FIXTURE_SNAP_STEP * TILE_SIZE, 8);
  assert.equal(snapFixturePosition(0.07), FIXTURE_SNAP_STEP);
  assert.equal(isFixturePosition(FIXTURE_POSITION_STEP), true);

  for (const type of ["locker_single", "shelf_budget_2x2"]) {
    const placement = Object.create(FixturePlacement.prototype);
    placement.active = true;
    placement.spec = { id: type };
    placement.padPoint = { x: 1, y: 1 };
    placement.refreshPreview = () => {};
    placement.handlePad({ navDirection: "right", justPressed: () => false });
    assert.equal(placement.padPoint.x, 1 + FIXTURE_SNAP_STEP);
  }
});

test("the placement grid covers fixture bodies at snapped positions, including clipped bodies", () => {
  const graphics = createPlacementGridGraphics();
  const view = { x: 0, y: 0, right: 320, bottom: 320 };
  const checkedPositions = [];
  let secondPlacement = false;
  const scene = {
    room: {
      zones: [{ id: "floor", gridX: 0, gridY: 0, gridW: 8, gridH: 8, salesFloor: true }],
      wallCells: new Map(),
    },
    playerInBackroom: false,
    player: { sprite: { body: { enable: false } } },
    restockCrates: [],
    cameras: { main: { worldView: view } },
    fixtures: { layout: () => [], nextId: () => "candidate" },
    fixturePlacement: { active: true, spec: getFixtureType("shelf_budget_2x4"), rotation: 0, original: null },
    checkFixturePlacement: (type, gx, gy) => {
      checkedPositions.push([gx * TILE_SIZE, gy * TILE_SIZE]);
      return {
        valid: gx * TILE_SIZE === 64 && gy * TILE_SIZE === 64 ||
          secondPlacement && gx * TILE_SIZE === 144 && gy * TILE_SIZE === 64,
      };
    },
    add: { graphics: () => graphics },
  };
  const grid = new FixturePlacementGrid(scene);
  grid.toggle();
  finishPlacementGrid(grid);
  assert.ok(checkedPositions.length > 0);
  assert.ok(checkedPositions.every(([x, y]) => x % 8 === 0 && y % 8 === 0),
    "the overlay checks only positions the fixture can snap to");
  assert.deepEqual(graphics.rectangles, [[64, 64, 128, 64]]);
  assert.equal(gridCoversPoint(graphics, 73, 73), true, "coverage is solid between snap points");
  for (let index = 0; index < graphics.rectangles.length; index++) {
    const [x, y, width, height] = graphics.rectangles[index];
    for (const [otherX, otherY, otherWidth, otherHeight] of graphics.rectangles.slice(index + 1)) {
      assert.equal(x < otherX + otherWidth && x + width > otherX &&
        y < otherY + otherHeight && y + height > otherY, false,
      "overlapping valid placements do not stack translucent fills");
    }
  }

  assert.deepEqual(graphics.style, [0x00ff00, 0.3]);
  assert.equal(gridCoversPoint(graphics, 184, 72), true, "the body reaches well beyond its center");
  assert.equal(gridCoversPoint(graphics, 56, 72), false);
  assert.equal(gridCoversPoint(graphics, 200, 72), false);
  assert.equal(gridCoversPoint(graphics, 72, 136), false, "standing space is not part of the body");

  scene.fixturePlacement.rotation = 1;
  finishPlacementGrid(grid);
  assert.deepEqual(graphics.rectangles, [[64, 64, 64, 128]]);
  assert.equal(gridCoversPoint(graphics, 184, 72), false);

  scene.fixturePlacement.rotation = 0;
  Object.assign(view, { x: 160, y: 72, right: 192, bottom: 120 });
  finishPlacementGrid(grid);
  assert.deepEqual(graphics.rectangles, [[160, 72, 32, 48]]);
  assert.equal(gridCoversPoint(graphics, 176, 96), true, "the fixture's origin can be outside the camera");

  Object.assign(view, { x: 0, y: 0, right: 160, bottom: 160 });
  scene.fixturePlacement.spec = getFixtureType("locker_single");
  finishPlacementGrid(grid);
  assert.deepEqual(graphics.rectangles, [[64, 64, 36, 68]]);
  scene.fixturePlacement.rotation = 1;
  finishPlacementGrid(grid);
  assert.deepEqual(graphics.rectangles, [[64, 64, 24, 68]]);

  scene.fixturePlacement.spec = getFixtureType("shelf_budget_2x2");
  scene.fixturePlacement.rotation = 0;
  view.right = 256;
  secondPlacement = true;
  finishPlacementGrid(grid);
  assert.deepEqual(graphics.rectangles, [[64, 64, 72, 64], [144, 64, 72, 64]]);
  assert.equal(gridCoversPoint(graphics, 140, 72), false, "separate valid footprints do not fill the gap between them");
  assert.equal(gridCoversPoint(graphics, 152, 72), true);

  scene.fixturePlacement.active = false;
  grid.update();
  assert.equal(graphics.visible, false);
  assert.deepEqual(graphics.rectangles, []);
});

test("the body coverage follows real placement rules around the default register", () => {
  const options = createRoom();
  const graphics = createPlacementGridGraphics();
  const view = { x: 11 * TILE_SIZE, y: 2 * TILE_SIZE, right: 16 * TILE_SIZE, bottom: 6 * TILE_SIZE };
  const scene = {
    room: options.room,
    playerInBackroom: false,
    player: { sprite: { body: { enable: false } } },
    restockCrates: [],
    cameras: { main: { worldView: view } },
    fixtures: { layout: () => STARTING_FIXTURES, nextId: () => "candidate" },
    fixturePlacement: { active: true, spec: getFixtureType("shelf_budget_2x2"), rotation: 0, original: null },
    add: { graphics: () => graphics },
  };
  const layoutFor = (candidate) => scene.fixturePlacement.original
    ? STARTING_FIXTURES.map((entry) => entry.id === candidate.id ? candidate : entry)
    : [...STARTING_FIXTURES, candidate];
  const currentOptions = (connectivityCache = null) => ({
    ...options, connectivityCache,
    occupiedRectangles: [scene.player.sprite.body, ...scene.restockCrates.map((crate) => crate.sprite.body)]
      .filter((body) => body.enable),
  });
  const validBodies = [];
  const validate = (candidate, connectivityCache) => {
    const result = validateFixtureLayout(layoutFor(candidate), currentOptions(connectivityCache));
    if (result.valid) {
      const bounds = fixtureBounds(candidate);
      validBodies.push(Object.fromEntries(Object.entries(bounds).map(([edge, value]) => [edge, value * TILE_SIZE])));
    }
    return result;
  };
  scene.checkFixturePlacement = (type, gx, gy, rotation, connectivityCache) =>
    validate({ id: "candidate", type, gx, gy, rotation }, connectivityCache);
  scene.checkFixtureMove = (id, gx, gy, rotation, connectivityCache) =>
    validate({ id, type: scene.fixturePlacement.spec.id, gx, gy, rotation }, connectivityCache);
  const grid = new FixturePlacementGrid(scene);
  grid.toggle();
  const finishAndCompare = () => {
    finishPlacementGrid(grid);
    assert.ok(validBodies.length > 0, "there is at least one valid placement");
    const activeView = scene.playerInBackroom ? scene.backroomCamera.worldView : view;
    for (let y = activeView.y + 8; y < activeView.bottom; y += 16) {
      for (let x = activeView.x + 8; x < activeView.right; x += 16) {
        const covered = validBodies.some((body) =>
          x >= body.left && x <= body.right && y >= body.top && y <= body.bottom);
        assert.equal(gridCoversPoint(graphics, x, y), covered, `coverage at ${x},${y}`);
      }
    }
  };
  finishAndCompare();
  const registerX = 13.5 * TILE_SIZE;
  const registerY = 3.5 * TILE_SIZE;
  assert.equal(gridCoversPoint(graphics, registerX, registerY), false, "a shelf cannot cover the register");

  const openPoints = [];
  for (let x = view.x + 16; x < view.right - 16; x += 16) {
    const clearOfFixtures = STARTING_FIXTURES.every((fixture) => {
      const bounds = fixtureBounds(fixture);
      return x + 8 <= bounds.left * TILE_SIZE || x - 8 >= bounds.right * TILE_SIZE ||
        registerY + 8 <= bounds.top * TILE_SIZE || registerY - 8 >= bounds.bottom * TILE_SIZE;
    });
    if (clearOfFixtures && gridCoversPoint(graphics, x, registerY)) openPoints.push(x);
  }
  assert.ok(openPoints.length > 0);
  const blockedX = openPoints[0];
  scene.player.sprite.body = { enable: true, left: blockedX - 8, right: blockedX + 8, top: registerY - 8, bottom: registerY + 8 };
  const startingResult = validateFixtureLayout(STARTING_FIXTURES, currentOptions());
  assert.equal(startingResult.valid, true, startingResult.reason);
  validBodies.length = 0;
  finishAndCompare();
  assert.equal(gridCoversPoint(graphics, blockedX, registerY), false, "the player's body blocks the grid");

  scene.player.sprite.body.enable = false;
  scene.restockCrates = [{
    sprite: { body: { enable: true, left: blockedX - 8, right: blockedX + 8, top: registerY - 6, bottom: registerY + 10 } },
  }];
  validBodies.length = 0;
  finishAndCompare();
  assert.equal(gridCoversPoint(graphics, blockedX, registerY), false, "a loose crate blocks the grid");

  scene.restockCrates = [];
  scene.fixturePlacement.spec = getFixtureType("register_basic");
  scene.fixturePlacement.original = STARTING_FIXTURES.find((fixture) => fixture.id === "register");
  validBodies.length = 0;
  finishAndCompare();
  assert.equal(gridCoversPoint(graphics, registerX, registerY), true, "the register can cover its own old position");

  scene.playerInBackroom = true;
  scene.backroomCamera = {
    worldView: { x: TILE_SIZE, y: 100 * TILE_SIZE, right: 2.5 * TILE_SIZE, bottom: 102 * TILE_SIZE },
  };
  scene.fixturePlacement.spec = getFixtureType("locker_single");
  scene.fixturePlacement.original = STARTING_FIXTURES[0];
  validBodies.length = 0;
  finishAndCompare();
  assert.equal(gridCoversPoint(graphics, 80, 100 * TILE_SIZE + 40), true, "the locker may tuck into its back wall");
});

test("a new game starts with lockers and a register but no shelves", () => {
  assert.equal(STARTING_FIXTURES.some((entry) => getFixtureType(entry.type).kind === "shelf"), false);
  assert.equal(STARTING_FIXTURES.filter((entry) => getFixtureType(entry.type).kind === "storage").length, 2);
  assert.equal(STARTING_FIXTURES.filter((entry) => getFixtureType(entry.type).kind === "register").length, 1);
  const result = validateFixtureLayout(STARTING_FIXTURES, createRoom());
  assert.equal(result.valid, true, result.reason);
});

test("starting lockers touch side by side without blocking their standing space", () => {
  const lockers = STARTING_FIXTURES.filter((entry) => entry.type === "locker_single");
  assert.equal(fixtureBounds(lockers[0]).right, fixtureBounds(lockers[1]).left);
  assert.equal(fixturesOverlap(lockers[0], lockers[1]), false);
  const result = validateFixtureLayout(STARTING_FIXTURES, createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.blockedCells.has("1,102"), false);
  assert.equal(fixtureAccessCells(lockers[1]).length, 1, "a narrow front between cell centers still has access");
});

test("locker standing space follows its facing and cannot be covered by another locker", () => {
  for (let rotation = 0; rotation < 4; rotation++) {
    const locker = { type: "locker_single", gx: 10, gy: 10, rotation };
    const bounds = fixtureBounds(locker);
    const front = fixtureFrontClearance(locker);
    const sideways = rotation % 2 === 1;
    assert.equal((sideways ? front.right - front.left : front.bottom - front.top) * TILE_SIZE,
      sideways ? 28 : 48);
    const spot = fixtureStandingSpot(locker, fixtureAccessCells(locker)[0]);
    assert.equal(fixtureInteractionDistance(locker, spot), sideways ? 14 : 24);
    const intruder = {
      type: "locker_single",
      gx: front.left,
      gy: front.top,
    };
    if (rotation === 1) intruder.gx = bounds.left - fixtureFootprint(intruder).w;
    if (rotation === 2) intruder.gy = bounds.top - fixtureFootprint(intruder).h;
    assert.equal(fixturesOverlap(locker, intruder), true);
    assert.equal((bounds.right - bounds.left) * TILE_SIZE, sideways ? 24 : 36);
  }
});

test("shelf standing outlines follow fractional positions and all four facings", () => {
  for (const type of ["shelf_budget_2x2", "shelf_budget_2x4", "shelf_budget_3x3"]) {
    for (let rotation = 0; rotation < 4; rotation++) {
      const shelf = { type, gx: 10.03125, gy: 5.21875, rotation };
      const { left, top, right, bottom } = fixtureBounds(shelf);
      const expected = [
        { left, top: bottom, right, bottom: bottom + 1 },
        { left: left - 1, top, right: left, bottom },
        { left, top: top - 1, right, bottom: top },
        { left: right, top, right: right + 1, bottom },
      ][rotation];
      assert.deepEqual(fixtureFrontClearance(shelf), expected);
    }
  }
});

test("shelf standing space rejects even a small furniture overlap but can share an aisle", () => {
  const shelf = { ...TEST_SHELF, gx: 16.5, gy: 4.25 };
  const intruder = { id: "intruder", type: "shelf_budget_2x2", gx: 18.4375, gy: 5.25 };
  const layout = initialLayout().map((entry) => entry.id === shelf.id ? shelf : entry);
  for (const entries of [[...layout, intruder], [intruder, ...layout]]) {
    const result = validateFixtureLayout(entries, createRoom());
    assert.equal(result.valid, false);
    assert.match(result.reason, /stand in front of shelves/);
  }
  const neighbor = { ...intruder, gx: 18.5 };
  const touching = validateFixtureLayout([...layout, neighbor], createRoom());
  assert.equal(touching.valid, true, touching.reason);
  const opposite = { type: shelf.type, gx: shelf.gx, gy: 6.25, rotation: 2 };
  assert.equal(fixturesOverlap(shelf, opposite), false, "opposing shelves can share standing space");
});

test("the whole shelf standing outline must clear walls, including corners outside access cells", () => {
  const shelf = { ...TEST_SHELF, gx: 16.5, gy: 4.25 };
  const layout = initialLayout().map((entry) => entry.id === shelf.id ? shelf : entry);
  const options = createRoom();
  assert.equal(validateFixtureLayout(layout, options).valid, true);
  options.room.addWall(18, 6, "wall", true);
  assert.equal(fixtureAccessCells(shelf).some((cell) => cell.gx === 18 && cell.gy === 6), false);
  const result = validateFixtureLayout(layout, options);
  assert.equal(result.valid, false);
  assert.match(result.reason, /front of BUDGET SHELF 2x4 accessible/);
});

test("lockers tuck into the backroom's top wall as far as shelves do, and no farther", () => {
  const register = STARTING_FIXTURES.at(-1);
  const layout = (gy, rotation = 0) => [{ id: "locker", type: "locker_single", gx: 1, gy, rotation }, register];
  assert.equal(validateFixtureLayout(layout(100.5), createRoom()).valid, true);
  assert.match(validateFixtureLayout(layout(100.375), createRoom()).reason, /Too far into the wall/);
  assert.equal(validateFixtureLayout(layout(100.5, 2), createRoom()).valid, false, "only a locker facing out of the wall may tuck");
});

test("all locker facings have reachable standing space in the compact backroom", () => {
  for (const [rotation, gx, gy] of [[0, 1, 101], [1, 2.625, 101.875], [2, 1, 101.875], [3, 1, 101.875]]) {
    const locker = { id: "locker", type: "locker_single", gx, gy, rotation };
    const result = validateFixtureLayout([locker, STARTING_FIXTURES.at(-1)], createRoom());
    assert.equal(result.valid, true, `${fixtureFacing(locker)}: ${result.reason}`);
    const access = fixtureAccessCells(locker)[0];
    assert.equal(result.blockedCells.has(cellKey(access)), false);
  }
});

test("backroom walls follow the pad's edge and upgrades keep the exit", () => {
  const { room } = createRoom();
  const assertRightWall = (gx, left) => {
    const wall = room.wallCells.get(`${gx},102`).image;
    assert.equal(wall.x - wall.width / 2, left);
    assert.equal(wall.width, TILE_SIZE);
  };
  assertRightWall(3, 192);
  const exit = "2,100";
  const pad = getLoadingPadBounds();
  for (const [id, gx, left] of [["backroom_upgrade_a", 5, 320], ["backroom_upgrade_b", 7, 448], ["backroom_upgrade_c", 9, 576]]) {
    room.unlockZone(id);
    assertRightWall(gx, left);
    assert.equal(room.wallCells.get(exit).door, true);
    assert.deepEqual(getLoadingPadBounds(), pad);
  }
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
  assert.equal(result.blockedCells.has("13,3"), true);
});

test("fractional fixture edges do not hide clear routes to register and shelf access", () => {
  const options = createRoom();
  const register = STARTING_FIXTURES.at(-1);
  assert.deepEqual(fixtureStandingSpot(register, fixtureAccessCells(register, true)[0]),
    { x: 13.5 * TILE_SIZE, y: 2.5 * TILE_SIZE });
  const registerGap = [
    ...initialLayout(),
    { id: "upper-shelf", type: "shelf_budget_2x2", gx: 14.125, gy: 1.5 },
  ];
  const registerResult = validateFixtureLayout(registerGap, options);
  assert.equal(registerResult.valid, true, registerResult.reason);

  const shelfGap = [
    ...initialLayout(),
    { id: "placed-shelf", type: "shelf_budget_2x2", gx: 17.625, gy: 1.5 },
    { id: "lower-shelf", type: "shelf_budget_2x2", gx: 18.125, gy: 3.5 },
  ];
  const shelfResult = validateFixtureLayout(shelfGap, options);
  assert.equal(shelfResult.valid, true, shelfResult.reason);
  assert.deepEqual(shelfResult.accessCells.get("placed-shelf"), [{ gx: 18, gy: 3 }]);
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
    entry.id === "fixture_demo_01" ? { ...entry, gx: 18, gy: 6 } : entry);
  const result = validateFixtureLayout(layout, createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.queueCells.length, 6);
  result.queueCells.slice(1).forEach((cell, index) => {
    assert.ok(touches(cell, result.queueCells[index]));
  });
  assert.ok(result.queueCells.every((cell) => !["18,6", "19,6"].includes(cellKey(cell))));
});

// Shelves wall off the register's right side, so customers have to go around the bottom
// of the shop to reach it.
const gauntletLayout = () => [...STARTING_FIXTURES.map((entry) => ({ ...entry })),
  { id: "gauntlet_top_left", type: "shelf_budget_2x4", gx: 14, gy: 3, rotation: 3 },
  { id: "gauntlet_left", type: "shelf_budget_2x4", gx: 14, gy: 5, rotation: 3 },
  { id: "gauntlet_right", type: "shelf_budget_2x4", gx: 17, gy: 5, rotation: 1 },
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
  assert.ok(toCounter.some((step) => step.gy === 7));
  assert.ok(findGridPath(result.queueCells[0], inside, canWalk), "route from the counter back to the door");
});

test("fixtures can move without mutating the old layout", () => {
  const original = initialLayout();
  const result = validateFixtureLayout(moved("fixture_demo_01", 18, 6), createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.deepEqual(original[0], TEST_SHELF);
  assert.equal(validateFixtureLayout(moved("register", 19, 4), createRoom()).valid, true);
  assert.equal(validateFixtureLayout(moved("storage_demo_01", 18, 5), createRoom()).valid, true);
  assert.equal(validateFixtureLayout(moved("storage_demo_01", 1, 101.03125), createRoom()).valid, true);
});

test("placement rejects walls, locked rooms, overlaps, blocked fronts, and obstructed register backs", () => {
  for (const [id, gx, gy] of [
    ["fixture_demo_01", 12, 0],
    ["fixture_demo_01", 13, 1],
    ["fixture_demo_01", 23, 3],
    ["fixture_demo_01", 8, 2],
    ["storage_demo_02", 8, 4],
    ["register", 19, 2],
    ["fixture_demo_01", 14, 8],
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
  options.occupiedRectangles = [{ left: 1168, right: 1208, top: 394, bottom: 434 }];
  const result = validateFixtureLayout(moved("fixture_demo_01", 18, 6), options);
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
  const result = validateFixtureLayout(moved("fixture_demo_01", 18, 2), createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.equal(validateFixtureLayout(moved("fixture_demo_01", 13, 2), createRoom()).valid, false);
});

test("otherwise valid layouts cannot leave an isolated floor pocket", () => {
  const options = createRoom();
  for (const [gx, gy] of [[20, 6], [21, 5], [21, 7]]) options.room.addWall(gx, gy, "wall", true);
  const result = validateFixtureLayout(initialLayout(), options);
  assert.equal(result.valid, false);
  assert.match(result.reason, /cuts off/);
});

test("expansion unlock preserves authored walls and does not unlock a new game's rooms", () => {
  const { room } = createRoom();
  room.unlockZone("expansion_a");
  assert.equal(room.isWalkable(12, 3), false);
  assert.equal(room.isWalkable(13, 4), true);
  assert.equal(room.isWalkable(22, 3), true, "the old right wall is gone");
  assert.equal(room.isWalkable(22, 1), false, "the back wall still runs above it");
  assert.equal(room.isWalkable(24, 3), true);
  assert.equal(new TileRoom(room.scene).isWalkable(24, 3), false);
  assert.equal(getZone("expansion_a").locked, true);
});

test("malformed layouts cannot bypass placement validation", () => {
  assert.equal(validateFixtureLayout([], createRoom()).valid, false);
  assert.equal(validateFixtureLayout(moved("fixture_demo_01", 14.3, 3), createRoom()).valid, false);
  const duplicate = initialLayout();
  duplicate[1] = { ...duplicate[0] };
  assert.equal(validateFixtureLayout(duplicate, createRoom()).valid, false);
  assert.equal(fixtureCells(initialLayout()[0]).length, 2);
});

test("the store door is in the lower row of the sales floor's two-tile back wall, leaving the bottom wall free", () => {
  const sales = getZone("sales_floor");
  const door = getStoreDoorCell();
  assert.equal(door.gy, sales.gridY + 1);
  assert.ok(door.gx > sales.gridX && door.gx + 1 < sales.gridX + sales.gridW - 1);
  const { room } = createRoom();
  for (const cell of getStoreDoorCells()) {
    assert.equal(room.isWalkable(cell.gx, cell.gy), true);
    assert.equal(room.isWalkable(cell.gx, cell.gy - 1), false, "the upper row of the back wall stays solid");
  }
  for (let gx = sales.gridX; gx < sales.gridX + sales.gridW; gx += 1) {
    assert.equal(room.isWalkable(gx, sales.gridY + sales.gridH - 1), false, `bottom wall at ${gx}`);
  }
});

test("layouts can hold any number of fixtures, but exactly one register", () => {
  const withExtraShelf = [
    ...initialLayout(),
    { id: "shelf_budget_3x4_2", type: "shelf_budget_3x4", gx: 18, gy: 5 },
  ];
  const result = validateFixtureLayout(withExtraShelf, createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.access.has("shelf_budget_3x4_2"), true);

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

test("the test Budget Shelf occupies two floor tiles", () => {
  const starter = getFixtureType(TEST_SHELF.type);
  assert.deepEqual({ w: starter.w, h: starter.h }, { w: 2, h: 1 });
});

const turned = (id, gx, gy, rotation) =>
  initialLayout().map((entry) => entry.id === id ? { ...entry, gx, gy, rotation } : entry);

test("turning a fixture swaps its footprint and moves its front clockwise", () => {
  const shelf = { type: "shelf_budget_2x4", gx: 9, gy: 4 };
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
  const leftFacing = { type: "shelf_budget_2x4", gx: 9, gy: 4, rotation: 1 };
  const left = 9 * TILE_SIZE;
  assert.equal(fixtureInteractionDistance(leftFacing, { x: left - 20, y: 4 * TILE_SIZE + 10 }), 20);
  assert.equal(fixtureInteractionDistance(leftFacing, { x: left + 20, y: 6 * TILE_SIZE + 10 }), Infinity);
  const upFacing = { type: "shelf_budget_2x4", gx: 9, gy: 4, rotation: 2 };
  assert.equal(fixtureInteractionDistance(upFacing, { x: left + 10, y: 4 * TILE_SIZE - 15 }), 15);
  assert.equal(fixtureInteractionDistance(upFacing, { x: left + 10, y: 5 * TILE_SIZE + 15 }), Infinity);
});

test("turned shelves can line the bottom and side walls", () => {
  const sales = getZone("sales_floor");
  const bottomRow = sales.gridY + sales.gridH - 2;
  const rightColumn = sales.gridX + sales.gridW - 2;
  // Facing down into the bottom wall is useless; turned to face up it works.
  assert.equal(validateFixtureLayout(moved("fixture_demo_01", 16, bottomRow), createRoom()).valid, false);
  const bottom = validateFixtureLayout(turned("fixture_demo_01", 16, bottomRow, 2), createRoom());
  assert.equal(bottom.valid, true, bottom.reason);
  // Against the right wall, facing left into the room.
  const side = validateFixtureLayout(turned("fixture_demo_01", rightColumn, 6, 1), createRoom());
  assert.equal(side.valid, true, side.reason);
  // Facing right, into that same wall, it can't be used.
  assert.equal(validateFixtureLayout(turned("fixture_demo_01", rightColumn, 6, 3), createRoom()).valid, false);
  // Two shelves along the wall don't block each other.
  const lined = initialLayout().map((entry) => {
    if (entry.id === "register") return { ...entry, gx: 13, gy: 3 };
    if (entry.id === "fixture_demo_01") return { ...entry, gx: rightColumn, gy: 4, rotation: 1 };
    return entry;
  });
  lined.push({ id: "shelf_2", type: "shelf_budget_2x4", gx: rightColumn, gy: 6, rotation: 1 });
  const result = validateFixtureLayout(lined, createRoom());
  assert.equal(result.valid, true, result.reason);
});

test("a turned register needs both its new front and back clear, and its line forms in front", () => {
  // Facing left: customers line up to its left; the cashier stands on its right.
  const result = validateFixtureLayout(turned("register", 19, 4, 1), createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.queueCells.length, 6);
  assert.deepEqual(result.queueCells[0], { gx: 18, gy: 4 });
  assert.ok(result.queueCells.every((cell) => cell.gx <= 18));
  // Against the right wall there's nowhere behind it for the cashier.
  const blocked = validateFixtureLayout(turned("register", 21, 4, 1), createRoom());
  assert.equal(blocked.valid, false);
  assert.match(blocked.reason, /front and back/);
});

test("invalid rotations are rejected", () => {
  for (const rotation of [4, -1, 0.5, "1"]) {
    assert.equal(validateFixtureLayout(turned("fixture_demo_01", 16, 6, rotation), createRoom()).valid, false);
  }
});

test("fixtures can sit between floor squares in eighth-of-a-tile steps", () => {
  const between = { ...TEST_SHELF, gx: 16.5, gy: 5.25 };
  // Every square it covers by more than a sliver is blocked; its front is the next clear row.
  assert.deepEqual(fixtureCells(between).map(cellKey), ["16,5", "17,5", "18,5", "16,6", "17,6", "18,6"]);
  assert.deepEqual(fixtureAccessCells(between), [{ gx: 16, gy: 7 }, { gx: 17, gy: 7 }]);
  // Shoppers still stand half a tile from its front edge, lined up with the shelf itself.
  assert.deepEqual(fixtureStandingSpot(between, { gx: 16, gy: 7 }),
    { x: 17 * TILE_SIZE, y: 6.75 * TILE_SIZE });
  assert.deepEqual(fixtureStandingSpot(between, { gx: 17, gy: 7 }),
    { x: 18 * TILE_SIZE, y: 6.75 * TILE_SIZE });
  assert.deepEqual(fixtureStandingSpot(TEST_SHELF, { gx: 16, gy: 7 }),
    { x: 16.5 * TILE_SIZE, y: 7.5 * TILE_SIZE }, "on whole squares, nothing changes");
  // An eighth of a tile over a square leaves it walkable.
  assert.deepEqual(fixtureCells({ ...TEST_SHELF, gx: 15.875, gy: 5.125 }).map(cellKey), ["16,5", "17,5"]);

  const layout = initialLayout().map((entry) => entry.id === TEST_SHELF.id ? between : entry);
  const result = validateFixtureLayout(layout, createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.deepEqual(result.access.get(TEST_SHELF.id), { gx: 17, gy: 7 });
  for (const gx of [16.1, Number.NaN]) {
    const bad = initialLayout().map((entry) => entry.id === TEST_SHELF.id ? { ...entry, gx } : entry);
    assert.equal(validateFixtureLayout(bad, createRoom()).valid, false);
  }
  // Fixtures may not overlap even by part of a square.
  const overlapping = [...layout, { id: "shelf_2", type: "shelf_budget_2x4", gx: 18.375, gy: 5.25 }];
  assert.match(validateFixtureLayout(overlapping, createRoom()).reason, /cannot overlap/);
  const touching = [...layout, { id: "shelf_2", type: "shelf_budget_2x4", gx: 18.5, gy: 5.25 }];
  assert.equal(validateFixtureLayout(touching, createRoom()).valid, true);
});

test("a shelf facing down can tuck its back halfway into the wall behind it", () => {
  const options = createRoom();
  const floorTop = getZone("sales_floor").gridY + 2;
  const gx = 18;
  assert.equal(options.isWall(gx, floorTop - 1), true);
  const at = (gy, rotation = 0) => validateFixtureLayout(
    initialLayout().map((entry) => entry.id === TEST_SHELF.id ? { ...entry, gx, gy, rotation } : entry),
    options,
  );
  const tucked = at(floorTop - 0.5);
  assert.equal(tucked.valid, true, tucked.reason);
  assert.equal(tucked.blockedCells.has(`${gx},${floorTop - 1}`), false, "the wall square isn't floor");
  assert.equal(tucked.blockedCells.has(`${gx},${floorTop}`), true);
  assert.deepEqual(tucked.access.get(TEST_SHELF.id), { gx: gx + 1, gy: floorTop + 1 });
  assert.match(at(floorTop - 0.625).reason, /Too far into the wall/);
  // Only a fixture's back goes against the wall.
  assert.equal(at(floorTop - 0.5, 1).valid, false);
});

test("registers and shelves stay on the sales floor; storage can go anywhere", () => {
  for (const [id, gx, gy] of [["register", 1, 101], ["fixture_demo_01", 1, 101]]) {
    const result = validateFixtureLayout(moved(id, gx, gy), createRoom());
    assert.equal(result.valid, false, `${id} at ${gx},${gy}`);
    assert.match(result.reason, /sales floor/);
  }
  assert.equal(validateFixtureLayout(moved("storage_demo_01", 1, 101.03125), createRoom()).valid, true);
  assert.equal(validateFixtureLayout(moved("storage_demo_01", 18, 5), createRoom()).valid, true);

});

test("the backroom only connects to the shop through its door pair", () => {
  const options = createRoom();
  const link = getBackroomLink();
  const walkable = (gx, gy) => options.room.isWalkable(gx, gy);
  assert.equal(findGridPath(options.entrance, link.backroom, walkable), null);
  assert.ok(findGridPath(options.entrance, link.shop, walkable));
  assert.ok(findGridPath(link.backroom, { gx: 2, gy: 104 }, walkable));
  const unlinked = validateFixtureLayout(initialLayout(), { ...options, links: [] });
  assert.equal(unlinked.valid, false);
  assert.match(unlinked.reason, /LOCKER accessible/);
});
