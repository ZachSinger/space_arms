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
import { Crate } from "../js/logic/Crate.js";
import { getFixtureType } from "../js/logic/FixtureLayout.js";
import { FixtureRegistry } from "../js/logic/FixtureRegistry.js";
import { PAD } from "../js/logic/GamepadInput.js";
import { TILE_SIZE } from "../js/logic/RoomLayout.js";

let server;
let cacheDirectory;
let GameScene;
let StorageFixture;
let ShelfFixture;
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
          return 'export const database = { getItem: (id) => ({ id, name: "Test item", slots: id === "single" ? 1 : 2, dimensions: { w: 2, h: 1 }, stackSize: 3 }), getAllItems: () => [{ id: "rifle", name: "Test rifle" }, { id: "pistol", name: "Test pistol" }] };';
        }
      },
    }],
  });
  ({ GameScene } = await server.ssrLoadModule("/js/scenes/game.js"));
  ({ StorageFixture } = await server.ssrLoadModule("/js/logic/ShopInventory.js"));
  ({ ShelfFixture } = await server.ssrLoadModule("/js/logic/ShelfFixture.js"));
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
  let drops = 0;
  const scene = Object.create(GameScene.prototype);
  scene.startingShift = false;
  scene.loadFailed = false;
  scene.operatingRegister = false;
  scene.fixturePlacement = { active: false };
  scene.windowManager = { windows: new Map() };
  scene.eventBus = new EventBus();
  scene.interactables = new InteractableRegistry();
  scene.controlMode = new ControlMode(scene);
  scene.player = { sprite: { x: 100, y: 100, body: { velocity: { x: 160, y: 0 } } } };
  scene.playerState = { notifyListeners() {} };
  scene.restockCrates = [];
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
  scene.dropCarriedCrate = () => { drops += 1; scene.carriedCrate = null; };
  scene.bindCrateKey();
  GameScene.prototype.registerInteractableSources.call(scene);
  return { scene, messages, handlers, removedCaptures, drops: () => drops };
}

function crate({ kind = "item", distance = 20, stationary = true, pushed = false, sliding = false } = {}) {
  return {
    kind,
    itemId: kind === "fixture" ? null : "item",
    typeId: kind === "fixture" ? "shelf_universal" : null,
    quantity: kind === "fixture" ? 1 : 5,
    distanceTo: () => distance,
    isPushed: pushed,
    isStationary: () => stationary,
    isSliding: () => sliding,
    canPickUp: Crate.prototype.canPickUp,
    pickUp() { return this.canPickUp(); },
    findDropPosition: () => ({ x: 100, y: 100 }),
    findThrowPosition: () => ({ x: 150, y: 100 }),
    startThrow() {},
    drop() {},
    sprite: { getBounds: () => ({ x: 80, y: 80, width: 40, height: 40 }) },
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
  assert.equal(body.velocity.x, 96);
  assert.deepEqual(groundCrate.pushedVelocity, { x: 96, y: 0 });
  assert.ok(scene.carriedCrate);
});

test("Space drops once per press and its handler binds no other keys", () => {
  const h = createHarness({ carrying: true });
  assert.deepEqual([...h.handlers.keys()], ["keydown-SPACE"]);
  assert.deepEqual(h.removedCaptures, ["SPACE"]);

  const press = keyEvent();
  h.handlers.get("keydown-SPACE")(press);
  assert.equal(press.defaultPrevented, true);
  assert.equal(h.drops(), 1);

  const repeat = keyEvent({ repeat: true });
  h.handlers.get("keydown-SPACE")(repeat);
  assert.equal(repeat.defaultPrevented, true);
  assert.equal(h.drops(), 1);
});

for (const carrying of [false, true]) {
  test(`Space leaves focused UI controls alone when carrying=${carrying}`, () => {
    const h = createHarness({ carrying });
    h.scene.restockCrates.push(crate());
    const carried = h.scene.carriedCrate;
    const event = keyEvent({ inUi: true });
    h.handlers.get("keydown-SPACE")(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(h.scene.carriedCrate, carried);
    assert.equal(h.scene.restockCrates.length, 1);
    assert.equal(h.drops(), 0);
    assert.deepEqual(h.messages, []);
  });
}

test("dropping a crate does not display a confirmation banner", () => {
  const h = createHarness();
  const carried = crate();
  const dropped = [];
  h.scene.eventBus.on(GAME_EVENTS.CRATE_DROPPED, (event) => dropped.push(event));
  h.scene.carriedCrate = carried;
  assert.equal(GameScene.prototype.dropCarriedCrate.call(h.scene), true);
  assert.equal(h.scene.carriedCrate, null);
  assert.deepEqual(h.scene.restockCrates, [carried]);
  assert.deepEqual(h.messages, []);
  assert.deepEqual(dropped, [{
    kind: "item",
    itemId: "item",
    typeId: null,
    quantity: 5,
    thrown: true,
    x: 150,
    y: 100,
  }]);
});

test("throwing starts a smooth launch using the current movement without stopping or resetting the player", () => {
  const h = createHarness();
  const carried = crate();
  const velocity = { x: 160 / Math.sqrt(2), y: -160 / Math.sqrt(2) };
  h.scene.player.sprite.body.velocity = velocity;
  h.scene.carriedCrate = carried;
  carried.findDropPosition = () => { throw new Error("A throw must not drop at the player's feet"); };
  carried.findThrowPosition = (carrier, x, y) => {
    assert.equal(carrier, h.scene.player.sprite);
    assert.deepEqual({ x, y }, velocity);
    return { x: 150, y: 50 };
  };
  let release;
  carried.drop = () => { throw new Error("Throws must not teleport to the clearance position"); };
  carried.startThrow = (...args) => { release = args; };
  assert.equal(GameScene.prototype.dropCarriedCrate.call(h.scene), true);
  assert.deepEqual(release, [h.scene.player.sprite, velocity.x, velocity.y]);
  assert.equal(h.scene.player.sprite.body.velocity, velocity);
  assert.equal(h.scene.carriedCrate, null);
});

for (const paused of [false, true]) {
  test(`stationary drops use a clear position beside the player when paused=${paused}`, () => {
    const h = createHarness();
    const carried = crate();
    h.scene.carriedCrate = carried;
    h.scene.crateMotionPaused = paused;
    if (!paused) h.scene.player.sprite.body.velocity = { x: 0, y: 0 };
    carried.findThrowPosition = () => { throw new Error("A stationary drop must not throw"); };
    carried.findDropPosition = (x, y, carrier) => {
      assert.equal(carrier, h.scene.player.sprite);
      assert.deepEqual({ x, y }, { x: 100, y: 100 });
      return { x: 52, y: 100 };
    };
    let release;
    carried.drop = (...args) => { release = args; };
    assert.equal(GameScene.prototype.dropCarriedCrate.call(h.scene), true);
    assert.deepEqual(release, [52, 100, 0, 0, paused]);
  });
}

test("a blocked forward release keeps the crate carried rather than dropping it under the player", () => {
  const h = createHarness();
  const carried = crate();
  h.scene.carriedCrate = carried;
  carried.findThrowPosition = () => null;
  carried.drop = () => { throw new Error("Blocked crate must stay carried"); };
  assert.equal(GameScene.prototype.dropCarriedCrate.call(h.scene), false);
  assert.equal(h.scene.carriedCrate, carried);
  assert.equal(h.scene.restockCrates.length, 0);
  assert.deepEqual(h.scene.player.sprite.body.velocity, { x: 160, y: 0 });
  assert.deepEqual(h.messages, ["No room to throw crate"]);
});

for (const kind of ["item", "fixture"]) {
  test(`nearby ${kind} crate hint describes exactly the crate Space will pick up in the shared message area`, () => {
    const h = createHarness();
    const target = crate({ kind, distance: 56 });
    h.scene.restockCrates = [target, crate({ distance: 57 }), crate({ distance: 1, stationary: false })];
    h.scene.updateCrateHint();
    assert.equal(h.scene.gameMessageElement.classList.contains("hidden"), false);
    assert.equal(h.scene.gameMessageElement.textContent,
      `${kind === "item" ? "Test item x5" : `${getFixtureType("shelf_universal").name} fixture`} | Space: Pick up`);
    assert.equal(h.scene.gameMessageElement.classList.contains("context-message"), true);
    h.scene.tryPickUpNearestCrate();
    assert.equal(h.scene.carriedCrate, target);
    assert.deepEqual(h.messages, []);
    h.scene.updateCrateHint();
    if (kind === "item") {
      assert.equal(h.scene.gameMessageElement.classList.contains("hidden"), false);
      assert.equal(h.scene.gameMessageElement.textContent,
        "Q: Unpack into your hovercart | E: Deliver to a shelf or locker | Space: Drop");
    } else {
      assert.equal(h.scene.gameMessageElement.classList.contains("hidden"), true);
    }
  });
}

test("the nearest stationary crate is both the hint and pickup target, including ties", () => {
  const h = createHarness();
  const target = { ...crate({ distance: 10 }), quantity: 3 };
  h.scene.restockCrates = [crate({ distance: 20 }), crate({ distance: 10 }), target];
  h.scene.updateCrateHint();
  assert.equal(h.scene.gameMessageElement.textContent, "Test item x3 | Space: Pick up");
  h.scene.tryPickUpNearestCrate();
  assert.equal(h.scene.carriedCrate, target);
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
  assert.equal(element.textContent, "Test item x3 | Space: Pick up");
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

for (const state of ["outOfRange", "moving", "operatingRegister", "placement", "startingShift", "loadFailed"]) {
  test(`crate hint is hidden during ${state}`, () => {
    const h = createHarness();
    h.scene.restockCrates = [crate()];
    h.scene.gameMessageElement.classList.remove("hidden");
    if (state === "outOfRange") h.scene.restockCrates = [crate({ distance: 57 })];
    else if (state === "moving") h.scene.restockCrates = [crate({ stationary: false })];
    else if (state === "carrying") h.scene.carriedCrate = crate();
    else if (state === "placement") h.scene.fixturePlacement.active = true;
    else h.scene[state] = true;
    h.scene.updateCrateHint();
    assert.equal(h.scene.gameMessageElement.classList.contains("hidden"), true);
  });
}

test("carrying a stock crate shows its controls unless a menu is open", () => {
  const h = createHarness({ carrying: true });
  h.scene.carriedCrate = crate();
  h.scene.updateCrateHint();
  assert.equal(h.scene.gameMessageElement.textContent,
    "Q: Unpack into your hovercart | E: Deliver to a shelf or locker | Space: Drop");
  assert.equal(h.scene.gameMessageElement.classList.contains("hidden"), false);

  h.scene.gameMessageElement.textContent = "";
  h.scene.windowManager.windows.set("inventory", { id: "inventory", isOpen: true });
  h.scene.updateCrateHint();
  assert.equal(h.scene.gameMessageElement.textContent, "");
  assert.equal(h.scene.gameMessageElement.classList.contains("hidden"), true);
});

test("carrying a fixture crate does not show stock-unpacking controls", () => {
  const h = createHarness({ carrying: true });
  h.scene.carriedCrate = crate({ kind: "fixture" });
  h.scene.updateCrateHint();
  assert.equal(h.scene.gameMessageElement.textContent, "");
  assert.equal(h.scene.gameMessageElement.classList.contains("hidden"), true);
});

function drawLocker(scene) {
  const image = {
    x: 96, y: 128,
    setDisplaySize(w, h) { this.width = w; this.height = h; return this; },
    setDepth() { return this; },
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
    text: "", updates: 0,
    setOrigin(x, y) { this.origin = [x, y]; return this; },
    setDepth(depth) { this.depth = depth; return this; },
    setText(text) { this.text = text; this.updates += 1; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    destroy() { this.destroyed = true; },
  };
  scene.add = { image: () => image, text: () => label };
  scene.obstacleGroup = { add() {} };
  const locker = new StorageFixture({
    id: "locker", x: 96, y: 128, gridDimensions: { w: 1, h: 2 }, capacity: 20,
  });
  locker.type = "locker_single";
  scene.drawFixture(locker, "locker_single");
  return locker;
}

test("locker labels show occupied capacity, not the number of items", () => {
  const h = createHarness();
  const locker = drawLocker(h.scene);
  const label = locker.capacityLabel;
  assert.equal(label.text, "0/20");
  assert.deepEqual([label.x, label.y], [96, 68]);
  assert.deepEqual(label.origin, [0.5, 0]);
  assert.equal(label.depth, 3);
  assert.equal(locker.add("item", 3), 3); // Each unit uses two spaces.
  assert.equal(locker.add("single", 1), 1);
  h.scene.refreshLockerCapacityDisplay(locker);
  assert.equal(label.text, "7/20");
  const updates = label.updates;
  h.scene.refreshLockerCapacityDisplay(locker);
  assert.equal(label.updates, updates);
  locker.remove("item", 1);
  h.scene.refreshLockerCapacityDisplay(locker);
  assert.equal(label.text, "5/20");
  locker.add("single", 15);
  h.scene.refreshLockerCapacityDisplay(locker);
  assert.equal(label.text, "20/20");
});

test("a carried crate shows what is inside and, for items, the locker spaces it needs", () => {
  const h = createHarness();
  const label = {
    text: "", visible: false,
    setText(text) { this.text = text; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setDepth(depth) { this.depth = depth; return this; },
    setVisible(visible) { this.visible = visible; return this; },
    setScale(scale) { this.scale = scale; return this; },
    get displayWidth() { return (this.width ?? 0) * (this.scale ?? 1); },
  };
  h.scene.carriedCrateLabel = label;
  const sprite = { depth: 10000, getBounds: () => ({ centerX: 100, top: 52 }) };

  h.scene.refreshCarriedCrateLabel();
  assert.equal(label.visible, false);

  h.scene.carriedCrate = { kind: "item", itemId: "item", quantity: 5, sprite }; // two spaces each
  h.scene.refreshCarriedCrateLabel();
  assert.equal(label.text, "Test item\nx5 (10)");
  assert.equal(label.visible, true);
  assert.deepEqual([label.x, label.y, label.depth], [100, 50, 10001]);

  h.scene.carriedCrate = { kind: "item", itemId: "single", quantity: 1, sprite };
  h.scene.refreshCarriedCrateLabel();
  assert.equal(label.text, "Test item\nx1 (1)");

  // Near the screen's left edge the label shifts right so none of it is cut off.
  h.scene.cameras = { main: { worldView: { x: 0, right: 1000 } } };
  label.width = 300;
  h.scene.refreshCarriedCrateLabel();
  assert.equal(label.x, 152);

  // Zoomed in 2x, the label is drawn at half size so it looks the same on screen.
  h.scene.cameras.main.zoom = 2;
  h.scene.refreshCarriedCrateLabel();
  assert.equal(label.scale, 0.5);
  assert.equal(label.x, 100); // half as wide, so it fits without being nudged right
  delete h.scene.cameras;

  h.scene.carriedCrate = { kind: "fixture", typeId: "shelf_universal", quantity: 1, sprite };
  h.scene.refreshCarriedCrateLabel();
  assert.equal(label.text, `${getFixtureType("shelf_universal").name} fixture`);
  assert.equal(label.visible, true);

  h.scene.carriedCrate = null;
  h.scene.refreshCarriedCrateLabel();
  assert.equal(label.visible, false);
});

test("locker labels follow layout changes and are destroyed with the fixture", () => {
  const h = createHarness();
  const locker = drawLocker(h.scene);
  const label = locker.capacityLabel;
  h.scene.fixtures = {
    get: () => locker,
    all: () => [locker],
    clear: () => [locker],
  };
  h.scene.room = { worldX: (gx) => gx * 64 + 32, worldY: (gy) => gy * 64 + 32 };
  h.scene.applyFixtureLayout([{ id: "locker", gx: 3, gy: 4 }], {
    access: new Map([["locker", { gx: 3, gy: 6 }]]), blockedCells: [], queueCells: [],
  });
  assert.deepEqual([label.x, label.y], [224, 260]);
  h.scene.despawnAllFixtures();
  assert.equal(label.destroyed, true);
  assert.equal(locker.sprite.destroyed, true);
});

for (const kind of ["item", "fixture"]) {
  test(`Space picks up a nearby ${kind} crate without stopping player movement`, () => {
    const h = createHarness();
    const pickedUp = [];
    h.scene.eventBus.on(GAME_EVENTS.CRATE_PICKED_UP, (event) => pickedUp.push(event));
    const nearby = crate({ kind });
    h.scene.restockCrates.push(nearby);
    h.handlers.get("keydown-SPACE")(keyEvent());
    assert.equal(h.scene.carriedCrate, nearby);
    assert.deepEqual(h.scene.restockCrates, []);
    assert.deepEqual(pickedUp, [{
      kind,
      itemId: kind === "item" ? "item" : null,
      typeId: kind === "fixture" ? "shelf_universal" : null,
      quantity: kind === "item" ? 5 : 1,
    }]);
    assert.deepEqual(h.scene.player.sprite.body.velocity, { x: 160, y: 0 });
    assert.equal(h.drops(), 0);

    h.handlers.get("keydown-SPACE")(keyEvent({ repeat: true }));
    assert.equal(h.scene.carriedCrate, nearby);
    assert.equal(h.drops(), 0);

    h.handlers.get("keydown-SPACE")(keyEvent());
    assert.equal(h.scene.carriedCrate, null);
    assert.equal(h.drops(), 1);
  });
}

test("Space reports moving or missing crates without opening other interactions", () => {
  const h = createHarness();
  h.scene.restockCrates.push(crate({ stationary: false }));
  h.handlers.get("keydown-SPACE")(keyEvent());
  assert.equal(h.scene.carriedCrate, null);
  assert.deepEqual(h.messages, ["Wait for crate to stop"]);

  h.scene.restockCrates = [crate({ distance: 1000 })];
  h.handlers.get("keydown-SPACE")(keyEvent());
  assert.equal(h.scene.carriedCrate, null);
  assert.equal(h.messages.at(-1), "No crate nearby");
  assert.equal(h.drops(), 0);
});

for (const kind of ["item", "fixture"]) {
  test(`Space picks up a moving, pushed ${kind} crate and the hint selects the same crate`, () => {
    const h = createHarness();
    const pushed = crate({ kind, distance: 10, stationary: false, pushed: true });
    h.scene.restockCrates = [pushed, crate({ distance: 20 }), crate({ distance: 1, stationary: false })];
    h.scene.updateCrateHint();
    assert.equal(h.scene.getCratePickupTarget().crate, pushed);
    assert.equal(h.scene.gameMessageElement.classList.contains("hidden"), false);
    assert.equal(h.scene.gameMessageElement.textContent,
      `${kind === "item" ? "Test item x5" : `${getFixtureType("shelf_universal").name} fixture`} | Space: Pick up`);
    h.handlers.get("keydown-SPACE")(keyEvent());
    assert.equal(h.scene.carriedCrate, pushed);
    assert.equal(h.scene.restockCrates.includes(pushed), false);
    assert.deepEqual(h.scene.player.sprite.body.velocity, { x: 160, y: 0 });
    assert.deepEqual(h.messages, []);
  });
}

for (const state of ["placement", "startingShift", "loadFailed", "operatingRegister"]) {
  test(`Space does not pick up crates during ${state}`, () => {
    const h = createHarness();
    h.scene.restockCrates.push(crate());
    if (state === "placement") h.scene.fixturePlacement.active = true;
    else h.scene[state] = true;
    h.handlers.get("keydown-SPACE")(keyEvent());
    assert.equal(h.scene.carriedCrate, null);
    assert.equal(h.scene.restockCrates.length, 1);
    assert.equal(h.drops(), 0);
  });
}

test("E opens fixtures or delivers carried items instead of picking up crates", () => {
  const h = createHarness();
  const nearby = crate();
  const shelf = { id: "shelf", type: "shelf_universal", gx: 1, gy: 0, standPoint: { x: 100, y: 160 } };
  h.scene.player.sprite.y = 160;
  h.scene.restockCrates.push(nearby);
  h.scene.fixtures.stockHolders = () => [shelf];
  h.scene.fixtures.register = () => ({
    sprite: { getBounds: () => ({ left: 80, right: 120, top: 80, bottom: 120 }) },
  });
  h.scene.fixtures.displayName = () => "Shelf";
  let opens = 0;
  let deliveries = 0;
  const opened = [];
  h.scene.eventBus.on(GAME_EVENTS.FIXTURE_OPENED, (event) => opened.push(event));
  h.scene.fixtureWindow = {
    uiWindow: { isOpen: false },
    openForFixture(fixture) {
      this.uiWindow.isOpen = true;
      h.scene.fixtureWindow.fixture = fixture;
      assert.equal(fixture, shelf);
      opens += 1;
    },
  };
  h.scene.tryDeliverCarriedCrate = () => { deliveries += 1; };
  h.scene.handleInteract();
  assert.equal(opens, 1);
  assert.deepEqual(opened, [{ fixtureId: "shelf", type: "shelf_universal" }]);
  assert.equal(h.scene.carriedCrate, null);
  assert.deepEqual(h.scene.restockCrates, [nearby]);
  h.scene.carriedCrate = nearby;
  h.scene.handleInteract();
  assert.equal(deliveries, 1);
});

test("E and crate delivery target the large shelf's left front, not the compact shelf beside it", () => {
  const h = createHarness();
  const compact = { id: "compact", type: "shelf_starter_2x1", gx: 7, gy: 2 };
  const large = { id: "large", type: "shelf_universal", gx: 9, gy: 2 };
  h.scene.fixtures.stockHolders = () => [compact, large];
  h.scene.player.sprite.x = 9 * TILE_SIZE + 2;
  h.scene.player.sprite.y = 4 * TILE_SIZE + 20;
  const opened = [];
  h.scene.fixtureWindow = {
    uiWindow: { isOpen: false },
    openForFixture(fixture) { opened.push(fixture); },
  };

  h.scene.handleInteract();
  assert.deepEqual(opened, [large]);
  assert.equal(h.scene.getNearbyFixture(), large);
  assert.equal(h.scene.tryOpenFixtureWindow(compact), false);

  h.scene.player.sprite.x = 7 * TILE_SIZE + 20;
  h.scene.player.sprite.y = 3 * TILE_SIZE + 20;
  h.scene.handleInteract();
  assert.deepEqual(opened, [large, compact]);

  h.scene.player.sprite.y = 3 * TILE_SIZE + 110;
  assert.equal(h.scene.getNearbyFixture(), compact);
  h.scene.player.sprite.y += 1;
  assert.equal(h.scene.getNearbyFixture(), null);
});

test("E and Q use the register target only while the player is in range", () => {
  const h = createHarness();
  h.scene.fixtures.register = () => ({
    sprite: { getBounds: () => ({ left: 80, right: 120, top: 80, bottom: 120 }) },
  });
  let registerOpens = 0;
  let goBacksOpens = 0;
  h.scene.tryOpenRegister = () => { registerOpens += 1; return true; };
  h.scene.goBacksWindow = { open: () => { goBacksOpens += 1; } };

  h.scene.handleInteract();
  h.scene.openGoBacksBin();
  assert.equal(registerOpens, 1);
  assert.equal(goBacksOpens, 1);
  assert.equal(h.scene.isPlayerNearRegister(), true);

  h.scene.player.sprite.x = 200;
  assert.equal(h.scene.isPlayerNearRegister(), false);
  h.scene.openGoBacksBin();
  assert.equal(goBacksOpens, 1);
});

test("crate deliveries use the shared transfer and report the remaining stock", () => {
  const h = createHarness({ carrying: true });
  let crateQuantity = 5;
  const carried = {
    kind: "item",
    itemId: "item",
    get quantity() { return crateQuantity; },
    set quantity(value) { crateQuantity = value; },
    getAvailableUnitsFor(itemId) { return itemId === "item" ? crateQuantity : 0; },
    remove(itemId, quantity) {
      if (itemId !== "item") return 0;
      const removed = Math.min(quantity, crateQuantity);
      crateQuantity -= removed;
      return removed;
    },
    add(itemId, quantity) {
      if (itemId !== "item") return 0;
      crateQuantity += quantity;
      return quantity;
    },
    destroy() { throw new Error("A partially delivered crate must remain carried"); },
  };
  let shelfQuantity = 0;
  const shelf = {
    type: "shelf_universal",
    getRemainingUnitsFor: () => 3 - shelfQuantity,
    add(_itemId, quantity) {
      const accepted = Math.min(quantity, 3 - shelfQuantity);
      shelfQuantity += accepted;
      return accepted;
    },
  };
  h.scene.carriedCrate = carried;
  h.scene.getNearbyFixture = () => shelf;
  h.scene.fixtureWindow = { refresh() {} };
  const events = [];
  h.scene.eventBus.on(GAME_EVENTS.INVENTORY_TRANSFERRED, (event) => events.push(event));
  h.scene.eventBus.on(GAME_EVENTS.CRATE_DELIVERY_RESULT, (event) => events.push(event));

  GameScene.prototype.tryDeliverCarriedCrate.call(h.scene);

  assert.equal(shelfQuantity, 3);
  assert.equal(carried.quantity, 2);
  assert.equal(h.scene.carriedCrate, carried);
  assert.deepEqual(events, [
    { itemId: "item", quantity: 3, source: "crate", destination: "shelf" },
    { itemId: "item", accepted: 3, remaining: 2 },
  ]);
});

function makeHovercart(capacity) {
  let quantity = 0;
  return {
    stock: [],
    getRemainingUnitsFor() { return Math.floor((capacity - quantity * 2) / 2); },
    getAvailableUnitsFor(itemId) {
      return this.stock.find((entry) => entry.itemId === itemId)?.quantity ?? 0;
    },
    add(itemId, amount) {
      const accepted = Math.min(amount, this.getRemainingUnitsFor(itemId));
      if (accepted <= 0) return 0;
      quantity += accepted;
      const entry = this.stock.find((stock) => stock.itemId === itemId);
      if (entry) entry.quantity += accepted;
      else this.stock.push({ itemId, quantity: accepted });
      return accepted;
    },
    remove(itemId, amount) {
      const entry = this.stock.find((stock) => stock.itemId === itemId);
      if (!entry) return 0;
      const removed = Math.min(entry.quantity, amount);
      entry.quantity -= removed;
      quantity -= removed;
      return removed;
    },
  };
}

function makeCarriedStockCrate(quantity) {
  return {
    kind: "item",
    itemId: "heavy",
    quantity,
    getAvailableUnitsFor(itemId) { return itemId === this.itemId ? this.quantity : 0; },
    remove(itemId, amount) {
      if (itemId !== this.itemId) return 0;
      const removed = Math.min(this.quantity, amount);
      this.quantity -= removed;
      return removed;
    },
    add(itemId, amount) {
      if (itemId !== this.itemId) return 0;
      this.quantity += amount;
      return amount;
    },
    destroy() { this.destroyed = true; },
  };
}

function addNearbyRegister(scene) {
  let goBacksOpens = 0;
  scene.fixtures.register = () => ({
    sprite: { getBounds: () => ({ left: 80, right: 120, top: 80, bottom: 120 }) },
  });
  scene.goBacksWindow = { open: () => { goBacksOpens += 1; } };
  return () => goBacksOpens;
}

test("Q unpacks a carried stock crate, then opens Go-Backs on the next press", () => {
  const h = createHarness({ carrying: true });
  const goBacksOpens = addNearbyRegister(h.scene);
  const carried = makeCarriedStockCrate(2);
  h.scene.carriedCrate = carried;
  h.scene.playerState.hovercart = makeHovercart(4);
  h.scene.bindSecondaryInteractKey();
  assert.equal(h.handlers.has("keydown-U"), false);
  const pressQ = h.handlers.get("keydown-Q");

  pressQ(keyEvent());
  assert.equal(h.scene.carriedCrate, null);
  assert.equal(carried.destroyed, true);
  assert.deepEqual(h.scene.playerState.hovercart.stock, [{ itemId: "heavy", quantity: 2 }]);
  assert.equal(goBacksOpens(), 0);

  pressQ(keyEvent({ repeat: true }));
  assert.equal(goBacksOpens(), 0);
  pressQ(keyEvent());
  assert.equal(goBacksOpens(), 1);
});

test("Q leaves a full stock crate carried and still opens Go-Backs for fixture crates", () => {
  const h = createHarness({ carrying: true });
  const goBacksOpens = addNearbyRegister(h.scene);
  const carried = makeCarriedStockCrate(2);
  h.scene.carriedCrate = carried;
  h.scene.playerState.hovercart = makeHovercart(0);
  h.scene.bindSecondaryInteractKey();
  const pressQ = h.handlers.get("keydown-Q");

  h.scene.windowManager.windows.set("tablet", { id: "tablet", isOpen: true });
  pressQ(keyEvent());
  assert.deepEqual(h.messages, []);
  assert.equal(goBacksOpens(), 0);
  h.scene.windowManager.windows.delete("tablet");

  pressQ(keyEvent());
  assert.equal(h.scene.carriedCrate, carried);
  assert.equal(carried.quantity, 2);
  assert.equal(h.messages.at(-1), "Hovercart full; 2 items remain in the box");
  assert.equal(goBacksOpens(), 0);

  h.scene.carriedCrate = crate({ kind: "fixture" });
  pressQ(keyEvent());
  assert.equal(goBacksOpens(), 1);
});

test("controller Y uses the same stock-crate and Go-Backs choices as Q", () => {
  const h = createHarness({ carrying: true });
  const goBacksOpens = addNearbyRegister(h.scene);
  const carried = makeCarriedStockCrate(5);
  h.scene.carriedCrate = carried;
  h.scene.playerState.hovercart = makeHovercart(4);
  h.scene.padInput = { poll() {}, hadInput: false, justPressed: (button) => button === PAD.Y };
  h.scene.checkoutWindow = { usesChitInput: () => false, usesSpaceKey: () => false };
  h.scene.uiNavigator = { handle: () => false };

  h.scene.handleGamepad(0, 16);
  assert.equal(carried.quantity, 3);
  assert.deepEqual(h.scene.playerState.hovercart.stock, [{ itemId: "heavy", quantity: 2 }]);
  assert.equal(goBacksOpens(), 0);

  h.scene.carriedCrate = crate({ kind: "fixture" });
  h.scene.handleGamepad(16, 16);
  assert.equal(goBacksOpens(), 1);
});

test("unpacking puts what fits into the hovercart and leaves the rest in the carried box", () => {
  const h = createHarness({ carrying: true });
  const carried = makeCarriedStockCrate(5);
  const hovercart = makeHovercart(4);
  let notifications = 0;
  h.scene.carriedCrate = carried;
  h.scene.playerState.hovercart = hovercart;
  h.scene.playerState.notifyListeners = () => { notifications += 1; };
  const transfers = [];
  h.scene.eventBus.on(GAME_EVENTS.INVENTORY_TRANSFERRED, (event) => transfers.push(event));

  assert.equal(GameScene.prototype.unpackCarriedCrate.call(h.scene), true);

  assert.deepEqual(hovercart.stock, [{ itemId: "heavy", quantity: 2 }]);
  assert.equal(carried.quantity, 3);
  assert.equal(h.scene.carriedCrate, carried);
  assert.equal(carried.destroyed, undefined);
  assert.equal(notifications, 1);
  assert.deepEqual(transfers, [{
    itemId: "heavy", quantity: 2, source: "crate", destination: "hovercart",
  }]);
  assert.deepEqual(h.messages, ["Added 2 items to your hovercart; 3 remain in the box"]);
});

test("unpacking an entire crate clears it, and a full hovercart leaves it untouched", () => {
  const h = createHarness({ carrying: true });
  const carried = makeCarriedStockCrate(2);
  h.scene.carriedCrate = carried;
  h.scene.playerState.hovercart = makeHovercart(8);

  assert.equal(GameScene.prototype.unpackCarriedCrate.call(h.scene), true);
  assert.equal(carried.quantity, 0);
  assert.equal(carried.destroyed, true);
  assert.equal(h.scene.carriedCrate, null);
  assert.deepEqual(h.messages, ["Added 2 items to your hovercart"]);

  const full = makeCarriedStockCrate(2);
  h.scene.carriedCrate = full;
  h.scene.playerState.hovercart = makeHovercart(0);
  assert.equal(GameScene.prototype.unpackCarriedCrate.call(h.scene), false);
  assert.equal(full.quantity, 2);
  assert.equal(full.destroyed, undefined);
  assert.equal(h.scene.carriedCrate, full);
  assert.equal(h.messages.at(-1), "Hovercart full; 2 items remain in the box");
});

test("inventory totals include active customer carts but not sold customers", () => {
  const scene = Object.create(GameScene.prototype);
  scene.fixtures = { stockHolders: () => [] };
  scene.fixtureWindow = { pendingPlacement: null };
  scene.playerState = {
    hovercart: { stock: [] },
    goBacks: { stock: [] },
  };
  scene.restockCrates = [];
  scene.carriedCrate = null;
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
  scene.fixtureWindow = { fixture: null, pendingPlacement: null, uiWindow: { close() {} } };
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
  scene.fixtureWindow = { fixture: null, pendingPlacement: null, uiWindow: { close() {} } };
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

test("a shelf with a temporarily lifted item cannot be sold or crated", () => {
  const { scene } = createHarness();
  scene.canRearrangeFixtures = () => true;
  const shelf = new ShelfFixture({ id: "shelf", placements: [] });
  shelf.type = "shelf_starter_2x1";
  scene.fixtureWindow = { fixture: shelf, pendingPlacement: { moving: { quantity: 1 } } };
  assert.match(scene.getFixtureSaleBlockReason(shelf), /Only empty fixtures/);
  assert.match(scene.getFixtureCrateBlockReason(shelf), /Only empty fixtures/);
  scene.fixtureWindow.pendingPlacement = null;
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
    kind: "fixture", typeId: "shelf_starter_2x1", lockedToPad: true, destroyed: false,
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
    { amount: 150, category: "fixture_sales", label: "COMPACT SHELF" },
    { amount: 90, category: "fixture_sales", label: "LOCKER" },
  ]);
});
