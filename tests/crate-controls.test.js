import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { ControlMode } from "../js/logic/ControlMode.js";
import { Events, GAME_EVENTS } from "../js/core/Events.js";
import { InteractableRegistry } from "../js/logic/InteractableRegistry.js";
import { Crate, CRATE_STACK_SPACING, INTERACT_RANGE } from "../js/logic/Crate.js";
import { HOLD_KEY_MS, MAX_CARRIED_CRATES, isSquarelyInFront } from "../js/logic/CrateStack.js";
import { fixtureBounds, getFixtureType } from "../js/logic/FixtureLayout.js";
import { FixtureRegistry } from "../js/logic/FixtureRegistry.js";
import { PAD } from "../js/logic/GamepadInput.js";
import { TILE_SIZE } from "../js/logic/RoomLayout.js";

let server;
let cacheDirectory;
let GameScene;
let ShelfFixture;
let GameState;
let Messages;
const originalPhaser = globalThis.Phaser;

before(async () => {
  globalThis.Phaser = { Scene: class {} };
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-crate-controls-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    plugins: [{
      name: "crate-controls-test-database",
      enforce: "pre",
      resolveId(source) {
        if (source === "./boot.js" || source === "../scenes/boot.js") {
          return "\0crate-controls-test-database";
        }
      },
      load(id) {
        if (id === "\0crate-controls-test-database") {
          return 'export const database = { getItem: (id) => ({ id, name: "Test item", slots: id === "single" ? 1 : 2, boxSize: id === "single" ? 1 : 2, dimensions: { w: 2, h: 1 }, stackSize: 3 }), getAllItems: () => [{ id: "rifle", name: "Test rifle", boxSize: 1 }, { id: "pistol", name: "Test pistol", boxSize: 3 }] };';
        }
      },
    }],
  });
  ({ GameScene } = await server.ssrLoadModule("/js/scenes/game.js"));
  ({ ShelfFixture } = await server.ssrLoadModule("/js/logic/ShelfFixture.js"));
  ({ GameState } = await server.ssrLoadModule("/js/state/GameState.js"));
  ({ Messages } = await server.ssrLoadModule("/js/world/Messages.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
  if (originalPhaser === undefined) delete globalThis.Phaser;
  else globalThis.Phaser = originalPhaser;
});

function createHarness({ carrying = false } = {}) {
  const handlers = new Map();
  const removedCaptures = [];
  const scene = Object.create(GameScene.prototype);
  scene.startingShift = false;
  scene.loadFailed = false;
  scene.operatingRegister = false;
  scene.fixturePlacement = { active: false };
  scene.windowManager = { windows: new Map() };
  scene.eventBus = new Events();
  scene.interactables = new InteractableRegistry();
  scene.controlMode = new ControlMode(scene);
  // Facing right, so crates made by crate() below are in front of him.
  scene.player = {
    currentFacing: "right",
    sprite: { x: 100, y: 100, depth: 9999 },
  };
  // His feet hang just below his position, as in the game, and move with him.
  const playerSprite = scene.player.sprite;
  playerSprite.body = {
    velocity: { x: 160, y: 0 }, center: { x: 100, y: 100 },
    get left() { return playerSprite.x - 11; }, get right() { return playerSprite.x + 11; },
    get top() { return playerSprite.y - 10; }, get bottom() { return playerSprite.y + 10; },
  };
  scene.gameState = new GameState({ items: [] });
  scene.restockCrates = [];
  scene.floorStacks = new Map();
  scene.markedStackBase = null;
  scene.markedFromTop = 0;
  scene.cratePress = null;
  scene.crateMotionPaused = false;
  scene.time = { now: 0 };
  scene.fixtures = {
    shelves: () => [],
    register: () => null,
    registers: () => [],
    ofKind: () => [],
    displayName: () => "SHELF",
  };
  scene.carriedCrate = carrying ? {} : null;
  const classes = new Set(["hidden"]);
  scene.messages = new Messages(scene, {
    textContent: "",
    style: { setProperty(name, value) { this[name] = value; } },
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
  });
  const messages = [];
  scene.showGameMessage = (text) => messages.push(text);
  scene.input = { keyboard: {
    removeCapture(key) { removedCaptures.push(key); },
    on(name, handler) { handlers.set(name, handler); },
  } };
  scene.bindCrateKeys();
  GameScene.prototype.registerInteractableSources.call(scene);
  return { scene, messages, handlers, removedCaptures };
}

// A 40px crate on the floor `distance` px to the right of the player's middle (in front of
// him while he faces right).
function crate({ kind = "item", distance = 20, stationary = true, pushed = false, sliding = false, quantity } = {}) {
  const sprite = {
    x: 120 + distance, y: 100, depth: 2,
    body: { enable: true, get bottom() { return sprite.y + 20; } },
    getBounds() {
      return {
        left: this.x - 20, right: this.x + 20, top: this.y - 20, bottom: this.y + 20,
        centerX: this.x, centerY: this.y, width: 40, height: 40,
      };
    },
    setDepth(depth) { this.depth = depth; return this; },
  };
  return {
    kind,
    itemId: kind === "fixture" ? null : "item",
    typeId: kind === "fixture" ? "shelf_budget_3x4" : null,
    quantity: quantity ?? (kind === "fixture" ? 1 : 5),
    isPushed: pushed,
    isStationary: () => stationary,
    isSliding: () => sliding,
    canPickUp: Crate.prototype.canPickUp,
    // Plain test crates count as full, so they never pour into each other.
    getRemainingUnitsFor: () => 0,
    getFloorBounds: () => ({ left: sprite.x - 20, right: sprite.x + 20, top: sprite.y - 8, bottom: sprite.y + 10 }),
    pickUp() { return this.canPickUp(); },
    findDropPosition: () => ({ x: 100, y: 140 }),
    findThrowPosition: () => ({ x: 150, y: 100 }),
    startThrow(...args) { this.thrownWith = args; },
    drop(x, y, velocityX, velocityY, paused) {
      this.dropped = { x, y, velocityX, velocityY, paused };
      sprite.x = x;
      sprite.y = y;
    },
    followCarrier(carrier, index = 0, holdOffset = 22, spacing = 10) {
      this.following = { carrier, index, holdOffset, spacing };
    },
    destroy() { this.destroyed = true; },
    sprite,
  };
}

function keyEvent({ inUi = false, repeat = false } = {}) {
  return {
    repeat,
    target: { closest: (selector) => inUi && selector === "#ui-layer" ? {} : null },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
}

// A quick press and release of SPACE or Q.
function tap(h, key = "SPACE") {
  h.handlers.get(`keydown-${key}`)(keyEvent());
  h.handlers.get(`keyup-${key}`)(keyEvent());
}

// Holding SPACE or Q long enough to count as a hold, then letting go.
function hold(h, key = "SPACE") {
  h.handlers.get(`keydown-${key}`)(keyEvent());
  h.scene.time.now += HOLD_KEY_MS;
  h.scene.updateCratePress();
  h.handlers.get(`keyup-${key}`)(keyEvent());
}

// A floor stack: the bottom crate on the floor, the rest sitting on it.
function floorStack(scene, count, options) {
  const crates = Array.from({ length: count }, () => crate(options));
  scene.restockCrates.push(crates[0]);
  if (count > 1) scene.floorStacks.set(crates[0], crates.slice(1));
  return crates;
}

function carry(scene, crates) {
  scene.carriedCrates = [...crates];
  scene.carriedCrate = crates.at(-1) ?? null;
}

// A register beside the player; packing the Go-Backs is counted rather than run.
function addNearbyRegister(scene) {
  let packs = 0;
  const register = {
    sprite: { getBounds: () => ({ left: 80, right: 120, top: 80, bottom: 120, centerX: 100, centerY: 100 }) },
  };
  scene.fixtures.register = () => register;
  scene.fixtures.registers = () => [register];
  scene.packGoBacks = () => { packs += 1; return 0; };
  return () => packs;
}

// A carried or floor crate that holds real items (the same rules as Crate).
function itemCrate(itemId, quantity, options = {}) {
  return Object.assign(crate({ quantity, ...options }), {
    itemId: quantity > 0 ? itemId : null,
    getAvailableUnitsFor: Crate.prototype.getAvailableUnitsFor,
    getRemainingUnitsFor: Crate.prototype.getRemainingUnitsFor,
    add: Crate.prototype.add,
    remove: Crate.prototype.remove,
  });
}

test("with empty hands, E opens the fixture you face and holding Ctrl picks it up to move", () => {
  const h = createHarness();
  // The player faces right, so a shelf facing left looks back at him.
  const shelf = { id: "shelf_1", type: "shelf_budget_2x2", gx: 3, gy: 1, rotation: 1 };
  let opened = 0;
  const moved = [];
  h.scene.getNearbyBackroomDoor = () => null;
  h.scene.interactables = { findTarget: () => ({ kind: "fixture", target: shelf }) };
  h.scene.canRearrangeFixtures = () => true;
  h.scene.getFixtureMoveAreaBlockReason = () => null;
  h.scene.handleInteract = () => { opened += 1; };
  h.scene.fixturePlacement = { active: false, begin: (id) => moved.push(id) };

  // Releasing Ctrl before the hold fires moves nothing.
  h.scene.startFixtureMovePress();
  assert.equal(h.scene.fixtureMovePress.fixture, shelf);
  h.scene.fixtureMovePress = null;
  h.scene.updateFixtureMovePress();
  assert.deepEqual(moved, []);

  h.scene.startFixtureMovePress();
  h.scene.time.now += HOLD_KEY_MS;
  h.scene.updateFixtureMovePress();
  assert.deepEqual([opened, moved], [0, ["shelf_1"]]);

  // A shelf he isn't looking at (behind him) is never picked up.
  shelf.rotation = 3;
  h.scene.startFixtureMovePress();
  assert.equal(h.scene.fixtureMovePress, null);
  shelf.rotation = 1;

  // While the store is open, Ctrl never picks a fixture up.
  h.scene.canRearrangeFixtures = () => false;
  h.scene.startFixtureMovePress();
  assert.equal(h.scene.fixtureMovePress, null);
});

test("with empty hands, holding Ctrl at the register picks it up to move", () => {
  const h = createHarness();
  const register = { id: "register_1", type: "register", gx: 26, gy: 3, rotation: 0 };
  const moved = [];
  h.scene.getNearbyBackroomDoor = () => null;
  h.scene.interactables = { findTarget: () => ({ kind: "register", target: register }) };
  h.scene.canRearrangeFixtures = () => true;
  h.scene.getFixtureMoveAreaBlockReason = () => null;
  h.scene.fixturePlacement = { active: false, begin: (id) => moved.push(id) };

  h.scene.startFixtureMovePress();
  h.scene.time.now += HOLD_KEY_MS;
  h.scene.updateFixtureMovePress();
  assert.deepEqual(moved, ["register_1"]);

  // Not while working it.
  h.scene.operatingRegister = register;
  assert.equal(h.scene.getHoldToMoveFixture(), null);
});

test("with empty hands, holding Ctrl while facing the trashcan picks it up to move", () => {
  const h = createHarness();
  const trashcan = { id: "trash_can_01", type: "trash_can", gx: 18, gy: 2, rotation: 0 };
  h.scene.playerInBackroom = false;
  h.scene.getNearbyBackroomDoor = () => null;
  h.scene.interactables = { findTarget: () => null };
  h.scene.fixtures.ofKind = (kind) => kind === "trash" ? [trashcan] : [];
  h.scene.canRearrangeFixtures = () => true;
  h.scene.getFixtureMoveAreaBlockReason = () => null;
  Object.assign(h.scene.player.sprite, { x: 1168, y: 176 + 30 });
  h.scene.player.currentFacing = "up";
  assert.equal(h.scene.getHoldToMoveFixture(), trashcan);
  h.scene.updateCrateHint();
  assert.equal(h.scene.messages.element.textContent, "E: Create\nHold Ctrl: Move");

  const moved = [];
  h.scene.fixturePlacement.begin = (id) => moved.push(id);
  h.scene.startFixtureMovePress();
  h.scene.time.now += HOLD_KEY_MS;
  h.scene.updateFixtureMovePress();
  assert.deepEqual(moved, [trashcan.id]);

  h.scene.player.currentFacing = "down";
  assert.equal(h.scene.getHoldToMoveFixture(), null, "not while looking away from it");
  h.scene.updateCrateHint();
  assert.equal(h.scene.messages.element.textContent, "",
    "facing away from the trashcan, it offers nothing at all");
});

test("Space and Q wait to tell a tap from a hold, and Space leaves focused UI controls alone", () => {
  const h = createHarness();
  assert.deepEqual([...h.handlers.keys()].sort(),
    ["keydown-CTRL", "keydown-Q", "keydown-SPACE", "keyup-CTRL", "keyup-Q", "keyup-SPACE"]);
  assert.deepEqual(h.removedCaptures, ["SPACE"]);
  const [nearby] = floorStack(h.scene, 1);

  const inUi = keyEvent({ inUi: true });
  h.handlers.get("keydown-SPACE")(inUi);
  assert.equal(inUi.defaultPrevented, false);
  assert.equal(h.scene.cratePress, null);

  const press = keyEvent();
  h.handlers.get("keydown-SPACE")(press);
  assert.equal(press.defaultPrevented, true);
  assert.equal(h.scene.carriedCrate, null, "nothing happens until the key is released or held");
  h.handlers.get("keydown-SPACE")(keyEvent({ repeat: true }));
  h.handlers.get("keyup-SPACE")(keyEvent());
  assert.equal(h.scene.carriedCrate, nearby);
  assert.equal(h.scene.cratePress, null);
  assert.deepEqual(h.messages, []);
});

test("tapping Space picks up the marked crate; holding takes it and every crate above it", () => {
  const h = createHarness();
  const pickedUp = [];
  h.scene.eventBus.on(GAME_EVENTS.CRATE_PICKED_UP, (event) => pickedUp.push(event));
  const [bottom, middle, top] = floorStack(h.scene, 3);

  tap(h);
  assert.deepEqual(h.scene.getCarriedCrates(), [top]);
  assert.deepEqual(h.scene.floorStacks.get(bottom), [middle]);
  assert.deepEqual(h.scene.player.sprite.body.velocity, { x: 160, y: 0 }, "picking up never stops the player");

  h.handlers.get("keydown-Q")(keyEvent());
  h.handlers.get("keyup-Q")(keyEvent());
  assert.deepEqual(h.scene.floorStacks.get(bottom), [middle, top]);
  // Ctrl moves the arrow down to the middle crate; holding Space takes it and the top one.
  h.handlers.get("keydown-CTRL")(keyEvent());
  assert.equal(h.scene.markedFloorStack().marked, middle);
  hold(h);
  assert.deepEqual(h.scene.getCarriedCrates(), [middle, top]);
  assert.equal(h.scene.carriedCrate, top);
  assert.equal(h.scene.floorStacks.has(bottom), false);
  assert.deepEqual(h.scene.restockCrates, [bottom]);
  assert.equal(pickedUp.length, 3);
  assert.deepEqual(pickedUp[0], { kind: "item", itemId: "item", typeId: null, quantity: 5 });
});

test("Ctrl loops the arrow back to the top, and taking the bottom crate lets the next one settle in its place", () => {
  const h = createHarness();
  const [bottom, middle, top] = floorStack(h.scene, 3);
  h.scene.markNextCrateDown();
  h.scene.markNextCrateDown();
  assert.equal(h.scene.markedFloorStack().marked, bottom);
  h.scene.markNextCrateDown();
  assert.equal(h.scene.markedFloorStack().marked, top);
  h.scene.markNextCrateDown();
  h.scene.markNextCrateDown();

  tap(h);
  assert.deepEqual(h.scene.getCarriedCrates(), [bottom]);
  assert.deepEqual(h.scene.restockCrates, [middle]);
  assert.deepEqual(h.scene.floorStacks.get(middle), [top]);
  assert.deepEqual(middle.dropped, { x: 140, y: 100, velocityX: 0, velocityY: 0, paused: false });
});

test("Space won't pick up past three crates and says how many you're holding", () => {
  const h = createHarness();
  carry(h.scene, [crate(), crate()]);
  const [bottom, top] = floorStack(h.scene, 2);

  h.scene.markNextCrateDown();
  hold(h);
  assert.equal(h.scene.getCarriedCrates().length, 2);
  assert.equal(h.messages.at(-1),
    "You can only carry 3 crates. You're holding 2, so you can't pick up 2 more.");
  h.scene.markNextCrateDown();
  tap(h);
  assert.equal(h.scene.carriedCrate, top);
  tap(h);
  assert.equal(h.messages.at(-1),
    "You can only carry 3 crates. You're holding 3, so you can't pick up another one.");
  assert.deepEqual(h.scene.restockCrates, [bottom]);
});

test("picking up a crate of the item you hold pours as much as fits into yours and leaves the floor crate", () => {
  const h = createHarness();
  const limit = itemCrate("wpn_pis_01", 0).getRemainingUnitsFor("wpn_pis_01");
  const held = itemCrate("wpn_pis_01", limit - 3);
  carry(h.scene, [held]);
  const floor = itemCrate("wpn_pis_01", 2);
  h.scene.restockCrates.push(floor);

  h.scene.updateCrateHint();
  assert.match(h.scene.messages.hint, /Space: Move all 2 .* from this crate into yours/);
  tap(h);
  assert.equal(held.quantity, limit - 1);
  assert.equal(floor.quantity, 0);
  assert.deepEqual(h.scene.getCarriedCrates(), [held], "the empty crate stays on the floor");
  assert.deepEqual(h.scene.restockCrates, [floor]);

  floor.add("wpn_pis_01", 5);
  h.scene.updateCrateHint();
  assert.match(h.scene.messages.hint, /Move 1 of the 5 .* \(that's all that fits\)/);
  tap(h);
  assert.equal(held.quantity, limit);
  assert.equal(floor.quantity, 4);
  assert.match(h.messages.at(-1), /4 didn't fit and stay in the crate on the floor/);

  // Your crate is full, so the next tap picks the floor crate up as usual.
  tap(h);
  assert.deepEqual(h.scene.getCarriedCrates(), [held, floor]);
});

test("tapping Q puts the top crate down and holding Q sets the whole stack down as one floor stack", () => {
  const h = createHarness();
  h.scene.player.currentFacing = "left";
  const dropped = [];
  h.scene.eventBus.on(GAME_EVENTS.CRATE_DROPPED, (event) => dropped.push(event));
  const [lower, middle, upper] = [crate(), crate(), crate()];
  carry(h.scene, [lower, middle, upper]);
  upper.findThrowPosition = () => { throw new Error("Q never throws"); };
  upper.findDropPosition = (x, y, carrier, _reserved, _radius, facing) => {
    assert.deepEqual({ x, y, carrier, facing }, { x: 100, y: 100, carrier: h.scene.player.sprite, facing: "left" });
    return { x: 52, y: 100 };
  };

  tap(h, "Q");
  assert.deepEqual(upper.dropped, { x: 52, y: 100, velocityX: 0, velocityY: 0, paused: false });
  assert.deepEqual(h.scene.getCarriedCrates(), [lower, middle]);
  assert.deepEqual(h.scene.restockCrates, [upper]);

  h.scene.restockCrates = [];
  hold(h, "Q");
  assert.deepEqual(h.scene.getCarriedCrates(), []);
  assert.equal(h.scene.carriedCrate, null);
  assert.deepEqual(h.scene.restockCrates, [lower]);
  assert.deepEqual(h.scene.floorStacks.get(lower), [middle]);
  assert.deepEqual(dropped.map(({ thrown }) => thrown), [false, false, false]);
  assert.deepEqual(h.messages, [], "normal drops show no banner");
});

test("crates stay in your hands when there's no room to set them down", () => {
  const h = createHarness();
  const [lower, upper] = [crate(), crate()];
  lower.findDropPosition = () => null;
  upper.findDropPosition = () => null;
  carry(h.scene, [lower, upper]);
  hold(h, "Q");
  tap(h, "Q");
  assert.deepEqual(h.scene.getCarriedCrates(), [lower, upper]);
  assert.deepEqual(h.scene.restockCrates, []);
  assert.deepEqual(h.messages, ["No room to set the stack down", "No room to drop crate"]);
});

test("Q stacks onto the marked floor crate: a tap adds one, a hold adds as many as fit", () => {
  const h = createHarness();
  const [base] = floorStack(h.scene, 1);
  const carried = [crate(), crate(), crate()];
  carry(h.scene, carried);

  tap(h, "Q");
  assert.deepEqual(h.scene.floorStacks.get(base), [carried[2]]);
  assert.deepEqual(h.scene.getCarriedCrates(), carried.slice(0, 2));
  hold(h, "Q");
  assert.deepEqual(h.scene.floorStacks.get(base), [carried[2], carried[1]]);
  assert.deepEqual(h.scene.getCarriedCrates(), [carried[0]], "the rest stay in your hands");

  for (const press of [tap, hold]) {
    press(h, "Q");
    assert.equal(h.messages.at(-1), "You can't stack any higher. Stacks can only be 3 crates high.");
  }
  assert.deepEqual(h.scene.getCarriedCrates(), [carried[0]]);
});

test("nothing stacks on a fixture crate or a Loading Pad crate, and a fixture crate never stacks", () => {
  const h = createHarness();
  const [fixtureBase] = floorStack(h.scene, 1, { kind: "fixture" });
  const held = crate();
  carry(h.scene, [held]);
  tap(h, "Q");
  assert.equal(h.messages.at(-1), "Crates can't be stacked on a fixture crate");
  assert.equal(h.scene.carriedCrate, held);

  h.scene.restockCrates = [];
  const [padCrate] = floorStack(h.scene, 1);
  padCrate.lockedToPad = true;
  hold(h, "Q");
  assert.equal(h.messages.at(-1), "Crates can't be stacked on the Loading Pad");
  assert.equal(h.scene.carriedCrate, held);

  h.scene.restockCrates = [fixtureBase];
  tap(h);
  assert.equal(h.messages.at(-1), "Put your crates down before picking up a fixture crate");

  const fixture = crate({ kind: "fixture" });
  carry(h.scene, [fixture]);
  h.scene.restockCrates = [crate()];
  tap(h);
  assert.equal(h.messages.at(-1), "Put the fixture crate down before picking up another crate");
  tap(h, "Q");
  assert.equal(h.scene.carriedCrate, null);
  assert.equal(h.scene.floorStacks.size, 0, "the fixture crate goes on the floor, not on the stack");
  assert.ok(fixture.dropped);
});

test("Space throws your only crate while walking with no arrow showing, and explains when standing still", () => {
  const h = createHarness();
  const [lower, upper] = [crate(), crate()];
  carry(h.scene, [lower, upper]);
  h.scene.player.sprite.body.velocity = { x: 160, y: 0 };
  tap(h);
  assert.deepEqual(h.scene.getCarriedCrates(), [lower, upper], "two crates can't be thrown");
  assert.equal(h.messages.at(-1), "You can only throw a crate when you're holding just one.");
  carry(h.scene, [upper]);
  const velocity = { x: 160 / Math.sqrt(2), y: -160 / Math.sqrt(2) };
  h.scene.player.sprite.body.velocity = velocity;
  upper.drop = () => { throw new Error("Throws must not teleport to the clearance position"); };

  h.handlers.get("keydown-SPACE")(keyEvent());
  assert.deepEqual(upper.thrownWith, [h.scene.player.sprite, velocity.x, velocity.y], "throws on the press itself");
  assert.equal(h.scene.player.sprite.body.velocity, velocity);
  upper.isStationary = () => false; // still flying, so the arrow can't mark it
  h.handlers.get("keyup-SPACE")(keyEvent());
  assert.deepEqual(h.scene.getCarriedCrates(), []);
  h.scene.restockCrates = h.scene.restockCrates.filter((c) => c !== upper);
  carry(h.scene, [lower]);

  h.scene.player.sprite.body.velocity = { x: 0, y: 0 };
  tap(h);
  assert.deepEqual(h.scene.getCarriedCrates(), [lower]);
  assert.equal(h.messages.at(-1), "To throw a crate, walk and press Space.");

  h.scene.player.sprite.body.velocity = { x: 160, y: 0 };
  lower.findThrowPosition = () => null;
  tap(h);
  assert.equal(h.scene.carriedCrate, lower);
  assert.equal(h.messages.at(-1), "No room to throw crate");
});

test("the arrow only marks crates in front of the player", () => {
  const h = createHarness();
  const behind = crate();
  behind.sprite.x = 50; // to his left
  h.scene.restockCrates = [behind];
  assert.equal(h.scene.markedFloorStack(), null);
  tap(h);
  assert.equal(h.messages.at(-1), "No crate nearby");
  h.scene.player.currentFacing = "left";
  assert.equal(h.scene.markedFloorStack().marked, behind);
  h.scene.restockCrates = [crate({ distance: INTERACT_RANGE + 1 })];
  h.scene.player.currentFacing = "right";
  assert.equal(h.scene.markedFloorStack(), null, "out of reach");
  // Close enough, but off to the side: less than half his feet line up with it.
  const offside = crate();
  offside.sprite.y = 109;
  h.scene.restockCrates = [offside];
  assert.equal(h.scene.markedFloorStack(), null, "not squarely in front");
  offside.sprite.y = 108;
  assert.equal(h.scene.markedFloorStack().marked, offside, "half his feet line up");
});

test("the stack arrow stops at 32 pixels from the crate edge so distant stacks don't steal Q", () => {
  const h = createHarness();
  const [base] = floorStack(h.scene, 1, { distance: 32 });
  assert.equal(h.scene.markedFloorStack().base, base, "a stack exactly in reach is marked");
  base.sprite.x += 1;
  assert.equal(h.scene.markedFloorStack(), null, "one pixel farther is out of reach");
  const held = crate();
  carry(h.scene, [held]);
  tap(h, "Q");
  assert.ok(held.dropped, "Q sets the carried crate on the floor");
  assert.equal(h.scene.floorStacks.has(base), false, "Q does not add it to the distant stack");
});

test("Space says to wait for a moving crate, and nothing happens during menus or loading", () => {
  const h = createHarness();
  h.scene.restockCrates = [crate({ stationary: false })];
  tap(h);
  assert.equal(h.scene.carriedCrate, null);
  assert.deepEqual(h.messages, ["Wait for crate to stop"]);

  for (const state of ["placement", "startingShift", "loadFailed", "menu"]) {
    const blocked = createHarness();
    floorStack(blocked.scene, 1);
    if (state === "placement") blocked.scene.fixturePlacement.active = true;
    else if (state === "menu") blocked.scene.windowManager.windows.set("tablet", { id: "tablet", isOpen: true });
    else blocked.scene[state] = true;
    tap(blocked);
    hold(blocked);
    assert.equal(blocked.scene.carriedCrate, null, state);
    assert.deepEqual(blocked.messages, [], state);
  }
});

test("Q never packs the Go-Backs by hand; at the register it only explains why crates stay put", () => {
  const h = createHarness();
  const goBacksPacks = addNearbyRegister(h.scene);
  tap(h, "Q");
  assert.equal(goBacksPacks(), 0);

  carry(h.scene, [crate()]);
  h.scene.player.sprite.body.velocity = { x: 0, y: 0 };
  tap(h, "Q");
  assert.equal(h.scene.carriedCrate, null, "with crates in hand Q puts one down");

  h.scene.operatingRegister = true;
  tap(h, "Q");
  carry(h.scene, [crate()]);
  tap(h, "Q");
  tap(h);
  assert.deepEqual(h.messages.slice(-2),
    ["Leave the register to put down a crate", "Leave the register to pick up a crate"]);
  assert.equal(goBacksPacks(), 0);
});

test("paused controller ignores register, tablet and menu controls; Start resumes", () => {
  const { scene } = createHarness();
  scene.shiftClock = {
    started: true, isPaused: true,
    togglePause() { this.isPaused = !this.isPaused; },
  };
  scene.operatingRegister = true;
  scene.padInput = { poll() {}, hadInput: false, justPressed: () => true };
  let hudClosed = false;
  scene.uiNavigator = {
    handle() { assert.fail("Paused controller must not navigate menus"); },
    setHudOpen(open) { hudClosed = !open; },
  };
  scene.padInput.justPressed = (button) => button !== PAD.START;
  scene.handleGamepad(0, 16);
  assert.equal(scene.operatingRegister, true);
  assert.equal(scene.shiftClock.isPaused, true);
  scene.padInput.justPressed = () => true;
  scene.handleGamepad(0, 16);
  assert.equal(scene.shiftClock.isPaused, false);
  assert.equal(scene.operatingRegister, true);
  assert.equal(hudClosed, true);
});

test("controller X and Y tell a tap from a hold the same way, and R3 moves the arrow down", () => {
  const h = createHarness();
  const goBacksPacks = addNearbyRegister(h.scene);
  const down = new Set();
  let pressed = new Set();
  h.scene.padInput = {
    poll() {}, hadInput: false,
    justPressed: (button) => pressed.has(button),
    isDown: (button) => down.has(button),
  };
  h.scene.checkoutWindow = { usesChitInput: () => false, usesSpaceKey: () => false };
  h.scene.uiNavigator = { handle: () => false };
  const press = (button) => {
    pressed = new Set([button]);
    down.add(button);
    h.scene.handleGamepad(0, 16);
    pressed = new Set();
  };
  const release = (button) => {
    down.delete(button);
    h.scene.updateCratePress();
  };

  press(PAD.Y);
  release(PAD.Y);
  assert.equal(goBacksPacks(), 0, "Y with empty hands does nothing");

  const [bottom, middle, top] = floorStack(h.scene, 3);
  press(PAD.R3);
  assert.equal(h.scene.markedFloorStack().marked, middle);
  press(PAD.X);
  h.scene.time.now += HOLD_KEY_MS;
  h.scene.updateCratePress();
  release(PAD.X);
  assert.deepEqual(h.scene.getCarriedCrates(), [middle, top]);

  press(PAD.Y);
  release(PAD.Y);
  assert.deepEqual(h.scene.floorStacks.get(bottom), [top]);
  assert.deepEqual(h.scene.getCarriedCrates(), [middle]);
});

test("E returns every held empty crate, preserving filled crates; Q only puts crates down", () => {
  const h = createHarness();
  const full = crate();
  const empties = [crate({ quantity: 0 }), crate({ quantity: 0 })];
  carry(h.scene, [empties[0], full, empties[1]]);
  h.scene.isNearTrashcan = () => true;
  h.scene.handleInteract();
  assert.ok(empties.every((entry) => entry.destroyed));
  assert.deepEqual(h.scene.getCarriedCrates(), [full]);
  assert.equal(h.messages.at(-1), "2 empty crates put in the trashcan.");

  h.scene.handleInteract();
  assert.deepEqual(h.scene.getCarriedCrates(), [full]);
  assert.equal(h.messages.at(-1), "Only empty crates go in the trashcan.");
  const empty = crate({ quantity: 0 });
  carry(h.scene, [full, empty]);
  tap(h, "Q");
  assert.ok(empty.dropped);
  assert.notEqual(empty.destroyed, true);
  assert.deepEqual(h.scene.getCarriedCrates(), [full]);
  tap(h, "Q");
  assert.equal(h.scene.carriedCrate, null, "a stocked crate is still put down normally beside the trashcan");
  assert.ok(full.dropped);
});

test("a sales-floor trashcan takes back empty crates only while faced from close by", () => {
  const h = createHarness();
  const trashcan = { id: "trash_can_01", type: "trash_can", gx: 18, gy: 2, rotation: 0 };
  h.scene.playerInBackroom = false;
  h.scene.fixtures.ofKind = (kind) => kind === "trash" ? [trashcan] : [];
  // The trashcan covers x 1152-1184 and y 128-176; stand just below it, facing it.
  Object.assign(h.scene.player.sprite, { x: 1168, y: 176 + 30 });
  h.scene.player.currentFacing = "up";
  assert.equal(h.scene.isNearTrashcan(), true);
  carry(h.scene, [crate({ quantity: 0 }), crate({ quantity: 0 })]);
  h.scene.handleInteract();
  assert.deepEqual(h.scene.getCarriedCrates(), []);
  assert.equal(h.messages.at(-1), "2 empty crates put in the trashcan.");

  h.scene.player.currentFacing = "right";
  assert.equal(h.scene.isNearTrashcan(), false, "beside it but facing something else");
  h.scene.player.currentFacing = "up";
  h.scene.player.sprite.y = 176 + 60;
  assert.equal(h.scene.isNearTrashcan(), false, "too far from the trashcan");
  h.scene.player.sprite.y = 176 + 30;
  h.scene.playerInBackroom = true;
  assert.equal(h.scene.isNearTrashcan(), false, "the trashcan isn't reachable from the backroom");
});

test("the former backroom empty-crate square no longer takes or supplies crates", () => {
  const h = createHarness();
  h.scene.playerInBackroom = true;
  Object.assign(h.scene.player.sprite, { x: 174, y: 6608 });
  h.scene.getNearbyBackroomDoor = () => null;
  h.scene.createItemCrate = () => { throw new Error("the backroom must not supply a crate"); };

  h.scene.handleInteract();
  assert.equal(h.scene.getCarriedCrates().length, 0);
  const empty = crate({ quantity: 0 });
  carry(h.scene, [empty]);
  h.scene.handleInteract();
  assert.equal(empty.destroyed, undefined);
  assert.deepEqual(h.scene.getCarriedCrates(), [empty]);
});

test("E supplies one free empty crate only with empty hands", () => {
  const h = createHarness();
  const created = [];
  h.scene.carriedCrates = [];
  h.scene.createItemCrate = (itemId, quantity, x, y) => {
    assert.equal(itemId, null);
    assert.equal(quantity, 0);
    const crate = {
      kind: "item", itemId, quantity, x, y,
      pickUp(carrier) { this.pickedUpBy = carrier; return true; },
      followCarrier() {},
    };
    created.push(crate);
    return crate;
  };

  h.scene.isNearTrashcan = () => true;
  h.scene.handleInteract();
  assert.equal(h.scene.getCarriedCrates().length, 1);
  assert.ok(created.every((crate) => crate.pickedUpBy === h.scene.player.sprite));
  assert.equal(h.scene.takeEmptyCrateFromTrashcan(), false);
  assert.equal(created.length, 1);
  assert.match(h.messages.at(-1), /put your crates down/i);
  const placing = [];
  h.scene.fixturePlacement = { beginFromCrate: (crate) => placing.push(crate) };
  const fixtureCrate = crate({ kind: "fixture" });
  carry(h.scene, [fixtureCrate]);
  h.scene.handleInteract();
  assert.equal(created.length, 1, "a fixture crate is not empty hands");
  assert.deepEqual(placing, [fixtureCrate], "E still places a fixture beside the trashcan");
});

test("the context lines say what each crate button does right now", () => {
  const h = createHarness();
  const element = h.scene.messages.element;
  const [bottom] = floorStack(h.scene, 2);
  h.scene.updateCrateHint();
  assert.equal(element.textContent, [
    "Tap Space: Pick up a crate of 5 Test item",
    "Ctrl: Move the arrow one crate down",
  ].join("\n"), "the arrow starts on the top crate, so a hold would take the same one crate");
  h.scene.markNextCrateDown();
  h.scene.updateCrateHint();
  assert.equal(element.textContent, [
    "Tap Space: Pick up a crate of 5 Test item",
    "Hold Space: Pick up 2 crates (this one and the ones above it)",
    "Ctrl: Move the arrow one crate down",
  ].join("\n"));
  assert.equal(element.classList.contains("context-message"), true);
  assert.equal(element.classList.contains("hidden"), false);

  carry(h.scene, [crate(), crate({ quantity: 0 })]);
  h.scene.updateCrateHint();
  assert.equal(element.textContent, [
    "Tap Space: Pick up a crate of 5 Test item",
    "Tap Q: Set your top crate on this stack",
    "Hold Q: Set as many of your crates on this stack as fit",
    "Ctrl: Move the arrow one crate down",
  ].join("\n"), "the hold line disappears when the 2-crate stack won't fit in your hands");

  h.scene.floorStacks.get(bottom).push(crate());
  carry(h.scene, [crate(), crate(), crate()]);
  h.scene.updateCrateHint();
  assert.equal(element.textContent, [
    "Your hands are full (3 crates max)",
    "You can't stack any higher. Stacks can only be 3 crates high.",
    "Ctrl: Move the arrow one crate down",
  ].join("\n"));

  h.scene.restockCrates = [];
  h.scene.floorStacks.clear();
  h.scene.updateCrateHint();
  assert.equal(element.textContent, [
    "Tap Q: Put your top crate down",
    "Hold Q: Set all 3 crates down as a stack",
  ].join("\n"), "walking with more than one crate never offers a throw");

  h.scene.player.sprite.body.velocity = { x: 0, y: 0 };
  h.scene.updateCrateHint();
  assert.equal(element.textContent, [
    "Tap Q: Put your top crate down",
    "Hold Q: Set all 3 crates down as a stack",
  ].join("\n"), "standing still never promises a throw, which needs the player mid-stride");
  h.scene.player.sprite.body.velocity = { x: 160, y: 0 };

  carry(h.scene, [crate({ kind: "fixture" })]);
  h.scene.updateCrateHint();
  assert.equal(element.textContent, [
    "Space: Throw your crate",
    "Tap Q: Put your top crate down",
    "E: Place the fixture",
  ].join("\n"));
});

for (const state of ["nothingNearby", "moving", "placement", "startingShift", "loadFailed", "menu"]) {
  test(`crate hint is hidden during ${state}`, () => {
    const h = createHarness();
    h.scene.restockCrates = [crate()];
    h.scene.messages.element.classList.remove("hidden");
    if (state === "nothingNearby") h.scene.restockCrates = [crate({ distance: 57 })];
    else if (state === "moving") h.scene.restockCrates = [crate({ stationary: false })];
    else if (state === "placement") h.scene.fixturePlacement.active = true;
    else if (state === "menu") h.scene.windowManager.windows.set("inventory", { id: "inventory", isOpen: true });
    else h.scene[state] = true;
    h.scene.updateCrateHint();
    assert.equal(h.scene.messages.element.classList.contains("hidden"), true);
  });
}

test("behind the counter the hint always offers the way out", () => {
  const h = createHarness();
  h.scene.restockCrates = [crate()];
  h.scene.operatingRegister = true;
  h.scene.updateCrateHint();
  const element = h.scene.messages.element;
  assert.equal(element.textContent, "E: Leave the register");
  assert.equal(element.classList.contains("hidden"), false);
});

test("warnings take priority over crate hints and restore the current hint after expiring", (t) => {
  const timers = [];
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    timers.push({ callback, delay });
    return timers.length;
  });
  t.mock.method(globalThis, "clearTimeout", () => {});
  const h = createHarness();
  const target = crate();
  h.scene.restockCrates = [target];
  h.scene.updateCrateHint();
  const element = h.scene.messages.element;
  h.scene.messages.show("Not enough credits.");
  assert.equal(element.classList.contains("context-message"), false);
  target.quantity = 3;
  h.scene.updateCrateHint();
  assert.equal(element.textContent, "Not enough credits.");
  assert.equal(timers[0].delay, 2250);
  timers[0].callback();
  assert.equal(element.classList.contains("fading"), true);
  assert.equal(timers[1].delay, 250);
  timers[1].callback();
  assert.equal(element.textContent, "Tap Space: Pick up a crate of 3 Test item");
  assert.equal(element.classList.contains("context-message"), true);
  assert.equal(element.classList.contains("fading"), false);
  assert.equal(element.classList.contains("hidden"), false);

  h.scene.messages.show("Another warning");
  h.scene.restockCrates = [];
  h.scene.updateCrateHint();
  assert.equal(element.textContent, "Another warning");
  timers[2].callback();
  timers[3].callback();
  assert.equal(element.classList.contains("hidden"), true);
});

test("the green arrow and the bottom bar follow the marked crate; holding cards list carried crates top first", () => {
  const h = createHarness();
  const marker = {
    setVisible(visible) { this.visible = visible; return this; },
    setAngle(angle) { this.angle = angle; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
  };
  const renders = [];
  h.scene.pickupMarker = marker;
  h.scene.crateFooter = { render: (view) => renders.push(view) };

  h.scene.updateCrateMarker();
  assert.equal(marker.visible, false);
  assert.deepEqual(renders.at(-1), { marked: null, carried: [] });

  const [, top] = floorStack(h.scene, 2);
  carry(h.scene, [crate({ quantity: 0 }), crate({ kind: "fixture" })]);
  h.scene.updateCrateMarker();
  assert.deepEqual([marker.visible, marker.angle, marker.x, marker.y], [true, 0, top.sprite.x, top.sprite.y - 27]);
  assert.deepEqual(renders.at(-1), {
    marked: { name: "Test item", count: "x5", image: null },
    carried: [
      { name: `${getFixtureType("shelf_budget_3x4").name} fixture`, count: "", image: null },
      { name: "Empty crate", count: "", image: null },
    ],
  });

  h.scene.markNextCrateDown();
  h.scene.updateCrateMarker();
  assert.equal(marker.angle, -90, "lower crates in a stack are pointed at from the side");

  h.scene.windowManager.windows.set("inventory", { id: "inventory", isOpen: true });
  h.scene.updateCrateMarker();
  assert.equal(marker.visible, false);
  assert.equal(renders.at(-1).marked, null);

  h.scene.shelfStockingWindow = { getStockingCrate: () => null, getHoveredShelf: () => ({ itemId: "test_item", quantity: 3 }) };
  h.scene.updateCrateMarker();
  assert.deepEqual(renders.at(-1).marked, { label: "SHELF", name: "Test item", count: "x3", image: null },
    "the shelf space under the mouse shows in the bar");
  h.scene.shelfStockingWindow = { getStockingCrate: () => null, getHoveredShelf: () => ({ empty: true }) };
  h.scene.updateCrateMarker();
  assert.equal(renders.at(-1).marked.name, "Empty shelf space");
  h.scene.shelfStockingWindow = { getStockingCrate: () => null, getHoveredShelf: () => ({ itemId: "test_item", quantity: 0 }) };
  h.scene.updateCrateMarker();
  assert.deepEqual([renders.at(-1).marked.name, renders.at(-1).marked.count], ["Test item", "SOLD OUT"]);

  const chosen = h.scene.getCarriedCrates()[0];
  h.scene.shelfStockingWindow = { getStockingCrate: () => chosen, getHoveredShelf: () => null };
  h.scene.updateCrateMarker();
  assert.deepEqual(renders.at(-1).carried.map((card) => card.stockingNext ?? false), [false, true],
    "the crate that stocks next is marked in the holding cards");
});

test("stacked crates sit tight on their base, and floor crates cover anyone who walks behind them", () => {
  const h = createHarness();
  const [base, ...above] = floorStack(h.scene, 3);
  h.scene.syncFloorStacks();
  assert.deepEqual(above.map((stacked) => stacked.following),
    [0, 1].map((index) => ({ carrier: base.sprite, index, holdOffset: 10, spacing: 10 })));
  assert.equal(base.sprite.depth, 9999 + 1 + MAX_CARRIED_CRATES, "his feet are above the crate's bottom edge");

  h.scene.player.sprite.y = 120;
  h.scene.syncFloorStacks();
  const bottom = base.sprite.body.bottom;
  assert.equal(base.sprite.depth, 2000 + bottom - 0.5, "sorted by its base like a person");
  assert.ok(above.every((stacked, index) => stacked.sprite.depth === base.sprite.depth + 0.01 * (index + 1)));
  // A customer in line whose feet are just behind the stack's bottom edge is drawn behind the
  // whole stack; one a pixel in front is drawn over it.
  const top = above.at(-1).sprite.depth;
  assert.ok(2000 + bottom - 1 < base.sprite.depth);
  assert.ok(2000 + bottom > top);
});

test("behind the register the counter is lifted over the player, not the player sunk under the crates", () => {
  const h = createHarness();
  const register = { id: "r", sprite: { depth: 2, setDepth(depth) { this.depth = depth; return this; } } };
  h.scene.customers = [];
  h.scene.employees = [];
  h.scene.player.sprite.active = true;
  h.scene.player.sprite.setDepth = function (depth) { this.depth = depth; return this; };
  h.scene.operatingRegisterFixture = register;
  h.scene.registerDepthBeforeTuck = 2;
  const [base, ...above] = floorStack(h.scene, 3);
  h.scene.player.sprite.y = 120; // his feet are below the stack's bottom edge: it's beside/behind him
  h.scene.sortPeopleByFeet();
  h.scene.syncFloorStacks();
  const player = h.scene.player.sprite.depth;
  assert.ok(register.sprite.depth > player, "the counter hides his legs");
  for (const stacked of [base, ...above]) {
    assert.ok(stacked.sprite.depth < player, "no crate beside him covers his head");
  }
});

test("a floor stack is as heavy as its height, and you never move more than 4 crates in total", () => {
  const h = createHarness();
  const body = {
    x: 77, y: 210, width: 22, height: 20, velocity: { x: 160, y: 0 },
    setVelocity(x, y) { this.velocity = { x, y }; },
  };
  h.scene.player.sprite.body = body;
  h.scene.isCrateSpaceBlocked = () => false;
  const push = () => {
    body.velocity = { x: 160, y: 0 };
    h.scene.updateCratePushing(16);
    return body.velocity.x;
  };
  const makeBase = () => {
    const base = crate();
    base.sprite.body = { x: 100, y: 200, width: 40, height: 40 };
    base.push = (velocity) => { base.pushedVelocity = velocity; };
    base.stopPush = () => {};
    return base;
  };
  const single = makeBase();
  h.scene.restockCrates = [single];
  const singleSpeed = push();
  const tall = makeBase();
  h.scene.restockCrates = [tall];
  h.scene.floorStacks.set(tall, [crate(), crate()]);
  const tallSpeed = push();
  assert.ok(tallSpeed > 0 && tallSpeed < singleSpeed, `${tallSpeed} < ${singleSpeed}`);

  carry(h.scene, [crate()]);
  assert.ok(push() > 0, "holding 1 and pushing a stack of 3 is 4 crates");
  carry(h.scene, [crate(), crate()]);
  assert.equal(push(), 0, "holding 2 and pushing a stack of 3 is too many");
  h.scene.floorStacks.set(tall, [crate()]);
  assert.ok(push() > 0, "a two-high stack still moves while carrying two");
});

test("carrying a crate still blocks overlapping pad crates and pushes loose crates", () => {
  const { scene } = createHarness({ carrying: true });
  const body = {
    x: 89, y: 210, width: 22, height: 20, velocity: { x: 160, y: 0 },
    setVelocity(x, y) { this.velocity = { x, y }; },
  };
  const groundCrate = {
    lockedToPad: true,
    isPushed: false,
    isStationary: () => true,
    isSliding: () => false,
    sprite: { body: { x: 100, y: 200, width: 40, height: 40 } },
    push(velocity) { this.pushedVelocity = velocity; },
  };
  scene.player.sprite.body = body;
  scene.restockCrates = [groundCrate];
  scene.isCrateSpaceBlocked = () => false;

  scene.updateCratePushing(16);
  assert.deepEqual(body.velocity, { x: 0, y: 0 });
  assert.equal(groundCrate.pushedVelocity, undefined);
  body.velocity = { x: -160, y: 0 };
  scene.updateCratePushing(16);
  assert.deepEqual(body.velocity, { x: -160, y: 0 });

  body.x = 77;
  body.velocity = { x: 160, y: 0 };
  groundCrate.lockedToPad = false;
  scene.updateCratePushing(16);
  assert.equal(body.velocity.x, 64, "the crate in his hands makes it heavier to push");
  assert.deepEqual(groundCrate.pushedVelocity, { x: 64, y: 0 });
  assert.ok(scene.carriedCrate);
});

test("a backroom door only answers E when the player is facing it from close by", () => {
  const { scene } = createHarness();
  scene.backroomDoor = { x: 500, y: 100 };
  scene.interactables = { findTarget: () => null };
  const check = (x, y, facing) => {
    scene.player.sprite = { x, y };
    scene.player.currentFacing = facing;
    return scene.getNearbyBackroomDoor();
  };
  assert.equal(check(500, 132, "up"), scene.backroomDoor, "pressed against it");
  assert.equal(check(500, 156, "up"), scene.backroomDoor, "a small step back");
  assert.equal(check(500, 170, "up"), null, "too far back");
  assert.equal(check(525, 132, "up"), null, "off to the side");
  for (const facing of ["down", "left", "right"]) {
    assert.equal(check(500, 132, facing), null, `facing ${facing}`);
  }
});

test("a backroom door and the register explain themselves in the bottom bar's help", () => {
  const { scene } = createHarness();
  scene.backroomDoor = { x: 500, y: 100 };
  scene.backroomExit = { x: 145, y: 6432 };
  Object.assign(scene.player.sprite, { x: 500, y: 132 });
  scene.player.currentFacing = "up";
  scene.interactables = { findTarget: (action) => action === "register" ? { hint: "E: Activate Register" } : null };
  scene.updateCrateHint();
  assert.match(scene.messages.element.textContent, /^E: Go into the backroom$/m);
  scene.playerInBackroom = true;
  Object.assign(scene.player.sprite, { x: 145, y: 6464 });
  scene.updateCrateHint();
  assert.match(scene.messages.element.textContent, /^E: Go back out to the shop$/m);
  scene.playerInBackroom = false;
  Object.assign(scene.player.sprite, { x: 900, y: 900 });
  scene.updateCrateHint();
  assert.match(scene.messages.element.textContent, /^E: Activate Register$/m);
});

test("E opens hands-on shelves with a carried stack instead of bulk-delivering it", () => {
  const { scene } = createHarness({ carrying: true });
  const shelf = { id: "budget", type: "shelf_budget_3x4", handsOn: true };
  const top = { kind: "item", itemId: null, quantity: 0 };
  scene.carriedCrate = top;
  scene.carriedCrates = [{ kind: "item", itemId: "amo_01", quantity: 5 }, top];
  scene.getNearbyBackroomDoor = () => null;
  scene.getNearbyFixture = () => shelf;
  scene.interactables = { findTarget: () => ({ target: shelf }) };
  let opened = 0;
  scene.shelfStockingWindow = {
    uiWindow: { isOpen: false },
    openForFixture(received) {
      assert.equal(received, shelf);
      opened += 1;
    },
  };
  scene.handleInteract();
  assert.equal(opened, 1);
  assert.equal(scene.getCarriedCrates().length, 2);
  assert.equal(scene.carriedCrate, top);
});

test("fixtures only move from, and into, the room the player is standing in", () => {
  const { scene } = createHarness();
  const shelf = { id: "shelf", type: "shelf_budget_3x4", gx: 10, gy: 5 };
  scene.fixtures.get = (id) => ({ shelf })[id];
  scene.playerInBackroom = false;
  assert.equal(scene.checkFixtureMove("shelf", 1, 102).reason, "Keep it on the sales floor.");
  scene.playerInBackroom = true;
  assert.equal(scene.checkFixtureMove("shelf", 10, 6).reason, "Go out to the sales floor to move the SHELF.");
});


test("three carried crates stay straight while the player moves and reverses direction", () => {
  const h = createHarness();
  const stack = [crate(), crate(), crate()];
  const playerSprite = h.scene.player.sprite;
  playerSprite.depth = 8;
  for (const carried of stack) {
    carried.sprite = {
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setAngle(angle) { this.angle = angle; return this; },
      setDepth(depth) { this.depth = depth; return this; },
    };
    carried.followCarrier = Crate.prototype.followCarrier;
  }
  carry(h.scene, stack);
  h.scene.player.update = () => {
    playerSprite.x += playerSprite.body.velocity.x;
    playerSprite.y += playerSprite.body.velocity.y;
  };
  Object.assign(h.scene, {
    handleGamepad() {},
    fixturePlacement: { active: false, update() {} },
    separateStuckCrates() {},
    storeDoorAnimation: { update() {} },
    backroomDoorAnimation: { update() {} },
    backroomExitAnimation: { update() {} },
    getNearbyBackroomDoor: () => null,
    shiftClock: { isPaused: false, started: false, softClosed: false, update() {} },
    updateCratePushing() {},
    hud: { renderStamina() {} },
    positionGoBacksBadge() {},
    updateCrateHint() {},
    updateCrateMarker() {},
    refreshCustomerPool() {},
    spawnScheduledCustomers() {},
    customers: [],
    employees: [],
  });

  for (const velocity of [{ x: 160, y: 0 }, { x: -160, y: 0 }, { x: 0, y: -160 }, { x: 0, y: 160 }]) {
    playerSprite.body.velocity = velocity;
    h.scene.update(0, 1000);
    for (const [index, carried] of stack.entries()) {
      assert.equal(carried.sprite.x, playerSprite.x);
      assert.equal(carried.sprite.y, playerSprite.y - 42 - index * CRATE_STACK_SPACING);
      assert.equal(carried.sprite.angle, 0);
      assert.equal(carried.sprite.depth, playerSprite.depth + 1 + index);
    }
  }
  assert.deepEqual(h.scene.carriedCrates, stack);
  assert.equal(h.scene.carriedCrate, stack.at(-1));
  assert.deepEqual(h.scene.restockCrates, []);
  assert.deepEqual(h.messages, []);
});

test("the game updates player and crate movement during placement without unfreezing customers", () => {
  const { scene } = createHarness();
  let playerUpdates = 0;
  let crateUpdates = 0;
  let customerUpdates = 0;
  let customerStops = 0;
  scene.player.sprite.body.setVelocity = (x, y) => { scene.player.sprite.body.velocity = { x, y }; };
  scene.player.update = () => { playerUpdates += 1; };
  scene.player.forceFacing = () => {};
  Object.assign(scene, {
    handleGamepad() {},
    fixturePlacement: { active: true, update() {} },
    separateStuckCrates() {},
    storeDoorAnimation: { update() {} },
    backroomDoorAnimation: { update() {} },
    backroomExitAnimation: { update() {} },
    getNearbyBackroomDoor: () => null,
    shiftClock: { isPaused: true, started: false, softClosed: false, update() {} },
    updateCratePushing() { crateUpdates += 1; },
    hud: { renderStamina() {} },
    positionGoBacksBadge() {},
    updateCrateHint() {},
    updateCrateMarker() {},
    refreshCustomerPool() {},
    spawnScheduledCustomers() {},
    customers: [{ update() { customerUpdates += 1; }, standStill() { customerStops += 1; } }],
    employees: [],
  });

  scene.update(0, 16);
  assert.equal(playerUpdates, 1);
  assert.equal(crateUpdates, 1);
  assert.equal(customerUpdates, 0);
  assert.equal(customerStops, 1);
  scene.shiftClock.started = true;
  scene.update(16, 16);
  assert.equal(playerUpdates, 1, "pausing an active shift still freezes the player");
  assert.equal(crateUpdates, 1);
  assert.deepEqual(scene.player.sprite.body.velocity, { x: 0, y: 0 });
});

test("E behind the counter always steps away, even beside a trashcan or holding crates", () => {
  const h = createHarness();
  let ended = 0;
  let tookCrates = 0;
  Object.assign(h.scene, {
    operatingRegister: true,
    endRegisterSession() { ended += 1; this.operatingRegister = false; },
    getNearbyBackroomDoor: () => null,
    isNearTrashcan: () => true, // a trashcan within reach must not hijack E
    takeEmptyCrateFromTrashcan() { tookCrates += 1; },
  });
  h.scene.handleInteract();
  assert.equal(ended, 1, "E leaves the counter");
  assert.equal(tookCrates, 0, "the trashcan never hands a crate to the cashier");

  // Even holding crates (which should be impossible there), E still gets the player out.
  h.scene.operatingRegister = true;
  carry(h.scene, [crate()]);
  h.scene.handleInteract();
  assert.equal(ended, 2);
  assert.equal(h.scene.operatingRegister, false);
});

test("E opens shelves instead of picking up crates, with or without a carried crate", () => {
  const h = createHarness();
  const nearby = crate();
  const shelf = { id: "shelf", type: "shelf_budget_3x4", gx: 1, gy: 1 };
  // Feet (their top is 10px above his position) just off the shelf's front edge.
  h.scene.player.sprite.y = fixtureBounds(shelf).bottom * TILE_SIZE + 14;
  h.scene.player.currentFacing = "up";
  h.scene.restockCrates.push(nearby);
  h.scene.fixtures.shelves = () => [shelf];
  const eRegister = {
    sprite: { getBounds: () => ({ left: 80, right: 120, top: 80, bottom: 120 }) },
  };
  h.scene.fixtures.register = () => eRegister;
  h.scene.fixtures.registers = () => [eRegister];
  h.scene.fixtures.displayName = () => "Shelf";
  h.scene.getNearbyBackroomDoor = () => null;
  let opens = 0;
  const opened = [];
  h.scene.eventBus.on(GAME_EVENTS.FIXTURE_OPENED, (event) => opened.push(event));
  h.scene.shelfStockingWindow = {
    uiWindow: { isOpen: false },
    openForFixture(fixture) {
      this.uiWindow.isOpen = true;
      this.fixture = fixture;
      assert.equal(fixture, shelf);
      opens += 1;
    },
  };
  h.scene.handleInteract();
  assert.equal(opens, 1);
  assert.deepEqual(opened, [{ fixtureId: "shelf", type: "shelf_budget_3x4" }]);
  assert.equal(h.scene.carriedCrate, null);
  assert.deepEqual(h.scene.restockCrates, [nearby]);
  carry(h.scene, [itemCrate("wpn_pis_01", 4)]);
  h.scene.handleInteract();
  assert.equal(opens, 2);
  assert.equal(opened.length, 1, "re-opening the same shelf isn't a new open");
  assert.equal(h.scene.getCarriedCrates().length, 1);
});

test("E targets the shelf whose front the player stands at, not the shelf beside it", () => {
  const h = createHarness();
  const small = { id: "small", type: "shelf_budget_2x2", gx: 7.875, gy: 2 };
  const wide = { id: "wide", type: "shelf_budget_2x4", gx: 9, gy: 2 };
  h.scene.fixtures.shelves = () => [small, wide];
  h.scene.getNearbyBackroomDoor = () => null;
  h.scene.player.sprite.x = 9 * TILE_SIZE + 2;
  const front = fixtureBounds(wide).bottom * TILE_SIZE;
  h.scene.player.sprite.y = front + 10 + 4;
  h.scene.player.currentFacing = "up";
  const opened = [];
  h.scene.shelfStockingWindow = {
    uiWindow: { isOpen: false },
    openForFixture(fixture) { opened.push(fixture); },
  };

  for (const facing of ["down", "left", "right"]) {
    h.scene.player.currentFacing = facing;
    assert.equal(h.scene.getNearbyFixture(), null, `looking ${facing}, away from the shelf front`);
  }
  h.scene.player.currentFacing = "up";
  h.scene.handleInteract();
  assert.deepEqual(opened, [wide]);
  assert.equal(h.scene.getNearbyFixture(), wide);
  assert.equal(h.scene.tryOpenFixtureWindow(small), false);

  h.scene.player.sprite.x = 8 * TILE_SIZE + 20;
  h.scene.handleInteract();
  assert.deepEqual(opened, [wide, small]);

  // His feet may be at most 12px from the shelf front: a few pixels, not across the room.
  h.scene.player.sprite.y = front + 10 + 12;
  assert.equal(h.scene.getNearbyFixture(), small);
  h.scene.player.sprite.y += 1;
  assert.equal(h.scene.getNearbyFixture(), null);
});

test("E uses the register target only while the player is in range", () => {
  const h = createHarness();
  const nearbyRegister = {
    sprite: { getBounds: () => ({ left: 80, right: 120, top: 80, bottom: 120, centerX: 100, centerY: 100 }) },
  };
  h.scene.fixtures.register = () => nearbyRegister;
  h.scene.fixtures.registers = () => [nearbyRegister];
  h.scene.gameState = new GameState({ items: [] });
  // Just below the register, facing it.
  h.scene.player.sprite.y = 120 + 10 + 4;
  h.scene.player.currentFacing = "up";
  const hint = () => h.scene.interactables.findTarget("register", h.scene.getInteractionOrigin()).hint;
  assert.equal(hint(), "E: Activate Register");
  h.scene.gameState.goBacks.add("wpn_pis_01", 1);
  assert.equal(hint(), "E: Activate Register", "Go-Backs pack themselves, so there's no button for them");
  h.scene.gameState.goBacks.remove("wpn_pis_01", 1);
  let registerOpens = 0;
  h.scene.tryOpenRegister = () => { registerOpens += 1; return true; };

  h.scene.handleInteract();
  assert.equal(registerOpens, 1);
  assert.equal(h.scene.isPlayerNearRegister(), true);
  h.scene.player.currentFacing = "down";
  assert.equal(h.scene.isPlayerNearRegister(), false, "facing away from it");
  h.scene.player.currentFacing = "up";
  h.scene.player.sprite.y += 9;
  assert.equal(h.scene.isPlayerNearRegister(), false, "a step too far back");
  h.scene.player.sprite.y -= 9;

  h.scene.player.sprite.x = 200;
  assert.equal(h.scene.isPlayerNearRegister(), false);
});

test("packing the Go-Backs sets crate stacks of at most three on found floor spots", () => {
  const h = createHarness();
  const registerBounds = { left: 80, right: 120, top: 80, bottom: 120, centerX: 100, centerY: 100 };
  const packRegister = { sprite: { getBounds: () => registerBounds } };
  h.scene.fixtures.register = () => packRegister;
  h.scene.fixtures.registers = () => [packRegister];
  h.scene.gameState = new GameState({ items: [] });
  h.scene.gameState.goBacks.add("wpn_pis_01", 25);
  h.scene.gameState.goBacks.add("wpn_pis_04", 12);
  h.scene.customers = [];
  h.scene.employees = [];
  h.scene.goBacksReservedRectangles = () => [];
  const spots = [{ x: 200, y: 100 }, { x: 260, y: 100 }];
  const searches = [];
  h.scene.findGoBacksSpot = (probe, reserved) => {
    searches.push({ probe, reserved });
    return spots[searches.length - 1] ?? null;
  };
  const created = [];
  h.scene.createItemCrate = (itemId, quantity) => {
    const made = itemCrate(itemId, quantity);
    created.push(made);
    return made;
  };
  // Both spots are outside the (stubbed) backroom, so the message says so.
  const contents = (crates) => crates.map(({ itemId, quantity }) => [itemId, quantity]);

  assert.equal(h.scene.packGoBacks(), 5);
  assert.equal(h.scene.restockCrates.length, 2);
  const [first, second] = h.scene.restockCrates;
  assert.deepEqual(contents([first, ...h.scene.floorStacks.get(first)]),
    [["wpn_pis_01", 10], ["wpn_pis_01", 10], ["wpn_pis_01", 5]]);
  assert.deepEqual(contents([second, ...h.scene.floorStacks.get(second)]),
    [["wpn_pis_04", 10], ["wpn_pis_04", 2]]);
  assert.deepEqual([first.dropped.x, first.dropped.y, second.dropped.x], [200, 100, 260]);
  assert.equal(h.scene.gameState.goBacks.stock.reduce((sum, entry) => sum + entry.quantity, 0), 0);
  assert.match(h.messages.at(-1), /^Packed the Go-Backs into 5 crates\./);

  h.scene.restockCrates = [];
  h.scene.floorStacks.clear();
  h.scene.gameState.goBacks.add("wpn_pis_01", 45);
  searches.length = 1; // one more spot left
  assert.equal(h.scene.packGoBacks(), 3);
  assert.equal(h.scene.restockCrates.length, 1);
  assert.equal(h.scene.floorStacks.get(h.scene.restockCrates[0]).length, 2);
  assert.equal(h.scene.gameState.goBacks.available("wpn_pis_01"), 15);
  assert.equal(created.at(-1).destroyed, true, "the crate that found no room is thrown away");
  assert.match(h.messages.at(-1), /^Packed 3 crates of Go-Backs\. .*still in the bin\.$/);

  h.scene.gameState.goBacks.remove("wpn_pis_01", 15);
  assert.equal(h.scene.packGoBacks(), 0);
});

test("Go-Backs pack themselves: same-item crates first, then empty ones, then new crates", () => {
  const h = createHarness();
  const register = { sprite: { getBounds: () => ({ left: 80, right: 120, top: 80, bottom: 120, centerX: 100, centerY: 100 }) } };
  h.scene.fixtures.registers = () => [register];
  h.scene.gameState = new GameState({ items: [] });
  h.scene.customers = [];
  h.scene.employees = [];
  h.scene.goBacksReservedRectangles = () => [];
  const sameItem = itemCrate("wpn_pis_01", 6);
  const stackedSameItem = itemCrate("wpn_pis_01", 8);
  const empty = itemCrate(null, 0);
  const otherItem = itemCrate("wpn_pis_04", 3);
  h.scene.restockCrates = [sameItem, empty, otherItem];
  h.scene.floorStacks.set(sameItem, [stackedSameItem]);
  let spots = [];
  h.scene.findGoBacksSpot = () => spots.shift() ?? null;
  h.scene.createItemCrate = (itemId, quantity) => itemCrate(itemId, quantity);

  h.scene.gameState.goBacks.add("wpn_pis_01", 9);
  h.scene.autoPackGoBacks(0);
  assert.deepEqual([sameItem, stackedSameItem, empty, otherItem].map(({ itemId, quantity }) => [itemId, quantity]),
    [["wpn_pis_01", 10], ["wpn_pis_01", 10], ["wpn_pis_01", 3], ["wpn_pis_04", 3]]);
  assert.equal(h.scene.restockCrates.length, 3, "no new crates were needed");
  assert.equal(h.messages.length, 0);

  // A same-item crate in the player's arms is topped up too.
  const held = itemCrate("wpn_pis_02", 2);
  carry(h.scene, [held]);
  h.scene.gameState.goBacks.add("wpn_pis_02", 4);
  h.scene.autoPackGoBacks(500);
  assert.equal(held.quantity, 6);
  assert.equal(h.scene.restockCrates.length, 3);
  carry(h.scene, []);

  // No room anywhere: one message, then quiet retries until room opens up.
  h.scene.gameState.goBacks.add("wpn_pis_04", 20);
  h.scene.autoPackGoBacks(1000);
  assert.equal(otherItem.quantity, 10);
  assert.equal(h.scene.gameState.goBacks.available("wpn_pis_04"), 13);
  assert.equal(h.messages.length, 1);
  h.scene.autoPackGoBacks(2000);
  h.scene.autoPackGoBacks(7000);
  assert.equal(h.messages.length, 1, "the same leftovers don't repeat the warning");
  spots = [{ x: 200, y: 100 }];
  h.scene.autoPackGoBacks(13000);
  assert.equal(h.scene.gameState.goBacks.available("wpn_pis_04"), 0);
  assert.equal(h.scene.restockCrates.length, 4);
});

test("taking the last item out of a crate turns it back into a plain empty crate", () => {
  const emptied = itemCrate("wpn_pis_01", 4);
  let cleared = 0;
  emptied.sprite.clearTint = () => { cleared += 1; };
  assert.equal(emptied.remove("wpn_pis_01", 3), 3);
  assert.equal(cleared, 0);
  assert.equal(emptied.remove("wpn_pis_01", 5), 1);
  assert.deepEqual([emptied.itemId, emptied.quantity, cleared], [null, 0, 1]);
  assert.equal(emptied.getRemainingUnitsFor("wpn_pis_04"), 10, "it now takes any item");
});

test("inventory totals include all carried crates and active customer carts but not sold customers", () => {
  const scene = Object.create(GameScene.prototype);
  scene.fixtures = {
    shelves: () => [{ stock: [{ itemId: "rifle", quantity: 2 }], placements: [] }],
    ofKind: () => [],
  };
  scene.gameState = {
    goBacks: { stock: [{ itemId: "rifle", quantity: 1 }] },
    catalog: { licenses: new Set([undefined]), owns: () => true },
  };
  const padCrate = { itemId: "rifle", quantity: 2, kind: "item" };
  const stackBase = { itemId: "rifle", quantity: 3, kind: "item" };
  const stackTop = { itemId: "rifle", quantity: 4, kind: "item" };
  const employeeCrate = { itemId: "rifle", quantity: 6, kind: "item", isCarried: true };
  scene.restockCrates = [padCrate, stackBase];
  scene.floorStacks = new Map([[stackBase, [stackTop]]]);
  const lowerCrate = { itemId: "rifle", quantity: 2, kind: "item" };
  const middleCrate = { itemId: "pistol", quantity: 5, kind: "item" };
  const topCrate = { itemId: "rifle", quantity: 3, kind: "item" };
  scene.carriedCrates = [lowerCrate, middleCrate, topCrate];
  scene.carriedCrate = topCrate;
  scene.customers = [
    { state: "SEEK_REGISTER", cart: [{ itemId: "rifle" }, { itemId: "pistol" }] },
    { state: "SEEK_SHELF", cart: [{ itemId: "rifle" }] },
    { state: "LEAVING", cart: [{ itemId: "rifle" }] },
  ];
  scene.employees = [{ currentJob: { crate: employeeCrate } }];
  const supplyRequests = [];
  scene.gameState.market = {
    getPrice: () => 100,
    getSupplyCost: (itemId, quantity) => {
      supplyRequests.push([itemId, quantity]);
      return { rifle: 81, pistol: 59 }[itemId];
    },
  };
  scene.getStorePrice = () => 125;

  const inventory = scene.getInventoryItems();
  assert.equal(inventory.find(({ item }) => item.id === "rifle").inCustomerCarts, 2);
  assert.equal(inventory.find(({ item }) => item.id === "pistol").inCustomerCarts, 1);
  assert.equal(inventory.find(({ item }) => item.id === "rifle").offShelves, 21);
  assert.equal(inventory.find(({ item }) => item.id === "pistol").offShelves, 5);
  assert.deepEqual(supplyRequests, [["rifle", 20], ["pistol", 6]]);
  assert.equal(inventory.find(({ item }) => item.id === "rifle").unitCost, 4.05);
  assert.equal(inventory.find(({ item }) => item.id === "pistol").unitCost, 9.83);
  scene.fixtures.shelves = () => [{
    stock: [{ itemId: "rifle", quantity: 2 }],
    placements: [],
  }];
  const restockableRifle = scene.getRestockableItems()
    .find(({ item }) => item.id === "rifle");
  assert.equal(restockableRifle.ownedQuantity, 23);
});

test("selling an empty placed fixture pays half, updates walkable space, and preserves the register", () => {
  const { scene } = createHarness();
  const registry = new FixtureRegistry();
  const shelf = new ShelfFixture({ id: "shelf", placements: [] });
  let destroyed = false;
  Object.assign(shelf, {
    type: "shelf_budget_2x2", gx: 1, gy: 1, rotation: 0,
    sprite: { destroy() { destroyed = true; } },
  });
  const register = { id: "register", type: "register_basic", gx: 4, gy: 2, rotation: 0 };
  registry.add(shelf);
  registry.add(register);
  scene.fixtures = registry;
  scene.canRearrangeFixtures = () => true;
  scene.getLayoutOptions = () => ({
    entrance: { gx: 0, gy: 0 },
    gridSize: { gridW: 8, gridH: 8 },
    isWalkable: (gx, gy) => gx >= 0 && gx < 8 && gy >= 0 && gy < 8,
  });
  scene.blockedCells = new Set(["1,1", "1,2"]);
  scene.applyFixtureLayout = (_layout, result) => { scene.blockedCells = result.blockedCells; };
  const payments = [];
  scene.gameState.economy.add = (amount, entry) => {
    assert.equal(scene.fixtures.get("shelf"), undefined);
    payments.push({ amount, ...entry });
  };
  const messages = [];
  scene.showShopMessage = (message) => messages.push(message);

  assert.equal(scene.sellFixture("register"), false);
  assert.match(messages.at(-1), /last register cannot be sold/);
  shelf.placements.push({ itemId: "item", quantity: 1 });
  assert.equal(scene.sellFixture("shelf"), false);
  assert.match(messages.at(-1), /Only empty fixtures/);
  shelf.placements = [];
  assert.equal(scene.sellFixture("shelf"), true);
  assert.equal(destroyed, true);
  assert.equal(scene.blockedCells.has("1,1"), false);
  assert.equal(scene.blockedCells.has("1,2"), false);
  assert.equal(scene.fixtures.get("register"), register);
  assert.deepEqual(payments, [{ amount: 75, category: "fixture_sales", label: "BUDGET SHELF 2x2" }]);
  assert.equal(scene.sellFixture("shelf"), false);
  assert.equal(payments.length, 1);
});

test("crating an empty fixture still creates its crate and opens its floor space", () => {
  const { scene } = createHarness();
  const shelf = new ShelfFixture({ id: "shelf", placements: [] });
  Object.assign(shelf, {
    type: "shelf_budget_2x2", gx: 1, gy: 1, rotation: 0,
    sprite: { destroy() {} },
  });
  scene.fixtures = new FixtureRegistry();
  scene.fixtures.add(shelf);
  scene.fixtures.add({ id: "register", type: "register_basic", gx: 4, gy: 2, rotation: 0 });
  scene.canRearrangeFixtures = () => true;
  scene.getLayoutOptions = () => ({
    entrance: { gx: 0, gy: 0 },
    gridSize: { gridW: 8, gridH: 8 },
    isWalkable: (gx, gy) => gx >= 0 && gx < 8 && gy >= 0 && gy < 8,
  });
  scene.applyFixtureLayout = (_layout, result) => { scene.blockedCells = result.blockedCells; };
  const body = {
    setSize() { return this; },
    setOffset() { return this; },
    updateFromGameObject() {},
    setAllowGravity() { return this; },
    setAllowRotation() { return this; },
    setBounce() { return this; },
    setBoundsRectangle() { return this; },
    setCollideWorldBounds() { return this; },
  };
  scene.add = { image: () => ({
    body,
    scaleX: 1, scaleY: 1,
    setDisplaySize(_width, height) { this.displayHeight = height; return this; },
    setOrigin() { return this; },
    setDepth() { return this; },
  }) };
  scene.crateGroup = { add() {} };
  scene.crateBounds = {};
  scene.crateMotionPaused = false;
  let notifications = 0;
  scene.gameState.shop.changed = () => { notifications += 1; };

  assert.equal(scene.crateFixture("shelf"), true);
  assert.equal(scene.fixtures.get("shelf"), undefined);
  assert.equal(scene.blockedCells.has("1,1"), false);
  assert.equal(scene.restockCrates.length, 1);
  assert.equal(scene.restockCrates[0].kind, "fixture");
  assert.equal(scene.restockCrates[0].typeId, "shelf_budget_2x2");
  assert.equal(notifications, 1);
});

test("a shelf with stock on it cannot be sold or crated", () => {
  const { scene } = createHarness();
  scene.canRearrangeFixtures = () => true;
  const shelf = new ShelfFixture({ id: "shelf", placements: [] });
  shelf.type = "shelf_budget_2x4";
  shelf.placements = [{ itemId: "item", gx: 0, gy: 0, w: 1, h: 1, quantity: 1 }];
  assert.match(scene.getFixtureSaleBlockReason(shelf), /Only empty fixtures/);
  assert.match(scene.getFixtureCrateBlockReason(shelf), /Only empty fixtures/);
  shelf.placements = [];
  assert.equal(scene.getFixtureSaleBlockReason(shelf), null);
});

test("fixture crates can be sold on the loading pad or while carried, only once and off shift", () => {
  const { scene } = createHarness();
  const paid = [];
  const messages = [];
  scene.gameState.economy.add = (amount, entry) => paid.push({ amount, ...entry });
  scene.showShopMessage = (message) => messages.push(message);
  let closed = true;
  scene.canRearrangeFixtures = () => closed;
  const padCrate = {
    kind: "fixture", typeId: "shelf_budget_2x4", lockedToPad: true, destroyed: false,
    destroy() { this.destroyed = true; },
  };
  const carried = {
    kind: "fixture", typeId: "shelf_budget_2x2", destroyed: false,
    destroy() { this.destroyed = true; },
  };
  scene.restockCrates = [padCrate];
  scene.carriedCrate = carried;
  closed = false;
  assert.equal(scene.sellFixtureCrate(padCrate), false);
  assert.match(messages.at(-1), /while the store is closed/);
  closed = true;
  assert.equal(scene.sellFixtureCrate(padCrate), true);
  assert.equal(padCrate.destroyed, true);
  assert.deepEqual(scene.restockCrates, []);
  assert.equal(scene.sellFixtureCrate(padCrate), false);
  assert.equal(scene.sellFixtureCrate(carried), true);
  assert.equal(scene.carriedCrate, null);
  assert.equal(carried.destroyed, true);
  assert.deepEqual(paid, [
    { amount: 150, category: "fixture_sales", label: "BUDGET SHELF 2x4" },
    { amount: 75, category: "fixture_sales", label: "BUDGET SHELF 2x2" },
  ]);
});

test("a stack only counts as in front when at least half the player's feet line up with it", () => {
  const feet = { left: 100, right: 122, top: 200, bottom: 220 };
  const crateAt = (left, top) => ({ left, right: left + 32, top, bottom: top + 18 });
  // Facing up: the crate must cover at least 11 of the feet's 22px width.
  assert.equal(isSquarelyInFront(feet, crateAt(111, 180), "up"), true);
  assert.equal(isSquarelyInFront(feet, crateAt(112, 180), "up"), false);
  assert.equal(isSquarelyInFront(feet, crateAt(79, 180), "down"), true);
  assert.equal(isSquarelyInFront(feet, crateAt(78, 180), "down"), false);
  // Facing right: the crate must cover at least 10 of the feet's 20px height.
  assert.equal(isSquarelyInFront(feet, crateAt(124, 210), "right"), true);
  assert.equal(isSquarelyInFront(feet, crateAt(124, 211), "right"), false);
  assert.equal(isSquarelyInFront(feet, crateAt(60, 172), "left"), false);
});
