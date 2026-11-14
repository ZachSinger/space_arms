import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { ControlMode } from "../js/logic/ControlMode.js";
import { EventBus, GAME_EVENTS } from "../js/logic/EventBus.js";
import { InteractableRegistry } from "../js/logic/InteractableRegistry.js";
import { Crate, CRATE_STACK_SPACING, INTERACT_RANGE } from "../js/logic/Crate.js";
import { HOLD_KEY_MS, MAX_CARRIED_CRATES } from "../js/logic/CrateStack.js";
import { gaugeFillRect } from "../js/logic/CapacityGauge.js";
import { getFixtureType } from "../js/logic/FixtureLayout.js";
import { FixtureRegistry } from "../js/logic/FixtureRegistry.js";
import { PAD } from "../js/logic/GamepadInput.js";
import { TILE_SIZE } from "../js/logic/RoomLayout.js";

let server;
let cacheDirectory;
let GameScene;
let StorageFixture;
let ShelfFixture;
let PlayerState;
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
          return 'export const database = { getItem: (id) => ({ id, name: "Test item", slots: id === "single" ? 1 : 2, boxSize: id === "single" ? 1 : 2, dimensions: { w: 2, h: 1 }, stackSize: 3 }), getAllItems: () => [{ id: "rifle", name: "Test rifle" }, { id: "pistol", name: "Test pistol" }] };';
        }
      },
    }],
  });
  ({ GameScene } = await server.ssrLoadModule("/js/scenes/game.js"));
  ({ StorageFixture } = await server.ssrLoadModule("/js/logic/ShopInventory.js"));
  ({ ShelfFixture } = await server.ssrLoadModule("/js/logic/ShelfFixture.js"));
  ({ PlayerState } = await server.ssrLoadModule("/js/logic/PlayerState.js"));
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
  scene.eventBus = new EventBus();
  scene.interactables = new InteractableRegistry();
  scene.controlMode = new ControlMode(scene);
  // Facing right, so crates made by crate() below are in front of him.
  scene.player = {
    currentFacing: "right",
    sprite: { x: 100, y: 100, depth: 9999, body: { velocity: { x: 160, y: 0 }, center: { x: 100, y: 100 }, bottom: 110 } },
  };
  scene.playerState = { goBacks: { stock: [] }, notifyListeners() {} };
  scene.restockCrates = [];
  scene.floorStacks = new Map();
  scene.markedStackBase = null;
  scene.markedFromTop = 0;
  scene.cratePress = null;
  scene.crateMotionPaused = false;
  scene.time = { now: 0 };
  scene.fixtures = {
    stockHolders: () => [],
    register: () => null,
    displayName: (fixture) => fixture.type === "locker_single" ? "LOCKER" : "SHELF",
  };
  scene.carriedCrate = carrying ? {} : null;
  const classes = new Set(["hidden"]);
  scene.gameMessageElement = {
    textContent: "",
    style: { setProperty(name, value) { this[name] = value; } },
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
  };
  scene.gameMessageActive = false;
  scene.crateHint = "";
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
  scene.fixtures.register = () => ({
    sprite: { getBounds: () => ({ left: 80, right: 120, top: 80, bottom: 120, centerX: 100, centerY: 100 }) },
  });
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

test("Space and Q wait to tell a tap from a hold, and Space leaves focused UI controls alone", () => {
  const h = createHarness();
  assert.deepEqual([...h.handlers.keys()].sort(),
    ["keydown-CTRL", "keydown-Q", "keydown-SPACE", "keyup-Q", "keyup-SPACE"]);
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

test("Space throws the top crate while walking with no arrow showing, and explains when standing still", () => {
  const h = createHarness();
  const [lower, upper] = [crate(), crate()];
  carry(h.scene, [lower, upper]);
  const velocity = { x: 160 / Math.sqrt(2), y: -160 / Math.sqrt(2) };
  h.scene.player.sprite.body.velocity = velocity;
  upper.drop = () => { throw new Error("Throws must not teleport to the clearance position"); };

  h.handlers.get("keydown-SPACE")(keyEvent());
  assert.deepEqual(upper.thrownWith, [h.scene.player.sprite, velocity.x, velocity.y], "throws on the press itself");
  assert.equal(h.scene.player.sprite.body.velocity, velocity);
  upper.isStationary = () => false; // still flying, so the arrow can't mark it
  h.handlers.get("keyup-SPACE")(keyEvent());
  assert.deepEqual(h.scene.getCarriedCrates(), [lower]);

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
  behind.sprite.x = 40; // to his left
  h.scene.restockCrates = [behind];
  assert.equal(h.scene.markedFloorStack(), null);
  tap(h);
  assert.equal(h.messages.at(-1), "No crate nearby");
  h.scene.player.currentFacing = "left";
  assert.equal(h.scene.markedFloorStack().marked, behind);
  h.scene.restockCrates = [crate({ distance: INTERACT_RANGE + 1 })];
  h.scene.player.currentFacing = "right";
  assert.equal(h.scene.markedFloorStack(), null, "out of reach");
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

test("Q with empty hands packs the Go-Backs at the register; behind the register crates stay put", () => {
  const h = createHarness();
  const goBacksPacks = addNearbyRegister(h.scene);
  tap(h, "Q");
  assert.equal(goBacksPacks(), 1);

  carry(h.scene, [crate()]);
  h.scene.player.sprite.body.velocity = { x: 0, y: 0 };
  tap(h, "Q");
  assert.equal(goBacksPacks(), 1, "with crates in hand Q puts one down instead");
  assert.equal(h.scene.carriedCrate, null);

  h.scene.operatingRegister = true;
  tap(h, "Q");
  assert.equal(goBacksPacks(), 2);
  carry(h.scene, [crate()]);
  tap(h, "Q");
  tap(h);
  assert.deepEqual(h.messages.slice(-2),
    ["Leave the register to put down a crate", "Leave the register to pick up a crate"]);
  assert.equal(goBacksPacks(), 2);
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
  assert.equal(goBacksPacks(), 1);

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

test("Q at the Empty Crates bin puts empty crates back: a tap one, a hold every empty one on top", () => {
  const h = createHarness();
  const full = crate();
  const empties = [crate({ quantity: 0 }), crate({ quantity: 0 })];
  carry(h.scene, [full, ...empties]);
  h.scene.isNearEmptyCrateBin = () => true;

  tap(h, "Q");
  assert.equal(empties[1].destroyed, true);
  assert.deepEqual(h.scene.getCarriedCrates(), [full, empties[0]]);
  carry(h.scene, [full, empties[0], crate({ quantity: 0 })]);
  hold(h, "Q");
  assert.deepEqual(h.scene.getCarriedCrates(), [full]);
  assert.equal(h.messages.at(-1), "2 empty crates put back in the bin.");

  tap(h, "Q");
  assert.equal(h.scene.carriedCrate, null, "a stocked crate is still put down normally beside the bin");
  assert.ok(full.dropped);
});

test("the Empty Crates bin supplies free empty crates up to the carry limit", () => {
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

  assert.equal(h.scene.takeEmptyCrateFromBin(), true);
  assert.equal(h.scene.takeEmptyCrateFromBin(), true);
  assert.equal(h.scene.takeEmptyCrateFromBin(), true);
  assert.equal(h.scene.getCarriedCrates().length, 3);
  assert.ok(created.every((crate) => crate.pickedUpBy === h.scene.player.sprite));
  assert.equal(h.scene.takeEmptyCrateFromBin(), false);
  assert.equal(created.length, 3);
  assert.match(h.messages.at(-1), /only carry three crates/i);
});

test("the context lines say what each crate button does right now", () => {
  const h = createHarness();
  const element = h.scene.gameMessageElement;
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
    "Space while walking: Throw your top crate",
    "Tap Q: Put your top crate down",
    "Hold Q: Set all 3 crates down as a stack",
  ].join("\n"));

  carry(h.scene, [crate({ kind: "fixture" })]);
  h.scene.updateCrateHint();
  assert.equal(element.textContent, [
    "Space while walking: Throw your top crate",
    "Tap Q: Put your top crate down",
    "E: Place the fixture",
  ].join("\n"));
});

for (const state of ["nothingNearby", "moving", "operatingRegister", "placement", "startingShift", "loadFailed", "menu"]) {
  test(`crate hint is hidden during ${state}`, () => {
    const h = createHarness();
    h.scene.restockCrates = [crate()];
    h.scene.gameMessageElement.classList.remove("hidden");
    if (state === "nothingNearby") h.scene.restockCrates = [crate({ distance: 57 })];
    else if (state === "moving") h.scene.restockCrates = [crate({ stationary: false })];
    else if (state === "placement") h.scene.fixturePlacement.active = true;
    else if (state === "menu") h.scene.windowManager.windows.set("inventory", { id: "inventory", isOpen: true });
    else h.scene[state] = true;
    h.scene.updateCrateHint();
    assert.equal(h.scene.gameMessageElement.classList.contains("hidden"), true);
  });
}

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
  const element = h.scene.gameMessageElement;
  GameScene.prototype.showGameMessage.call(h.scene, "Not enough credits.");
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

  GameScene.prototype.showGameMessage.call(h.scene, "Another warning");
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

  h.scene.shelfStockingWindow = { getHoveredShelf: () => ({ itemId: "test_item", quantity: 3 }) };
  h.scene.updateCrateMarker();
  assert.deepEqual(renders.at(-1).marked, { label: "SHELF", name: "Test item", count: "x3", image: null },
    "the shelf space under the mouse shows in the bar");
  h.scene.shelfStockingWindow = { getHoveredShelf: () => ({ empty: true }) };
  h.scene.updateCrateMarker();
  assert.equal(renders.at(-1).marked.name, "Empty shelf space");
  h.scene.shelfStockingWindow = { getHoveredShelf: () => ({ itemId: "test_item", quantity: 0 }) };
  h.scene.updateCrateMarker();
  assert.deepEqual([renders.at(-1).marked.name, renders.at(-1).marked.count], ["Test item", "SOLD OUT"]);
});

test("stacked crates sit tight on their base, and floor crates cover the player when he walks behind them", () => {
  const h = createHarness();
  const [base, ...above] = floorStack(h.scene, 3);
  h.scene.syncFloorStacks();
  assert.deepEqual(above.map((stacked) => stacked.following),
    [0, 1].map((index) => ({ carrier: base.sprite, index, holdOffset: 10, spacing: 10 })));
  assert.equal(base.sprite.depth, 9999 + 1 + MAX_CARRIED_CRATES, "his feet are above the crate's bottom edge");

  h.scene.player.sprite.body.bottom = 130;
  h.scene.syncFloorStacks();
  assert.equal(base.sprite.depth, 2);
});

test("a floor stack is as heavy as its height, and a full stack won't budge while you carry anything", () => {
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
  assert.equal(push(), 0);
  h.scene.floorStacks.set(tall, [crate()]);
  assert.ok(push() > 0, "a two-high stack still moves while carrying");
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

function drawLocker(scene) {
  const image = {
    x: 96, y: 128,
    setOrigin(x, y) { this.origin = [x, y]; return this; },
    setDisplaySize(w, h) { this.width = w; this.height = h; return this; },
    setDepth() { return this; },
    setFrame(frame) { this.frame = frame; return this; },
    setTexture(texture, frame) { Object.assign(this, { texture, frame }); return this; },
    setInteractive() {},
    on() {},
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setAngle(angle) { this.angle = angle; return this; },
    get displayWidth() { return this.width; },
    get displayHeight() { return this.height; },
    getBounds() { return { centerX: this.x, top: this.y - this.height / 2, bottom: this.y + this.height / 2 }; },
    body: {
      world: { staticTree: { remove() {}, insert() {} } },
      position: { set(x, y) { this.x = x; this.y = y; } },
      center: { set(x, y) { this.x = x; this.y = y; } },
    },
    destroy() { this.destroyed = true; },
  };
  const label = {
    rects: [], clears: 0, visible: true,
    setVisible(visible) { this.visible = visible; return this; },
    setDepth(depth) { this.depth = depth; return this; },
    clear() { this.rects = []; this.clears += 1; return this; },
    fillStyle(color) { this.color = color; return this; },
    fillRect(x, y, width, height) { this.rects.push({ color: this.color, x, y, width, height }); return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    destroy() { this.destroyed = true; },
  };
  scene.add = {
    image: () => image,
    sprite(x, y, texture, frame) {
      Object.assign(image, { x, y, texture, frame });
      return image;
    },
    graphics: () => label,
    text(x, y, value) {
      return {
        x, y, text: value, visible: true,
        setOrigin() { return this; },
        setDepth() { return this; },
        setVisible(visible) { this.visible = visible; return this; },
        setPosition(nextX, nextY) { this.x = nextX; this.y = nextY; return this; },
        setText(nextText) { this.text = nextText; return this; },
        destroy() { this.destroyed = true; },
      };
    },
  };
  scene.obstacleGroup = { add() {} };
  const locker = new StorageFixture({
    id: "locker", x: 96, y: 128, gridDimensions: { w: 1, h: 2 }, capacity: 20,
  });
  locker.type = "locker_single";
  scene.drawFixture(locker, "locker_single");
  return locker;
}

test("locker gauges fill by box-size capacity and lockers reject a second item type", () => {
  const h = createHarness();
  const locker = drawLocker(h.scene);
  const gauge = locker.capacityGauge.graphics;
  const green = () => gauge.rects.find((rect) => rect.color === 0x22c55e);
  // Sits on the locker's front, its top edge 6px below the locker's top.
  assert.deepEqual([gauge.x, gauge.y], [96, locker.sprite.getBounds().top + 6]);
  assert.ok(gauge.depth > 10003, "drawn above the player and a full stack of carried crates");
  assert.equal(green(), undefined);
  assert.equal(locker.add("item", 3), 3); // Each item uses two box-size units.
  assert.equal(locker.add("single", 1), 0);
  h.scene.refreshLockerCapacityDisplay(locker);
  assert.deepEqual(green(), { color: 0x22c55e, x: -3, y: 14, width: 6, height: 6 }); // 6 of 20
  const clears = gauge.clears;
  h.scene.refreshLockerCapacityDisplay(locker);
  assert.equal(gauge.clears, clears);
  locker.remove("item", 3);
  locker.add("single", 20);
  h.scene.refreshLockerCapacityDisplay(locker);
  assert.deepEqual(green(), { color: 0x22c55e, x: -3, y: 0, width: 6, height: 20 });
});

test("a locker's gauge shows only while the player is close enough to open it", () => {
  const h = createHarness();
  const locker = drawLocker(h.scene);
  const gauge = locker.capacityGauge.graphics;
  h.scene.fixtures.stockHolders = () => [locker];
  Object.assign(locker, { gx: 1, gy: 1, rotation: 0 }); // faces down; its front edge is y = 132
  assert.equal(gauge.visible, false);
  const front = 132;
  h.scene.player.sprite = { x: locker.x, y: front + 10 };
  h.scene.refreshLockerGaugeVisibility(locker);
  assert.equal(gauge.visible, true);
  assert.equal(locker.itemNameLabel.visible, true);
  h.scene.player.sprite = { x: locker.x, y: front + 400 };
  h.scene.refreshLockerGaugeVisibility(locker);
  assert.equal(gauge.visible, false);
  assert.equal(locker.itemNameLabel.visible, false);
});

test("horizontal gauges fill from the left and vertical gauges fill from the bottom", () => {
  assert.deepEqual(gaugeFillRect("horizontal", 0.25), { x: 0, y: 0, width: 5, height: 6 });
  assert.deepEqual(gaugeFillRect("vertical", 0.25), { x: 0, y: 15, width: 6, height: 5 });
  assert.deepEqual(gaugeFillRect("vertical", 2), { x: 0, y: 0, width: 6, height: 20 });
});

test("single lockers swing open independently when items move in or out, then close", () => {
  const { scene } = createHarness();
  const first = drawLocker(scene);
  const second = drawLocker(scene);
  scene.afterLockerTransfer(first);
  assert.equal(first.lockerDoorOpenUntil, 600);

  assert.equal(first.sprite.texture, "locker_single_animated");
  assert.deepEqual([first.sprite.width, first.sprite.height], [36, 68]);
  scene.updateLockerAnimation(first, 90);
  scene.updateLockerAnimation(second, 90);
  assert.equal(first.sprite.frame, 1);
  assert.equal(second.sprite.frame, 0);
  scene.updateLockerAnimation(first, 180);
  assert.equal(first.sprite.frame, 3);

  scene.time.now = 600;
  scene.afterLockerTransfer(second);
  scene.updateLockerAnimation(first, 499);
  scene.updateLockerAnimation(first, 1);
  scene.updateLockerAnimation(second, 270);
  assert.equal(first.lockerAnimation.state, "closing");
  assert.equal(second.sprite.frame, 3);
  scene.updateLockerAnimation(first, 270);
  assert.equal(first.sprite.frame, 0);

  scene.time.now = 1200;
  scene.updateLockerAnimation(second, 499);
  scene.updateLockerAnimation(second, 1);
  scene.updateLockerAnimation(second, 270);
  assert.equal(second.sprite.frame, 0);
});

test("E at a locker beside the backroom exit opens the locker, not the door", () => {
  const { scene } = createHarness();
  const locker = { type: "locker_single", x: 118, y: 6498 };
  scene.playerInBackroom = true;
  scene.backroomDoor = { x: 900, y: 100 };
  scene.backroomExit = { x: 160, y: 6432 };
  scene.getInteractionOrigin = () => scene.player.sprite;
  scene.interactables = { findTarget: () => ({ kind: "fixture", target: locker }) };
  for (const [x, door] of [[118, null], [135, null], [141, scene.backroomExit]]) {
    scene.player.sprite = { x, y: 6500 };
    assert.equal(scene.getNearbyBackroomDoor(), door, `player at x ${x}`);
  }
  scene.interactables = { findTarget: () => null };
  scene.player.sprite = { x: 135, y: 6500 };
  assert.equal(scene.getNearbyBackroomDoor(), scene.backroomExit);
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
  const locker = { id: "locker", type: "locker_single", gx: 1, gy: 101 };
  const shelf = { id: "shelf", type: "shelf_budget_3x4", gx: 10, gy: 5 };
  scene.fixtures.get = (id) => ({ locker, shelf })[id];
  scene.playerInBackroom = false;
  assert.equal(scene.checkFixtureMove("locker", 1, 102).reason, "Go into the backroom to move the LOCKER.");
  assert.equal(scene.checkFixtureMove("shelf", 1, 102).reason, "Keep it on the sales floor.");
  scene.playerInBackroom = true;
  assert.equal(scene.checkFixtureMove("shelf", 10, 6).reason, "Go out to the sales floor to move the SHELF.");
  assert.equal(scene.checkFixtureMove("locker", 10, 6).reason, "Keep it in the backroom.");
  assert.equal(scene.getFixtureMoveAreaBlockReason(locker), null);
});

test("locker art and solid collision stay upright and narrow in every facing", () => {
  const { scene } = createHarness();
  const locker = drawLocker(scene);
  for (let rotation = 0; rotation < 4; rotation++) {
    locker.rotation = rotation;
    scene.orientFixtureSprite(locker);
    const expected = rotation % 2 === 0 ? [36, 68] : [24, 68];
    assert.deepEqual([locker.sprite.body.width, locker.sprite.body.height], expected);
    assert.equal(locker.sprite.angle, 0);
    assert.match(locker.sprite.texture, /locker_single.*animated/);
  }
});

test("locker labels follow layout changes and are destroyed with the fixture", () => {
  const h = createHarness();
  const locker = drawLocker(h.scene);
  const label = locker.capacityGauge.graphics;
  const itemNameLabel = locker.itemNameLabel;
  h.scene.fixtures = {
    get: () => locker,
    all: () => [locker],
    clear: () => [locker],
  };
  h.scene.room = { worldX: (gx) => gx * 64 + 32, worldY: (gy) => gy * 64 + 32 };
  h.scene.applyFixtureLayout([{ id: "locker", gx: 3, gy: 4 }], {
    access: new Map([["locker", { gx: 3, gy: 6 }]]), blockedCells: [], queueCells: [],
  });
  assert.deepEqual([label.x, label.y], [210, 262]);
  assert.deepEqual([itemNameLabel.x, itemNameLabel.y], [210, 254]);
  h.scene.despawnAllFixtures();
  assert.equal(label.destroyed, true);
  assert.equal(itemNameLabel.destroyed, true);
  assert.equal(locker.sprite.destroyed, true);
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
    updateRegisterPrompt() {},
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

test("E opens shelves instead of picking up crates, with or without a carried crate", () => {
  const h = createHarness();
  const nearby = crate();
  const shelf = { id: "shelf", type: "shelf_budget_3x4", gx: 1, gy: 1 };
  h.scene.player.sprite.y = 160;
  h.scene.restockCrates.push(nearby);
  h.scene.fixtures.stockHolders = () => [shelf];
  h.scene.fixtures.register = () => ({
    sprite: { getBounds: () => ({ left: 80, right: 120, top: 80, bottom: 120 }) },
  });
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

test("E with an empty or matching crate at a locker fills the highest crate that can take its items", () => {
  const h = createHarness();
  const locker = drawLocker(h.scene);
  locker.add("wpn_rif_01", 7);
  h.scene.getNearbyBackroomDoor = () => null;
  h.scene.getNearbyFixture = () => locker;
  h.scene.time.now = 1000;
  const empty = itemCrate("wpn_rif_01", 0);
  const ammo = itemCrate("amo_01", 2);
  carry(h.scene, [empty, ammo]);
  const transfers = [];
  h.scene.eventBus.on(GAME_EVENTS.INVENTORY_TRANSFERRED, (event) => transfers.push(event));

  h.scene.updateCrateHint();
  assert.match(h.scene.gameMessageElement.textContent, /^E: Fill a crate from this locker$/m);
  h.scene.handleInteract();
  assert.deepEqual([empty.itemId, empty.quantity], ["wpn_rif_01", 5], "a crate holds 5 rifles");
  assert.equal(ammo.quantity, 2);
  assert.equal(locker.getAvailableUnitsFor("wpn_rif_01"), 2);
  assert.equal(h.messages.at(-1), "Took 5 Test item from the locker.");
  assert.deepEqual(transfers, [{ itemId: "wpn_rif_01", quantity: 5, source: "locker", destination: "crate" }]);
  assert.equal(locker.lockerDoorOpenUntil, 1600);

  h.scene.handleInteract();
  assert.equal(h.messages.at(-1), "This locker holds Test item. Bring an empty crate or one with Test item in it.");
  carry(h.scene, [empty]);
  h.scene.handleInteract();
  assert.equal(h.messages.at(-1), "Your Test item crate is already full.");
  assert.equal(locker.getAvailableUnitsFor("wpn_rif_01"), 2);

  const partial = itemCrate("wpn_rif_01", 4);
  carry(h.scene, [partial]);
  h.scene.handleInteract();
  assert.deepEqual([partial.quantity, locker.getAvailableUnitsFor("wpn_rif_01")], [5, 1]);

  locker.remove("wpn_rif_01", 1);
  carry(h.scene, [itemCrate("wpn_rif_01", 0)]);
  h.scene.handleInteract();
  assert.equal(h.messages.at(-1), "This locker is empty.");
  assert.equal(h.scene.carriedCrate.quantity, 0);
});

test("E or a click at a locker with empty hands says to bring an empty crate", () => {
  const h = createHarness();
  const locker = drawLocker(h.scene);
  locker.add("wpn_rif_01", 3);
  h.scene.getNearbyBackroomDoor = () => null;
  h.scene.interactables = { findTarget: () => ({ kind: "fixture", target: locker }) };
  h.scene.handleInteract();
  assert.equal(h.messages.at(-1), "Bring an empty crate from the EMPTY CRATES bin to take items out of this locker.");
  assert.equal(h.scene.tryOpenFixtureWindow(locker), false);
  assert.equal(h.messages.length, 2);
  assert.equal(locker.getAvailableUnitsFor("wpn_rif_01"), 3);
});

test("Q at a locker empties the top crate on a tap and crates top first on a hold until one doesn't fit", () => {
  const h = createHarness();
  const locker = drawLocker(h.scene); // 20 units: 10 two-unit items
  h.scene.getNearbyFixture = () => locker;
  h.scene.player.sprite.body.velocity = { x: 0, y: 0 };
  const stack = [itemCrate("wpn_rif_01", 3), itemCrate("wpn_rif_01", 3), itemCrate("wpn_rif_01", 3)];
  carry(h.scene, stack);
  const events = [];
  h.scene.eventBus.on(GAME_EVENTS.INVENTORY_TRANSFERRED, (event) => events.push(event));
  h.scene.eventBus.on(GAME_EVENTS.CRATE_DELIVERY_RESULT, (event) => events.push(event));

  h.scene.updateCrateHint();
  assert.match(h.scene.gameMessageElement.textContent, /^Tap Q: Empty your top crate into this locker$/m);
  assert.equal(h.scene.crateActions().putDown.locker, true);
  tap(h, "Q");
  assert.equal(stack[2].destroyed, true, "emptied crates despawn");
  assert.deepEqual(h.scene.getCarriedCrates(), [stack[0], stack[1]]);
  assert.equal(locker.getAvailableUnitsFor("wpn_rif_01"), 3);
  assert.equal(locker.lockerDoorOpenUntil, 600);
  assert.deepEqual(events, [
    { itemId: "wpn_rif_01", quantity: 3, source: "crate", destination: "locker" },
    { itemId: "wpn_rif_01", accepted: 3, remaining: 0 },
  ]);

  hold(h, "Q");
  assert.deepEqual(h.scene.getCarriedCrates(), []);
  assert.deepEqual([stack[0].destroyed, stack[1].destroyed], [true, true]);
  assert.equal(locker.getAvailableUnitsFor("wpn_rif_01"), 9);

  const below = itemCrate("wpn_rif_01", 5);
  const top = itemCrate("wpn_rif_01", 5);
  carry(h.scene, [below, top]);
  hold(h, "Q");
  assert.deepEqual([top.quantity, top.destroyed, below.quantity], [4, undefined, 5],
    "a crate that only partly fits stays carried, and the hold stops there");
  assert.deepEqual(events.at(-1), { itemId: "wpn_rif_01", accepted: 1, remaining: 4 });
  assert.deepEqual(h.scene.getCarriedCrates(), [below, top]);
  assert.equal(h.scene.crateActions().putDown.reason, "This locker is full.");
  tap(h, "Q");
  assert.equal(h.messages.at(-1), "This locker is full.");
  assert.equal(top.dropped, undefined, "a refused crate stays in your hands");

  locker.remove("wpn_rif_01", 10);
  locker.add("amo_01", 1);
  const refused = h.scene.crateActions().putDown;
  assert.deepEqual([refused.blocked, refused.reason, refused.hold],
    [true, "This locker only holds Test item.", undefined]);
  hold(h, "Q");
  assert.equal(h.messages.at(-1), "This locker only holds Test item.");
  assert.deepEqual([top.quantity, h.scene.getCarriedCrates().length], [4, 2]);

  carry(h.scene, [itemCrate("wpn_rif_01", 0)]);
  assert.equal(h.scene.crateActions().putDown.locker, undefined, "an empty crate is just put down");
});
test("E targets the shelf whose front the player stands at, not the shelf beside it", () => {
  const h = createHarness();
  const small = { id: "small", type: "shelf_budget_2x2", gx: 7.875, gy: 2 };
  const wide = { id: "wide", type: "shelf_budget_2x4", gx: 9, gy: 2 };
  h.scene.fixtures.stockHolders = () => [small, wide];
  h.scene.getNearbyBackroomDoor = () => null;
  h.scene.player.sprite.x = 9 * TILE_SIZE + 2;
  h.scene.player.sprite.y = 3 * TILE_SIZE + 20;
  const opened = [];
  h.scene.shelfStockingWindow = {
    uiWindow: { isOpen: false },
    openForFixture(fixture) { opened.push(fixture); },
  };

  h.scene.handleInteract();
  assert.deepEqual(opened, [wide]);
  assert.equal(h.scene.getNearbyFixture(), wide);
  assert.equal(h.scene.tryOpenFixtureWindow(small), false);

  h.scene.player.sprite.x = 8 * TILE_SIZE + 20;
  h.scene.handleInteract();
  assert.deepEqual(opened, [wide, small]);

  h.scene.player.sprite.y = 3 * TILE_SIZE + 110;
  assert.equal(h.scene.getNearbyFixture(), small);
  h.scene.player.sprite.y += 1;
  assert.equal(h.scene.getNearbyFixture(), null);
});

test("E and Q use the register target only while the player is in range", () => {
  const h = createHarness();
  h.scene.fixtures.register = () => ({
    sprite: { getBounds: () => ({ left: 80, right: 120, top: 80, bottom: 120, centerX: 100, centerY: 100 }) },
  });
  h.scene.playerState = new PlayerState();
  const hint = () => h.scene.interactables.findTarget("register", h.scene.getInteractionOrigin()).hint;
  assert.equal(hint(), "E: Activate Register", "no Go-Backs line while the bin is empty");
  h.scene.playerState.goBacks.add("wpn_pis_01", 1);
  assert.equal(hint(), "E: Activate Register\nQ: Pack the Go-Backs into crates");
  h.scene.playerState.goBacks.remove("wpn_pis_01", 1);
  let registerOpens = 0;
  h.scene.tryOpenRegister = () => { registerOpens += 1; return true; };

  h.scene.handleInteract();
  assert.equal(h.scene.packGoBacks(), 0);
  assert.equal(registerOpens, 1);
  assert.deepEqual(h.messages, ["The Go-Backs bin is empty."]);
  assert.equal(h.scene.isPlayerNearRegister(), true);

  h.scene.player.sprite.x = 200;
  assert.equal(h.scene.isPlayerNearRegister(), false);
  assert.equal(h.scene.packGoBacks(), 0);
  assert.equal(h.messages.length, 1);
});

test("packing the Go-Backs sets crates down by the register in stacks of at most three", () => {
  const h = createHarness();
  const registerBounds = { left: 80, right: 120, top: 80, bottom: 120, centerX: 100, centerY: 100 };
  h.scene.fixtures.register = () => ({ sprite: { getBounds: () => registerBounds } });
  h.scene.playerState = new PlayerState();
  h.scene.playerState.goBacks.add("wpn_pis_01", 25);
  h.scene.playerState.goBacks.add("wpn_pis_04", 12);
  const reserved = [{ left: 0, right: 10, top: 0, bottom: 10 }];
  h.scene.goBacksReservedRectangles = () => reserved;
  const spots = [{ x: 200, y: 100 }, { x: 260, y: 100 }];
  const searches = [];
  const created = [];
  h.scene.createItemCrate = (itemId, quantity) => {
    const made = itemCrate(itemId, quantity);
    made.findDropPosition = (...args) => {
      searches.push(args);
      return spots[searches.length - 1] ?? null;
    };
    created.push(made);
    return made;
  };
  const contents = (crates) => crates.map(({ itemId, quantity }) => [itemId, quantity]);

  assert.equal(h.scene.packGoBacks(), 5);
  assert.equal(h.scene.restockCrates.length, 2);
  const [first, second] = h.scene.restockCrates;
  assert.deepEqual(contents([first, ...h.scene.floorStacks.get(first)]),
    [["wpn_pis_01", 10], ["wpn_pis_01", 10], ["wpn_pis_01", 5]]);
  assert.deepEqual(contents([second, ...h.scene.floorStacks.get(second)]),
    [["wpn_pis_04", 10], ["wpn_pis_04", 2]]);
  assert.deepEqual([first.dropped.x, first.dropped.y, second.dropped.x], [200, 100, 260]);
  assert.deepEqual(searches[0].slice(0, 4), [100, 100, h.scene.player.sprite, reserved]);
  assert.equal(h.scene.playerState.goBacks.stock.reduce((sum, entry) => sum + entry.quantity, 0), 0);
  assert.equal(h.messages.at(-1), "Packed the Go-Backs into 5 crates by the register.");

  h.scene.restockCrates = [];
  h.scene.floorStacks.clear();
  h.scene.playerState.goBacks.add("wpn_pis_01", 45);
  searches.length = 1; // one more spot left
  assert.equal(h.scene.packGoBacks(), 3);
  assert.equal(h.scene.restockCrates.length, 1);
  assert.equal(h.scene.floorStacks.get(h.scene.restockCrates[0]).length, 2);
  assert.equal(h.scene.playerState.goBacks.getAvailableUnitsFor("wpn_pis_01"), 15);
  assert.equal(created.at(-1).destroyed, true, "the crate that found no room is thrown away");
  assert.match(h.messages.at(-1), /^Packed 3 Go-Backs crates by the register\. .*still in the bin\.$/);

  h.scene.playerState.goBacks.remove("wpn_pis_01", 15);
  assert.equal(h.scene.packGoBacks(), 0);
  assert.equal(h.messages.at(-1), "The Go-Backs bin is empty.");
});

test("inventory totals include all carried crates and active customer carts but not sold customers", () => {
  const scene = Object.create(GameScene.prototype);
  scene.fixtures = { stockHolders: () => [] };
  scene.playerState = { goBacks: { stock: [] } };
  scene.restockCrates = [];
  scene.floorStacks = new Map();
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
  scene.employees = [];
  scene.market = { getPrice: () => 100 };
  scene.getStorePrice = () => 125;

  const inventory = scene.getInventoryItems();
  assert.equal(inventory.find(({ item }) => item.id === "rifle").inCustomerCarts, 2);
  assert.equal(inventory.find(({ item }) => item.id === "pistol").inCustomerCarts, 1);
  assert.equal(inventory.find(({ item }) => item.id === "rifle").storage, 5);
  assert.equal(inventory.find(({ item }) => item.id === "pistol").storage, 5);
});

test("selling an empty placed fixture pays half, updates walkable space, and preserves the register", () => {
  const { scene } = createHarness();
  const registry = new FixtureRegistry();
  const locker = new StorageFixture({ id: "locker", x: 96, y: 128, capacity: 20, stock: [] });
  let destroyed = false;
  Object.assign(locker, {
    type: "locker_single", gx: 1, gy: 1, rotation: 0,
    sprite: { destroy() { destroyed = true; } },
  });
  const register = { id: "register", type: "register_basic", gx: 4, gy: 2, rotation: 0 };
  registry.add(locker);
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
  scene.playerState.addCredits = (amount, entry) => {
    assert.equal(scene.fixtures.get("locker"), undefined);
    payments.push({ amount, ...entry });
  };
  const messages = [];
  scene.showShopMessage = (message) => messages.push(message);

  assert.equal(scene.sellFixture("register"), false);
  assert.match(messages.at(-1), /last register cannot be sold/);
  locker.stock.push({ itemId: "item", quantity: 1 });
  assert.equal(scene.sellFixture("locker"), false);
  assert.match(messages.at(-1), /Only empty fixtures/);
  locker.stock = [];
  assert.equal(scene.sellFixture("locker"), true);
  assert.equal(destroyed, true);
  assert.equal(scene.blockedCells.has("1,1"), false);
  assert.equal(scene.blockedCells.has("1,2"), false);
  assert.equal(scene.fixtures.get("register"), register);
  assert.deepEqual(payments, [{ amount: 90, category: "fixture_sales", label: "LOCKER" }]);
  assert.equal(scene.sellFixture("locker"), false);
  assert.equal(payments.length, 1);
});

test("crating an empty fixture still creates its crate and opens its floor space", () => {
  const { scene } = createHarness();
  const locker = new StorageFixture({ id: "locker", x: 96, y: 128, capacity: 20, stock: [] });
  Object.assign(locker, {
    type: "locker_single", gx: 1, gy: 1, rotation: 0,
    sprite: { destroy() {} },
  });
  scene.fixtures = new FixtureRegistry();
  scene.fixtures.add(locker);
  scene.fixtures.add({ id: "register", type: "register_basic", gx: 4, gy: 2, rotation: 0 });
  scene.canRearrangeFixtures = () => true;
  scene.getLayoutOptions = () => ({
    entrance: { gx: 0, gy: 0 },
    gridSize: { gridW: 8, gridH: 8 },
    isWalkable: (gx, gy) => gx >= 0 && gx < 8 && gy >= 0 && gy < 8,
  });
  scene.applyFixtureLayout = (_layout, result) => { scene.blockedCells = result.blockedCells; };
  const body = {
    setAllowGravity() { return this; },
    setAllowRotation() { return this; },
    setBounce() { return this; },
    setBoundsRectangle() { return this; },
    setCollideWorldBounds() { return this; },
  };
  scene.add = { image: () => ({
    body,
    setDisplaySize() { return this; },
    setDepth() { return this; },
  }) };
  scene.crateGroup = { add() {} };
  scene.crateBounds = {};
  scene.crateMotionPaused = false;
  let notifications = 0;
  scene.playerState.notifyListeners = () => { notifications += 1; };

  assert.equal(scene.crateFixture("locker"), true);
  assert.equal(scene.fixtures.get("locker"), undefined);
  assert.equal(scene.blockedCells.has("1,1"), false);
  assert.equal(scene.restockCrates.length, 1);
  assert.equal(scene.restockCrates[0].kind, "fixture");
  assert.equal(scene.restockCrates[0].typeId, "locker_single");
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
  scene.playerState.addCredits = (amount, entry) => paid.push({ amount, ...entry });
  scene.showShopMessage = (message) => messages.push(message);
  let closed = true;
  scene.canRearrangeFixtures = () => closed;
  const padCrate = {
    kind: "fixture", typeId: "shelf_budget_2x4", lockedToPad: true, destroyed: false,
    destroy() { this.destroyed = true; },
  };
  const carried = {
    kind: "fixture", typeId: "locker_single", destroyed: false,
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
    { amount: 90, category: "fixture_sales", label: "LOCKER" },
  ]);
});
