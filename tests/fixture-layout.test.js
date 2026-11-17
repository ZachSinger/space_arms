import assert from "node:assert/strict";
import test from "node:test";
import { STARTING_FIXTURES, FIXTURE_POSITION_STEP, FIXTURE_SNAP_STEP, FIXTURE_FRONT_CLEARANCE, fixtureAccessCells, fixtureAtWorldPoint, fixtureBounds, fixtureCells, fixtureFacing, fixtureFacingStep, fixtureFootprint, fixtureFrontClearance, fixtureProjectionBoxes, fixturesOverlap, fixtureStandingSpot, cellKey, getFixtureType, isFixturePosition, migrateFixtureEntry, planRegisterQueue, snapFixturePosition, validateFixtureLayout, fixtureInteractionDistance } from "../js/logic/FixtureLayout.js";
import { FixturePlacement } from "../js/logic/FixturePlacement.js";
import { FixturePlacementGrid } from "../js/logic/FixturePlacementGrid.js";
import { PAD } from "../js/logic/GamepadInput.js";
import { getInputDevice, setInputDevice } from "../js/logic/InputDevice.js";
import { TileRoom } from "../js/logic/TileRoom.js";
import { findGridPath } from "../js/logic/Pathfinder.js";
import {
  getZone, getStoreDoorCell, getStoreDoorCells, getBackroomDoorCell, getBackroomExitCell,
  getBackroomLink, getBackroomInteriorBounds, getLoadingPadBounds, getDoorwayClearanceBounds, TILE_SIZE,
} from "../js/logic/RoomLayout.js";

test("shelf and trashcan crates cannot enter placement mode in the backroom", () => {
  const messages = [];
  for (const typeId of ["shelf_budget_2x4", "trash_can"]) {
    const crate = { kind: "fixture", typeId };
    const placement = Object.create(FixturePlacement.prototype);
    placement.scene = {
      canRearrangeFixtures: () => true,
      carriedCrate: crate,
      playerInBackroom: true,
      showShopMessage: (message) => messages.push(message),
    };
    placement.start = () => assert.fail(`${typeId} placement should not start in the backroom.`);

    assert.equal(placement.beginFromCrate(crate), false);
    assert.equal(placement.scene.carriedCrate, crate);
  }
  assert.deepEqual(messages, [
    "Fixtures can only be placed on the sales floor.",
    "Fixtures can only be placed on the sales floor.",
  ]);
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

test("starting and cancelling placement keep the player and loose crates moving", () => {
  const previousDevice = getInputDevice();
  setInputDevice("keyboard");
  try {
    for (const fromCrate of [false, true]) {
      const velocity = { x: 160, y: 0 };
      const player = { inputEnabled: true, sprite: { body: { velocity, stop() { velocity.x = 0; } } } };
      const looseCrate = { moving: true, setPaused(paused) { this.moving = !paused; } };
      const carriedCrate = {
        sprite: { x: 200, y: 200, active: true, visible: true, setVisible(value) { this.visible = value; } },
      };
      const original = {
        x: 200, y: 200, type: "shelf_budget_2x2",
        sprite: { alpha: 1, setAlpha(value) { this.alpha = value; } },
      };
      const ghost = {
        setDisplaySize() { return this; },
        setAlpha() { return this; },
        setDepth() { return this; },
        destroy() { this.destroyed = true; },
      };
      const graphics = () => ({
        clear() { return this; },
        setVisible() { return this; },
      });
      let heldKey = true;
      const placement = Object.create(FixturePlacement.prototype);
      Object.assign(placement, {
        active: false,
        scene: {
          player,
          restockCrates: [looseCrate],
          input: { keyboard: { resetKeys() { heldKey = false; } } },
          fixtures: { displayName: () => "SHELF" },
          endRegisterSession() {},
          windowManager: { closeAllExcept() {} },
          add: { image: () => ghost },
        },
        graphics: graphics(),
        placedGraphics: graphics(),
        drawPlacedFixtures() {},
        refreshPreview() {},
      });

      assert.equal(placement.start("shelf_budget_2x2", fromCrate ? null : original, fromCrate ? carriedCrate : null), true);
      assert.equal(player.inputEnabled, true);
      assert.deepEqual(velocity, { x: 160, y: 0 });
      assert.equal(looseCrate.moving, true);
      if (fromCrate) assert.equal(carriedCrate.sprite.visible, false);

      placement.cancel();
      assert.equal(player.inputEnabled, true);
      assert.deepEqual(velocity, { x: 160, y: 0 });
      assert.equal(heldKey, true);
      assert.equal(looseCrate.moving, true);
      assert.equal(carriedCrate.sprite.visible, true);
      assert.equal(original.sprite.alpha, 1);
      assert.equal(ghost.destroyed, true);
    }
  } finally {
    setInputDevice(previousDevice);
  }
});

test("the fixture placement preview uses the size for its current facing", () => {
  const placement = Object.create(FixturePlacement.prototype);
  let spec;
  const rotations = [];
  const outlines = [];
  placement.original = null;
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
  for (const type of ["shelf_budget_2x2", "trash_can", "register_basic"]) {
    spec = getFixtureType(type);
    placement.spec = spec;
    for (let rotation = 0; rotation < 4; rotation++) {
      placement.rotation = rotation;
      placement.updatePreviewAt(5 * TILE_SIZE, 5 * TILE_SIZE);
      assert.equal(placement.ghost.texture, spec.facingTextures[fixtureFacing({ rotation })]);
      assert.equal(placement.ghost.angle, 0);
      assert.equal(placement.ghost.width, TILE_SIZE);
      assert.equal(placement.ghost.height, TILE_SIZE);
      const bounds = fixtureBounds(placement.placement);
      assert.deepEqual(outlines, [bounds, ...fixtureProjectionBoxes(placement.placement)].map((rect) => [
        rect.left * TILE_SIZE, rect.top * TILE_SIZE,
        (rect.right - rect.left) * TILE_SIZE, (rect.bottom - rect.top) * TILE_SIZE,
      ]), "the preview follows every fixture exactly, without separate floor-square boxes");
    }
  }
  assert.deepEqual(rotations, [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
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

test("fixture interaction covers its entire front but not its sides or back", () => {
  const shelf = { type: "shelf_budget_2x4", gx: 9, gy: 2 };
  const bounds = fixtureBounds(shelf);
  const left = bounds.left * TILE_SIZE;
  const right = bounds.right * TILE_SIZE;
  const front = bounds.bottom * TILE_SIZE;
  for (const x of [left, left + TILE_SIZE, right - 1]) {
    assert.equal(fixtureInteractionDistance(shelf, { x, y: front + 20 }), 20);
  }
  assert.equal(fixtureInteractionDistance(shelf, { x: left - 1, y: front + 20 }), Infinity);
  assert.equal(fixtureInteractionDistance(shelf, { x: right, y: front + 20 }), Infinity);
  assert.equal(fixtureInteractionDistance(shelf, { x: left + 20, y: front - 1 }), Infinity);
});

function createRoom({ expanded = false } = {}) {
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
  if (expanded) {
    for (const id of ["expansion_west", "expansion_a", "expansion_b"]) room.unlockZone(id);
  }
  const entrance = getStoreDoorCell();
  for (const cell of getStoreDoorCells()) room.openDoorway(cell.gx, cell.gy, "door");
  room.addBackroomDoors();
  const link = getBackroomLink();
  const doorwayCells = new Set([
    ...getStoreDoorCells().map(cellKey),
    cellKey(getBackroomDoorCell()),
    cellKey(getBackroomExitCell()),
  ]);
  const reservedCells = new Set([
    ...doorwayCells,
    ...getStoreDoorCells().map((cell) => `${cell.gx},${cell.gy + 1}`),
    cellKey(link.shop),
    cellKey(link.backroom),
  ]);
  return {
    room, entrance, reservedCells, doorwayCells, fixtureReservedCells: doorwayCells,
    links: [[link.shop, link.backroom]],
    get backroomBounds() { return getBackroomInteriorBounds(room.zones); },
    reservedRectangles: [getLoadingPadBounds()],
    doorwayClearanceRectangles: getDoorwayClearanceBounds(),
    isWalkable: (gx, gy) => room.isWalkable(gx, gy),
    isWall: (gx, gy) => {
      const wall = room.wallCells.get(`${gx},${gy}`);
      return Boolean(wall && !wall.door);
    },
  };
}

// New games start with no shelves, so most layout tests add one clear of the front door.
// They leave out the starting trashcan so shelves can be tried anywhere on the floor.
const TEST_SHELF = { id: "fixture_demo_01", type: "shelf_budget_2x4", gx: 16, gy: 3 };
const initialLayout = () => [TEST_SHELF, ...STARTING_FIXTURES.filter((entry) => entry.type !== "trash_can")]
  .map((entry) => ({ ...entry }));

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
  for (const type of ["shelf_budget_3x3"]) {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const placement = fixtureAtWorldPoint({ type, rotation }, 117, 203);
      assert.equal((placement.gx * TILE_SIZE) % 8, 0);
      assert.equal((placement.gy * TILE_SIZE) % 8, 0);
    }
  }
  assert.equal(FIXTURE_SNAP_STEP * TILE_SIZE, 8);
  assert.equal(snapFixturePosition(0.07), FIXTURE_SNAP_STEP);
  assert.equal(isFixturePosition(FIXTURE_POSITION_STEP), true);
});

test("controller walking and dashing leave the fixture cursor free for the right stick", () => {
  const camera = {
    x: 0, y: 0, width: 400, height: 300, scrollX: 0, scrollY: 0,
    matrix: { transformPoint: (x, y) => ({ x, y }) },
    getWorldPoint(x, y) { return { x: x + this.scrollX, y: y + this.scrollY }; },
  };
  const placement = Object.create(FixturePlacement.prototype);
  let pressed = new Set();
  let cancelled = 0;
  let confirmed = 0;
  Object.assign(placement, {
    active: true,
    scene: { cameras: { main: camera } },
    spec: getFixtureType("shelf_budget_2x2"),
    rotation: 0,
    padPoint: { x: 100, y: 100 },
    updatePreviewAt(x, y) {
      this.lastWorld = { x, y };
      this.placement = fixtureAtWorldPoint({ type: this.spec.id, rotation: this.rotation }, x, y);
    },
    cancel() { cancelled += 1; },
    confirm() { confirmed += 1; },
  });
  const pad = {
    navDirection: "left",
    rightStick: { x: 0, y: 0 },
    justPressed: (button) => pressed.has(button),
  };

  placement.handlePad(pad, 50);
  assert.deepEqual(placement.padPoint, { x: 100, y: 100 }, "walking does not move the cursor");
  pad.rightStick.x = 1;
  placement.handlePad(pad, 50);
  assert.deepEqual(placement.padPoint, { x: 112, y: 100 });
  assert.equal((placement.placement.gx * TILE_SIZE) % 8, 0);
  camera.scrollX = 64;
  placement.refreshPreview();
  assert.deepEqual(placement.lastWorld, { x: 176, y: 100 }, "the cursor stays on screen as the camera moves");

  pad.rightStick.x = 0;
  pressed = new Set([PAD.B]);
  placement.handlePad(pad, 16);
  assert.equal(cancelled, 0, "B remains available for dashing");
  pressed = new Set([PAD.Y]);
  placement.handlePad(pad, 16);
  assert.equal(placement.rotation, 1);
  pressed = new Set([PAD.A]);
  placement.handlePad(pad, 16);
  assert.equal(confirmed, 1);
  pressed = new Set([PAD.X]);
  placement.handlePad(pad, 16);
  assert.equal(cancelled, 1);
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
  assert.deepEqual(graphics.rectangles, [[64, 80, 128, 48]]);
  assert.equal(gridCoversPoint(graphics, 73, 89), true, "coverage is solid between snap points");
  for (let index = 0; index < graphics.rectangles.length; index++) {
    const [x, y, width, height] = graphics.rectangles[index];
    for (const [otherX, otherY, otherWidth, otherHeight] of graphics.rectangles.slice(index + 1)) {
      assert.equal(x < otherX + otherWidth && x + width > otherX &&
        y < otherY + otherHeight && y + height > otherY, false,
      "overlapping valid placements do not stack translucent fills");
    }
  }

  assert.deepEqual(graphics.style, [0x00ff00, 0.3]);
  assert.equal(gridCoversPoint(graphics, 184, 88), true, "the body reaches well beyond its center");
  assert.equal(gridCoversPoint(graphics, 184, 72), false, "transparent image padding is not body coverage");
  assert.equal(gridCoversPoint(graphics, 56, 72), false);
  assert.equal(gridCoversPoint(graphics, 200, 72), false);
  assert.equal(gridCoversPoint(graphics, 72, 136), false, "standing space is not part of the body");

  scene.fixturePlacement.rotation = 1;
  finishPlacementGrid(grid);
  assert.deepEqual(graphics.rectangles, [[74, 66, 44, 126]]);
  assert.equal(gridCoversPoint(graphics, 184, 72), false);

  scene.fixturePlacement.rotation = 0;
  Object.assign(view, { x: 160, y: 72, right: 192, bottom: 120 });
  finishPlacementGrid(grid);
  assert.deepEqual(graphics.rectangles, [[160, 80, 32, 40]]);
  assert.equal(gridCoversPoint(graphics, 176, 96), true, "the fixture's origin can be outside the camera");

  Object.assign(view, { x: 0, y: 0, right: 160, bottom: 160 });
  scene.fixturePlacement.spec = getFixtureType("shelf_budget_2x2");
  scene.fixturePlacement.rotation = 0;
  view.right = 256;
  secondPlacement = true;
  finishPlacementGrid(grid);
  // The 2x2 picture's empty top band and 2px side margins aren't solid.
  assert.deepEqual(graphics.rectangles, [[66, 80, 68, 48], [146, 80, 68, 48]]);
  assert.equal(gridCoversPoint(graphics, 140, 88), false, "separate valid footprints do not fill the gap between them");
  assert.equal(gridCoversPoint(graphics, 152, 88), true);
  assert.equal(gridCoversPoint(graphics, 152, 72), false, "the see-through top of the picture isn't solid");

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

});

test("a new game starts with a trashcan and register but no shelves", () => {
  assert.equal(STARTING_FIXTURES.some((entry) => getFixtureType(entry.type).kind === "shelf"), false);
  assert.equal(STARTING_FIXTURES.filter((entry) => getFixtureType(entry.type).kind === "trash").length, 1);
  assert.equal(STARTING_FIXTURES.filter((entry) => getFixtureType(entry.type).kind === "register").length, 1);
  const result = validateFixtureLayout(STARTING_FIXTURES, createRoom());
  assert.equal(result.valid, true, result.reason);
});

test("all fixture projection boxes follow their body edges and facing at fractional positions", () => {
  for (const type of ["shelf_budget_2x2", "shelf_budget_2x4", "shelf_budget_3x3", "trash_can", "register_basic"]) {
    for (let rotation = 0; rotation < 4; rotation++) {
      const shelf = { type, gx: 10.03125, gy: 5.21875, rotation };
      const { left, top, right, bottom } = fixtureBounds(shelf);
      const c = FIXTURE_FRONT_CLEARANCE;
      const expectedByFacing = [
        { left, top: bottom, right, bottom: bottom + c },
        { left: left - c, top, right: left, bottom },
        { left, top: top - c, right, bottom: top },
        { left: right, top, right: right + c, bottom },
      ];
      const expected = expectedByFacing[rotation];
      assert.deepEqual(fixtureFrontClearance(shelf), expected);
      const projections = fixtureProjectionBoxes(shelf);
      assert.deepEqual(projections[0], expected);
      assert.equal(projections.length, type === "register_basic" ? 2 : 1);
      if (type === "register_basic") {
        assert.deepEqual(projections[1], expectedByFacing[(rotation + 2) % 4]);
      }
    }
  }
});

test("shelf standing space rejects even a small furniture overlap but can share an aisle", () => {
  const shelf = { ...TEST_SHELF, gx: 16.5, gy: 3.25 };
  const intruder = { id: "intruder", type: "shelf_budget_2x2", gx: 18.4375, gy: 4.25 };
  const layout = initialLayout().map((entry) => entry.id === shelf.id ? shelf : entry);
  for (const entries of [[...layout, intruder], [intruder, ...layout]]) {
    const result = validateFixtureLayout(entries, createRoom({ expanded: true }));
    assert.equal(result.valid, false);
    assert.match(result.reason, /stand at fixtures/);
  }
  const neighbor = { ...intruder, gx: 18.5 };
  const touching = validateFixtureLayout([...layout, neighbor], createRoom({ expanded: true }));
  assert.equal(touching.valid, true, touching.reason);
  const opposite = { type: shelf.type, gx: shelf.gx, gy: 5.25, rotation: 2 };
  assert.equal(fixturesOverlap(shelf, opposite), false, "opposing shelves can share standing space");
});

test("register rear projections reject furniture, but can share another fixture's projection", () => {
  const register = { type: "register_basic", gx: 14, gy: 3, rotation: 1 };
  const trashcan = { type: "trash_can", gx: 14.75, gy: 3.125, rotation: 1 };
  const body = fixtureBounds(register);
  assert.ok(fixtureBounds(trashcan).left > body.right, "the body boxes do not overlap");
  assert.equal(fixturesOverlap(register, trashcan), true, "the cashier's projection must stay clear");
  assert.equal(fixturesOverlap(trashcan, register), true);
  const neighbor = { ...trashcan, gx: 15 };
  assert.equal(fixturesOverlap(register, neighbor), false, "both projections can share the aisle");
  assert.equal(fixturesOverlap(neighbor, register), false);
});

test("the tallest shelf facing up can sit half a tile across from the shortest facing down, never on top of it", () => {
  const short = { id: "short", type: "shelf_budget_2x2", gx: 16, gy: 4, rotation: 0 };
  const tall = (gy) => ({ id: "tall", type: "shelf_budget_3x4", gx: 16, gy, rotation: 2 });
  const options = createRoom({ expanded: true });
  const layout = (gy) => [...initialLayout().filter((entry) => entry.id !== TEST_SHELF.id), short, tall(gy)];
  const closest = validateFixtureLayout(layout(5.5), options);
  assert.equal(closest.valid, true, closest.reason);
  assert.equal(validateFixtureLayout(layout(5.375), options).valid, false);
  // Shelf pictures stay inside the shelf's own space, so the two never overlap on screen.
  assert.ok(fixtureBounds(tall(5.5)).top >= fixtureBounds(short).bottom);
});

test("the whole shelf standing outline must clear walls, including corners outside access cells", () => {
  const shelf = { ...TEST_SHELF, gx: 16.5, gy: 4.75 };
  const layout = initialLayout().map((entry) => entry.id === shelf.id ? shelf : entry);
  const options = createRoom({ expanded: true });
  assert.equal(validateFixtureLayout(layout, options).valid, true);
  options.room.addWall(18, 6, "wall", true);
  assert.equal(fixtureAccessCells(shelf).some((cell) => cell.gx === 18 && cell.gy === 6), false);
  const result = validateFixtureLayout(layout, options);
  assert.equal(result.valid, false);
  assert.match(result.reason, /front of BUDGET SHELF 2x4 accessible/);
});

test("backroom walls leave extra space above the pad and upgrades keep the exit", () => {
  const { room } = createRoom();
  const assertRightWall = (gx, left) => {
    const wall = room.wallCells.get(`${gx},102`).image;
    assert.equal(wall.x - wall.width / 2, left);
    assert.equal(wall.width, TILE_SIZE);
  };
  assertRightWall(3, 192);
  for (const gx of [1, 2]) {
    assert.equal(room.isWalkable(gx, 105), true, `new floor at ${gx},105`);
    assert.equal(room.wallCells.has(`${gx},106`), true, `bottom wall at ${gx},106`);
  }
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
  const result = validateFixtureLayout([TEST_SHELF, ...STARTING_FIXTURES], options);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.access.size, 3, "the register, the shelf, and the trashcan");
  assert.equal(result.queueCells.length, 6);
  assert.equal(new Set(result.queueCells.map(cellKey)).size, 6);
  for (const cell of result.queueCells) {
    assert.equal(result.blockedCells.has(cellKey(cell)), false);
    assert.equal(options.reservedCells.has(cellKey(cell)), false);
  }
  assert.equal(result.blockedCells.has("13,3"), true);
});

test("fractional fixture edges do not hide clear routes to register and shelf access", () => {
  const options = createRoom({ expanded: true });
  const register = STARTING_FIXTURES.at(-1);
  assert.deepEqual(fixtureStandingSpot(register, fixtureAccessCells(register, true)[0]),
    { x: 13.5 * TILE_SIZE, y: 2.75 * TILE_SIZE + 10 });
  const registerGap = [
    ...initialLayout(),
    { id: "upper-shelf", type: "shelf_budget_2x2", gx: 14.125, gy: 1.5 },
  ];
  const registerResult = validateFixtureLayout(registerGap, options);
  assert.equal(registerResult.valid, true, registerResult.reason);

  const shelfGap = [
    ...initialLayout().map((entry) => entry.id === TEST_SHELF.id ? { ...entry, gx: 15.5 } : entry),
    { id: "placed-shelf", type: "shelf_budget_2x2", gx: 17.625, gy: 1.5 },
    { id: "lower-shelf", type: "shelf_budget_2x2", gx: 17.875, gy: 3.5 },
  ];
  const shelfResult = validateFixtureLayout(shelfGap, options);
  assert.equal(shelfResult.valid, true, shelfResult.reason);
  assert.deepEqual(shelfResult.accessCells.get("placed-shelf"), [{ gx: 18, gy: 3 }]);
});

const touches = (a, b) => Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy) === 1;

test("the register line runs straight out from the counter until blocked, then turns toward the door", () => {
  const options = createRoom({ expanded: true });
  options.room.addWall(13, 7, "wall", true);
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
  const options = createRoom({ expanded: true });
  options.room.addWall(13, 6, "wall", true);
  // A shelf beside the second spot blocks the line's turn toward the door.
  const layout = initialLayout().map((entry) =>
    entry.id === "fixture_demo_01" ? { ...entry, gx: 14, gy: 5 } : entry);
  const result = validateFixtureLayout(layout, options);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.queueCells.length, 6);
  assert.deepEqual(result.queueCells.slice(0, 3), [{ gx: 13, gy: 4 }, { gx: 13, gy: 5 }, { gx: 12, gy: 5 }]);
  result.queueCells.slice(1).forEach((cell, index) => {
    assert.ok(touches(cell, result.queueCells[index]));
  });
  assert.ok(result.queueCells.every((cell) => !["14,5", "15,5"].includes(cellKey(cell))));
});

// Shelves wall off the register's right side, so customers have to go around the bottom
// of the shop to reach it.
const gauntletLayout = () => [...STARTING_FIXTURES.map((entry) => ({ ...entry })),
  { id: "gauntlet_top_left", type: "shelf_budget_2x2", gx: 14, gy: 3, rotation: 3 },
  { id: "gauntlet_left", type: "shelf_budget_2x4", gx: 14, gy: 4.125, rotation: 3 },
  { id: "gauntlet_right", type: "shelf_budget_2x4", gx: 17, gy: 4.125, rotation: 1 },
];

function gauntletRoom() {
  const options = createRoom({ expanded: true });
  for (let gy = 2; gy <= 6; gy += 1) options.room.addWall(12, gy, "wall", true);
  return options;
}

test("a shelf-lined checkout aisle is allowed and the line forms single file through it", () => {
  const options = gauntletRoom();
  const result = validateFixtureLayout(gauntletLayout(), options);
  assert.equal(result.valid, true, result.reason);
  const cells = result.queueCells;
  assert.deepEqual(cells.slice(0, 3), [{ gx: 13, gy: 4 }, { gx: 13, gy: 5 }, { gx: 13, gy: 6 }]);
  cells.slice(1).forEach((cell, index) => assert.ok(touches(cell, cells[index])));
  assert.ok(cells.every((cell) => !result.blockedCells.has(cellKey(cell))));
});

test("customers can walk into the checkout aisle to every spot in line, and back out to the door", () => {
  const options = gauntletRoom();
  const result = validateFixtureLayout(gauntletLayout(), options);
  assert.equal(result.valid, true, result.reason);
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
  const result = validateFixtureLayout(moved("fixture_demo_01", 18, 3), createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.deepEqual(original[0], TEST_SHELF);
  assert.equal(validateFixtureLayout(moved("register", 14, 3), createRoom()).valid, true);
});

test("placement rejects walls, locked rooms, overlaps, blocked fronts, and obstructed register backs", () => {
  for (const [id, gx, gy] of [
    ["fixture_demo_01", 12, 0],
    ["fixture_demo_01", 13, 1],
    ["fixture_demo_01", 23, 3],
    ["fixture_demo_01", 8, 2],
    ["register", 19, 2],
    ["fixture_demo_01", 14, 8],
  ]) {
    assert.equal(validateFixtureLayout(moved(id, gx, gy), createRoom()).valid, false, `${id} at ${gx},${gy}`);
  }
});

test("placement preserves door thresholds, the loading pad, and player or crate space", () => {
  const options = createRoom();
  assert.equal(validateFixtureLayout(moved("fixture_demo_01", 2, 109), options).valid, false);
  const link = getBackroomLink();
  const besideEntrance = validateFixtureLayout(moved("fixture_demo_01", link.shop.gx, link.shop.gy), options);
  assert.equal(besideEntrance.valid, false);
  assert.match(besideEntrance.reason, /entrances/);
  options.occupiedRectangles = [{ left: 1168, right: 1208, top: 202, bottom: 242 }];
  const result = validateFixtureLayout(moved("fixture_demo_01", 18, 3), options);
  assert.equal(result.valid, false);
  assert.match(result.reason, /player or crate/);
});

test("a shelf can sit beside a doorway approach while leaving a walkable passage", () => {
  const options = createRoom({ expanded: true });
  const backroomShelf = {
    id: "backroom-shelf",
    type: "shelf_budget_2x2",
    gx: 19.75,
    gy: 2.75,
    rotation: 3,
  };
  const upperShelf = {
    id: "upper-shelf",
    type: "shelf_budget_3x4",
    gx: 20.5,
    gy: 1.25,
    rotation: 0,
  };
  const register = STARTING_FIXTURES.find((entry) => getFixtureType(entry.type).kind === "register");
  const result = validateFixtureLayout([register, upperShelf, backroomShelf], options);
  assert.equal(result.valid, true, result.reason);
});

test("a sideways shelf cannot cover part of the public doorway even if someone fits beside it", () => {
  const options = createRoom({ expanded: true });
  const door = getStoreDoorCell();
  const shelf = {
    id: "doorway-shelf",
    type: "shelf_budget_2x4",
    gx: door.gx + 0.375,
    gy: door.gy + 1,
    rotation: 3,
  };
  const register = STARTING_FIXTURES.find((entry) => getFixtureType(entry.type).kind === "register");
  for (const offset of [0.375, 0.5, 0.75]) {
    const result = validateFixtureLayout([register, { ...shelf, gx: door.gx + offset }], options);
    assert.equal(result.valid, false, `offset ${offset}`);
    assert.match(result.reason, /entrances/);
  }
});

test("transparent margins on larger sideways shelves do not block a player or crate beside them", () => {
  for (const type of ["shelf_budget_2x4", "shelf_budget_3x3"]) {
    const options = createRoom({ expanded: true });
    const shelf = { id: "trimmed-shelf", type, gx: 17, gy: 5, rotation: 3 };
    options.occupiedRectangles = [{
      left: 17 * TILE_SIZE,
      right: 17 * TILE_SIZE + 8,
      top: 5 * TILE_SIZE + 16,
      bottom: 5 * TILE_SIZE + 32,
    }];
    const register = STARTING_FIXTURES.find((entry) => getFixtureType(entry.type).kind === "register");
    const result = validateFixtureLayout([register, shelf], options);
    assert.equal(result.valid, true, `${type}: ${result.reason}`);
    options.occupiedRectangles[0].right += 8;
    const touchingBody = validateFixtureLayout([register, shelf], options);
    assert.equal(touchingBody.valid, false);
    assert.match(touchingBody.reason, /player or crate/);
  }
});

test("a walkable projection can share the floor in front of a doorway", () => {
  const options = createRoom({ expanded: true });
  const { shop } = getBackroomLink();
  const shelf = { id: "doorway-shelf", type: "shelf_budget_2x2", gx: shop.gx + 0.125, gy: shop.gy + 0.75, rotation: 2 };
  const register = STARTING_FIXTURES.find((entry) => getFixtureType(entry.type).kind === "register");
  const result = validateFixtureLayout([register, shelf], options);
  assert.equal(result.valid, true, result.reason);
  assert.ok(result.accessCells.get(shelf.id).length > 0);
  const fartherAway = validateFixtureLayout([register, { ...shelf, gy: shelf.gy + 0.625 }], options);
  assert.equal(fartherAway.valid, true, fartherAway.reason);
});

test("the register can be placed beside the entrance when only its projection shares the approach", () => {
  const options = createRoom();
  const trash = { ...STARTING_FIXTURES.find((entry) => entry.type === "trash_can"), gx: 17, gy: 1.5 };
  const register = { id: "register", type: "register_basic", gx: 16.625, gy: 3.125, rotation: 0 };
  const door = getDoorwayClearanceBounds()[0];
  const rear = fixtureFrontClearance(register, true);
  assert.ok(rear.left * TILE_SIZE < door.right && rear.top * TILE_SIZE < door.bottom);
  assert.ok(fixtureBounds(register).top * TILE_SIZE >= door.bottom);

  const result = validateFixtureLayout([trash, register], options);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.queueCells.length, 6);
  result.queueCells.slice(1).forEach((cell, index) =>
    assert.ok(touches(cell, result.queueCells[index]), "the line stays connected"));

  const blockingDoor = validateFixtureLayout([trash, { ...register, gy: 2.875 }], options);
  assert.equal(blockingDoor.valid, false);
  assert.match(blockingDoor.reason, /entrances/);
});

test("a fixture's projection still cannot cover the loading pad", () => {
  const options = createRoom({ expanded: true });
  const register = { id: "register", type: "register_basic", gx: 22, gy: 5, rotation: 0 };
  const front = fixtureFrontClearance(register);
  options.reservedRectangles = [{
    left: front.left * TILE_SIZE, right: front.right * TILE_SIZE,
    top: front.top * TILE_SIZE, bottom: front.bottom * TILE_SIZE,
  }];
  const result = validateFixtureLayout([register], options);
  assert.equal(result.valid, false);
  assert.match(result.reason, /loading area/);
});

test("a register facing the back wall can still have a reachable single-file line beside it", () => {
  const options = createRoom();
  const trash = { ...STARTING_FIXTURES.find((entry) => entry.type === "trash_can"), gx: 17, gy: 1.5 };
  const register = { id: "register", type: "register_basic", gx: 13, gy: 3.125, rotation: 2 };
  const result = validateFixtureLayout([trash, register], options);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.queueCells.length, 6);
  const walkable = (gx, gy) => options.isWalkable(gx, gy) && !result.blockedCells.has(`${gx},${gy}`);
  result.queueCells.forEach((cell, index) => {
    assert.ok(findGridPath(options.entrance, cell, walkable), `queue spot ${index + 1} is reachable`);
    assert.ok(!options.reservedCells.has(cellKey(cell)), `queue spot ${index + 1} leaves doors clear`);
    assert.ok(cell.gy + 0.5 <= fixtureBounds(register).bottom, "nobody queues behind the counter");
    if (index > 0) assert.ok(touches(cell, result.queueCells[index - 1]), "the line stays connected");
  });
});

test("a register between floor squares near the bottom wall still gets a full line on the open floor", () => {
  const options = createRoom();
  const trash = { ...STARTING_FIXTURES.find((entry) => entry.type === "trash_can") };
  for (const [gx, gy] of [[16.75, 3.625], [13.125, 3.375], [15.25, 3.5]]) {
    const register = { id: "register", type: "register_basic", gx, gy, rotation: 0 };
    const result = validateFixtureLayout([trash, register], options);
    assert.equal(result.valid, true, `${gx},${gy}: ${result.reason}`);
    assert.equal(result.queuePoints.length, 6);
    const top = fixtureBounds(register).top * TILE_SIZE;
    result.queuePoints.forEach((point, index) => {
      assert.ok(point.y >= top, `spot ${index + 1} is not behind the counter`);
      result.queuePoints.slice(0, index).forEach((other) =>
        assert.ok(Math.hypot(point.x - other.x, point.y - other.y) >= 32, `spot ${index + 1} has room`));
    });
  }
});

test("the register can use reachable standing space within a partially occupied floor square", () => {
  const options = createRoom();
  const trash = { ...STARTING_FIXTURES.find((entry) => entry.type === "trash_can"), gx: 17, gy: 1.5 };
  for (const [gx, gy, rotation] of [[13, 3.5, 0], [14.25, 2, 1], [13, 2.625, 2], [16.5, 3.5, 3]]) {
    const register = { id: "register", type: "register_basic", gx, gy, rotation };
    const result = validateFixtureLayout([trash, register], options);
    assert.equal(result.valid, true, `facing ${rotation}: ${result.reason}`);
    assert.equal(result.queuePoints.length, 6);
    assert.deepEqual(result.queuePoints[0], fixtureStandingSpot(register, result.access.get(register.id)));

    const registerBounds = fixtureBounds(register);
    const step = fixtureFacingStep(register);
    const backEdge = step.dx ? (step.dx < 0 ? registerBounds.right : registerBounds.left) :
      (step.dy < 0 ? registerBounds.bottom : registerBounds.top);
    for (const [index, point] of result.queuePoints.entries()) {
      const body = { left: point.x - 11, right: point.x + 11, top: point.y - 10, bottom: point.y + 10 };
      for (let y = Math.floor(body.top / TILE_SIZE); y <= Math.floor((body.bottom - 0.001) / TILE_SIZE); y++) {
        for (let x = Math.floor(body.left / TILE_SIZE); x <= Math.floor((body.right - 0.001) / TILE_SIZE); x++) {
          assert.ok(options.isWalkable(x, y), `queue spot ${index + 1} clears walls`);
        }
      }
      for (const fixture of [trash, register]) {
        const bounds = fixtureBounds(fixture);
        assert.ok(body.right <= bounds.left * TILE_SIZE || body.left >= bounds.right * TILE_SIZE ||
          body.bottom <= bounds.top * TILE_SIZE || body.top >= bounds.bottom * TILE_SIZE,
        `queue spot ${index + 1} clears ${fixture.id}`);
      }
      assert.ok(!options.reservedCells.has(`${Math.floor(point.x / TILE_SIZE)},${Math.floor(point.y / TILE_SIZE)}`),
        `queue spot ${index + 1} leaves doorways clear`);
      assert.ok((step.dx ? (point.x / TILE_SIZE - backEdge) * step.dx :
        (point.y / TILE_SIZE - backEdge) * step.dy) >= 0, `queue spot ${index + 1} is not behind the register`);
      for (const previous of result.queuePoints.slice(0, index)) {
        assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) >= 32,
          `queue spot ${index + 1} leaves space from other customers`);
      }
    }
  }
});

test("the checkout line can choose another turn when the first one leads to a dead end", () => {
  const options = createRoom();
  const trash = { ...STARTING_FIXTURES.find((entry) => entry.type === "trash_can"), gx: 17, gy: 1.5 };
  const register = { id: "register", type: "register_basic", gx: 14.875, gy: 2.5, rotation: 1 };
  const result = validateFixtureLayout([trash, register], options);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.queueCells.length, 6);
  result.queueCells.slice(1).forEach((cell, index) =>
    assert.ok(touches(cell, result.queueCells[index]), "the line stays connected"));
});

test("a checkout line cannot fill its spots from disconnected branches", () => {
  const open = new Set(["0,0", "1,0", "2,0", "-1,0", "0,1", "0,-1"]);
  const canWalk = (gx, gy) => open.has(`${gx},${gy}`);
  const cells = planRegisterQueue({ gx: 0, gy: 0 }, { dx: 1, dy: 0 }, { gx: 2, gy: 0 }, canWalk, canWalk, 6);
  assert.equal(cells.length, 0);
});

test("a tightly turning checkout line keeps customers apart", () => {
  const options = createRoom();
  const trash = { ...STARTING_FIXTURES.find((entry) => entry.type === "trash_can"), gx: 17, gy: 1.5 };
  const register = { id: "register", type: "register_basic", gx: 14, gy: 3.5, rotation: 2 };
  const result = validateFixtureLayout([trash, register], options);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.queuePoints.length, 6);
  result.queuePoints.forEach((point, index) => {
    for (const previous of result.queuePoints.slice(0, index)) {
      assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) >= 32,
        `queue spot ${index + 1} leaves space from other customers`);
    }
  });
});

test("shelves can be placed near the front door if they preserve the route to the register", () => {
  const result = validateFixtureLayout(moved("fixture_demo_01", 17, 2), createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.equal(validateFixtureLayout(moved("fixture_demo_01", 13, 2), createRoom()).valid, false);
});

test("otherwise valid layouts cannot leave an isolated floor pocket", () => {
  const options = createRoom();
  for (const [gx, gy] of [[18, 4], [19, 3]]) options.room.addWall(gx, gy, "wall", true);
  const result = validateFixtureLayout(initialLayout(), options);
  assert.equal(result.valid, false);
  assert.match(result.reason, /cuts off/);
});

test("a half-square gap keeps the floor beyond it open; anything narrower cuts it off", () => {
  // A walled corner room (x 21-27, rows 9-11) whose only way in is one square at (24, 8).
  const withPocket = () => {
    const options = createRoom({ expanded: true });
    for (const [gx, gy] of [[20, 9], [20, 10], [20, 11], [21, 8], [22, 8], [23, 8], [25, 8], [26, 8], [27, 8]]) {
      options.room.addWall(gx, gy, "wall", true);
    }
    return options;
  };
  const trashAt = (gx) => [
    ...initialLayout(), { id: "gap-trash", type: "trash_can", gx, gy: 8, rotation: 2 },
  ];
  // The half-square-wide trashcan leaves the other half of the opening clear.
  const open = validateFixtureLayout(trashAt(24), withPocket());
  assert.equal(open.valid, true, open.reason);

  // An eighth of a square over, it leaves 8px and 24px gaps: too tight for anyone's feet.
  const closed = validateFixtureLayout(trashAt(24.125), withPocket());
  assert.equal(closed.valid, false);
  assert.match(closed.reason, /cuts off/);
});

test("expansion unlock preserves authored walls and does not unlock a new game's rooms", () => {
  const { room } = createRoom();
  const sales = getZone("sales_floor");
  const oldRightWall = sales.gridX + sales.gridW - 1;
  assert.equal(room.isWalkable(oldRightWall, 3), false);
  room.unlockZone("expansion_a");
  assert.equal(room.isWalkable(12, 3), false);
  assert.equal(room.isWalkable(13, 4), true);
  assert.equal(room.isWalkable(oldRightWall, 3), true, "the old right wall is gone");
  assert.equal(room.isWalkable(oldRightWall, 1), false, "the back wall still runs above it");
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

test("the starting shop has seven by three floor squares, top-wall doors, and a sealed bottom wall", () => {
  const sales = getZone("sales_floor");
  const door = getStoreDoorCell();
  assert.equal(door.gy, sales.gridY + 1);
  assert.ok(door.gx > sales.gridX && door.gx + 1 < sales.gridX + sales.gridW - 1);
  const { room } = createRoom();
  const floor = [...room.floorCells.keys()].filter((key) => {
    const [gx, gy] = key.split(",").map(Number);
    return gy >= sales.gridY + 2 && gy < sales.gridY + sales.gridH && room.isWalkable(gx, gy);
  });
  assert.equal(floor.length, 21);
  const backroom = getBackroomLink().shop;
  assert.deepEqual(backroom, { gx: 19, gy: 2 });
  assert.equal(room.isWalkable(backroom.gx, backroom.gy), true);
  assert.equal(room.wallCells.get(`${backroom.gx},${backroom.gy - 1}`).door, true);
  for (const cell of getStoreDoorCells()) {
    assert.equal(room.isWalkable(cell.gx, cell.gy), true);
    assert.equal(room.isWalkable(cell.gx, cell.gy - 1), false, "the upper row of the back wall stays solid");
  }
  for (let gx = sales.gridX; gx < sales.gridX + sales.gridW; gx += 1) {
    assert.equal(room.isWalkable(gx, sales.gridY + sales.gridH - 1), false, `bottom wall at ${gx}`);
  }
});

test("layouts can hold any number of fixtures, including extra registers with their own queues", () => {
  const withExtraShelf = [
    ...initialLayout(),
    { id: "shelf_budget_3x4_2", type: "shelf_budget_3x4", gx: 18, gy: 3 },
  ];
  const result = validateFixtureLayout(withExtraShelf, createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.access.has("shelf_budget_3x4_2"), true);

  const withoutShelf = initialLayout().filter((entry) => getFixtureType(entry.type).kind !== "shelf");
  assert.equal(validateFixtureLayout(withoutShelf, createRoom()).valid, true);

  const withSecondRegister = [
    ...initialLayout(),
    { id: "register_2", type: "register_basic", gx: 9, gy: 5 },
  ];
  // The starter room is too tight for a second six-person line; expansions make room.
  assert.equal(validateFixtureLayout(withSecondRegister, createRoom()).valid, false);
  const twoRegisters = validateFixtureLayout(withSecondRegister, createRoom({ expanded: true }));
  assert.equal(twoRegisters.valid, true, twoRegisters.reason);
  assert.equal(twoRegisters.queuePointsById.size, 2);
  const [lineA, lineB] = [...twoRegisters.queuePointsById.values()];
  assert.equal(lineA.length, lineB.length);
  // The two lines never share a spot.
  for (const point of lineA) {
    assert.ok(lineB.every((other) => Math.hypot(point.x - other.x, point.y - other.y) > 1),
      "queues must not overlap");
  }

  const noRegister = initialLayout().filter((entry) => entry.type !== "register_basic");
  assert.match(validateFixtureLayout(noRegister, createRoom()).reason, /needs a register/);
  const unknownType = initialLayout();
  unknownType[0] = { ...unknownType[0], type: "nope" };
  assert.equal(validateFixtureLayout(unknownType, createRoom()).valid, false);
});

test("entries saved before fixture types existed are migrated by id", () => {
  assert.deepEqual(migrateFixtureEntry({ id: "fixture_demo_01", gx: 7, gy: 2 }),
    { id: "fixture_demo_01", gx: 7, gy: 2, type: "shelf_universal" });
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
  const left = fixtureBounds(leftFacing).left * TILE_SIZE;
  assert.equal(fixtureInteractionDistance(leftFacing, { x: left - 20, y: 4 * TILE_SIZE + 10 }), 20);
  assert.equal(fixtureInteractionDistance(leftFacing, { x: left + 20, y: 6 * TILE_SIZE + 10 }), Infinity);
  const upFacing = { type: "shelf_budget_2x4", gx: 9, gy: 4, rotation: 2 };
  const top = fixtureBounds(upFacing).top * TILE_SIZE;
  assert.equal(fixtureInteractionDistance(upFacing, { x: left + 10, y: top - 15 }), 15);
  assert.equal(fixtureInteractionDistance(upFacing, { x: left + 10, y: 5 * TILE_SIZE + 15 }), Infinity);
});

test("turned shelves can line the bottom and side walls", () => {
  const options = createRoom({ expanded: true });
  const bottom = getZone("expansion_b");
  const east = getZone("expansion_a");
  const bottomRow = bottom.gridY + bottom.gridH - 2;
  const rightColumn = east.gridX + east.gridW - 2;
  // Facing down into the bottom wall is useless; turned to face up it works.
  assert.equal(validateFixtureLayout(moved("fixture_demo_01", 16, bottomRow), options).valid, false);
  const bottomShelf = validateFixtureLayout(turned("fixture_demo_01", 16, bottomRow, 2), options);
  assert.equal(bottomShelf.valid, true, bottomShelf.reason);
  // Against the right wall, facing left into the room.
  const side = validateFixtureLayout(turned("fixture_demo_01", rightColumn, 5, 1), options);
  assert.equal(side.valid, true, side.reason);
  // Facing right, into that same wall, it can't be used.
  assert.equal(validateFixtureLayout(turned("fixture_demo_01", rightColumn, 5, 3), options).valid, false);
  // Two shelves along the wall don't block each other.
  const lined = initialLayout().map((entry) => {
    if (entry.id === "register") return { ...entry, gx: 13, gy: 3 };
    if (entry.id === "fixture_demo_01") return { ...entry, gx: rightColumn, gy: 3, rotation: 1 };
    return entry;
  });
  lined.push({ id: "shelf_2", type: "shelf_budget_2x4", gx: rightColumn, gy: 5, rotation: 1 });
  const result = validateFixtureLayout(lined, options);
  assert.equal(result.valid, true, result.reason);
});

test("a turned register needs both its new front and back clear, and its line forms in front", () => {
  // Facing left: customers line up to its left; the cashier stands on its right.
  const layout = (gx) => STARTING_FIXTURES.map((entry) => entry.id === "register"
    ? { ...entry, gx, gy: 3.875, rotation: 1 } : entry);
  const result = validateFixtureLayout(layout(18), createRoom());
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.queueCells.length, 6);
  assert.deepEqual(result.queueCells[0], { gx: 17, gy: 4 });
  assert.ok(result.queueCells.every((cell) => cell.gx <= 17));
  // Against the right wall there's nowhere behind it for the cashier.
  const blocked = validateFixtureLayout(layout(19.125), createRoom());
  assert.equal(blocked.valid, false);
  assert.match(blocked.reason, /front and back/);
});

test("the register's cashier fits inside its rear projection in every facing", () => {
  const options = createRoom({ expanded: true });
  for (let rotation = 0; rotation < 4; rotation++) {
    const register = { id: "register", type: "register_basic", gx: 22, gy: 5, rotation };
    const result = validateFixtureLayout([register], options);
    assert.equal(result.valid, true, `${rotation}: ${result.reason}`);
    const spot = fixtureStandingSpot(register, fixtureAccessCells(register, true)[0]);
    const rear = fixtureFrontClearance(register, true);
    assert.ok(spot.x - 11 >= rear.left * TILE_SIZE && spot.x + 11 <= rear.right * TILE_SIZE);
    assert.ok(spot.y - 20 >= rear.top * TILE_SIZE && spot.y <= rear.bottom * TILE_SIZE);
  }
});

test("invalid rotations are rejected", () => {
  for (const rotation of [4, -1, 0.5, "1"]) {
    assert.equal(validateFixtureLayout(turned("fixture_demo_01", 16, 6, rotation), createRoom()).valid, false);
  }
});

test("fixtures can sit between floor squares in eighth-of-a-tile steps", () => {
  const between = { ...TEST_SHELF, gx: 16.5, gy: 4.25 };
  // Every square it covers by more than a sliver is blocked; its front is the next clear row.
  assert.deepEqual(fixtureCells(between).map(cellKey), ["16,4", "17,4", "18,4", "16,5", "17,5", "18,5"]);
  assert.deepEqual(fixtureAccessCells(between), [{ gx: 17, gy: 6 }]);
  // Shoppers stand in the middle of the clear strip in front, lined up with the shelf itself.
  assert.deepEqual(fixtureStandingSpot(between, { gx: 17, gy: 6 }),
    { x: (fixtureBounds(between).left + 0.5) * TILE_SIZE, y: 5.5 * TILE_SIZE });
  assert.deepEqual(fixtureStandingSpot(TEST_SHELF, { gx: 16, gy: 4 }),
    { x: (fixtureBounds(TEST_SHELF).left + 0.5) * TILE_SIZE, y: 4.25 * TILE_SIZE });
  // An eighth of a tile over a square leaves it walkable.
  assert.deepEqual(fixtureCells({ ...TEST_SHELF, gx: 15.875, gy: 5.125 }).map(cellKey), ["16,5", "17,5"]);

  const layout = initialLayout().map((entry) => entry.id === TEST_SHELF.id ? between : entry);
  const result = validateFixtureLayout(layout, createRoom({ expanded: true }));
  assert.equal(result.valid, true, result.reason);
  assert.deepEqual(result.access.get(TEST_SHELF.id), { gx: 17, gy: 6 });
  for (const gx of [16.1, Number.NaN]) {
    const bad = initialLayout().map((entry) => entry.id === TEST_SHELF.id ? { ...entry, gx } : entry);
    assert.equal(validateFixtureLayout(bad, createRoom()).valid, false);
  }
  // Fixtures may not overlap even by part of a square.
  const overlapping = [...layout, { id: "shelf_2", type: "shelf_budget_2x2", gx: 18.375, gy: 4.25 }];
  assert.match(validateFixtureLayout(overlapping, createRoom({ expanded: true })).reason, /cannot overlap/);
  const touching = [...layout, { id: "shelf_2", type: "shelf_budget_2x2", gx: 18.5, gy: 4.25 }];
  assert.equal(validateFixtureLayout(touching, createRoom({ expanded: true })).valid, true);
});

test("a shelf facing down can push back into the wall until its feet line up with every other shelf's", () => {
  const options = createRoom();
  const floorTop = getZone("sales_floor").gridY + 2;
  const gx = 17;
  assert.equal(options.isWall(gx, floorTop - 1), true);
  const at = (gy, rotation = 0) => validateFixtureLayout(
    initialLayout().map((entry) => entry.id === TEST_SHELF.id ? { ...entry, gx, gy, rotation } : entry),
    options,
  );
  const tucked = at(floorTop - 0.75);
  assert.equal(tucked.valid, true, tucked.reason);
  assert.equal(tucked.blockedCells.has(`${gx},${floorTop - 1}`), false, "the wall square isn't floor");
  assert.equal(tucked.blockedCells.has(`${gx},${floorTop}`), true);
  assert.match(at(floorTop - 0.875).reason, /Too far into the wall/);
  // Only a fixture's back goes against the wall.
  assert.equal(at(floorTop - 0.5, 1).valid, false);
});

test("every shelf type pushed against the top wall stops with its feet on the same line", () => {
  const options = createRoom();
  const floorTop = getZone("sales_floor").gridY + 2;
  for (const type of ["shelf_budget_2x2", "shelf_budget_2x3", "shelf_budget_2x4",
    "shelf_budget_3x2", "shelf_budget_3x3", "shelf_budget_3x4"]) {
    const at = (gy) => validateFixtureLayout(
      [...initialLayout().filter((entry) => entry.id !== TEST_SHELF.id), { id: "shelf", type, gx: 17, gy }],
      options,
    );
    const tucked = at(floorTop - 0.75);
    assert.equal(tucked.valid, true, `${type}: ${tucked.reason}`);
    assert.match(at(floorTop - 0.875).reason, /Too far into the wall/, type);
  }
});

test("all fixture types stay on the sales floor", () => {
  for (const [id, gx, gy] of [["register", 1, 102.125], ["fixture_demo_01", 1, 102.125]]) {
    const result = validateFixtureLayout(moved(id, gx, gy), createRoom());
    assert.equal(result.valid, false, `${id} at ${gx},${gy}`);
    assert.match(result.reason, /sales floor/);
  }
  const trashCanInBackroom = [
    { ...STARTING_FIXTURES.find((entry) => entry.type === "trash_can"), gx: 1, gy: 101.03125 },
    ...STARTING_FIXTURES.filter((entry) => entry.type !== "trash_can"),
  ];
  assert.equal(validateFixtureLayout(trashCanInBackroom, createRoom()).valid, false);
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
  assert.match(unlinked.reason, /cuts off part of the shop/);
});

test("a fixture cannot block the standing space beside the backroom doorway", () => {
  const { shop } = getBackroomLink();
  // The starting trashcan sits beside the doorway; a shelf just below it leaves a gap too
  // narrow for anyone's feet.
  const layout = [
    ...STARTING_FIXTURES.map((entry) => ({ ...entry })),
    { id: "fixture_demo_01", type: "shelf_budget_2x3", gx: shop.gx - 0.625, gy: shop.gy + 0.75 },
  ];
  const result = validateFixtureLayout(layout, createRoom());
  assert.equal(result.valid, false);
  assert.match(result.reason, /stand at fixtures/);
});
