import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let server;
let cacheDirectory;
let GameScene;
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
          return 'export const database = { getItem: (id) => ({ id, name: "Test item" }) };';
        }
      },
    }],
  });
  ({ GameScene } = await server.ssrLoadModule("/js/scenes/game.js"));
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
  scene.fixturePlacement = { active: false };
  scene.player = { sprite: { x: 100, y: 100, body: { velocity: { x: 160, y: 0 } } } };
  scene.playerState = { notifyListeners() {} };
  scene.restockCrates = [];
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
  return { scene, messages, handlers, removedCaptures, drops: () => drops };
}

function crate({ kind = "item", distance = 20, stationary = true } = {}) {
  return {
    kind,
    itemId: "item",
    typeId: "shelf_universal",
    quantity: 5,
    distanceTo: () => distance,
    isStationary: () => stationary,
    pickUp: () => stationary,
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

test("Space drops once per press and Q is no longer bound", () => {
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
  h.scene.carriedCrate = carried;
  assert.equal(GameScene.prototype.dropCarriedCrate.call(h.scene), true);
  assert.equal(h.scene.carriedCrate, null);
  assert.deepEqual(h.scene.restockCrates, [carried]);
  assert.deepEqual(h.messages, []);
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
      `${kind === "item" ? "Test item x5" : "SHELF fixture"} | Space: Pick up`);
    assert.equal(h.scene.gameMessageElement.classList.contains("context-message"), true);
    h.scene.tryPickUpNearestCrate();
    assert.equal(h.scene.carriedCrate, target);
    assert.deepEqual(h.messages, []);
    h.scene.updateCrateHint();
    assert.equal(h.scene.gameMessageElement.classList.contains("hidden"), true);
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

for (const state of ["outOfRange", "moving", "carrying", "operatingRegister", "placement", "startingShift", "loadFailed"]) {
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

for (const kind of ["item", "fixture"]) {
  test(`Space picks up a nearby ${kind} crate without stopping player movement`, () => {
    const h = createHarness();
    const nearby = crate({ kind });
    h.scene.restockCrates.push(nearby);
    h.handlers.get("keydown-SPACE")(keyEvent());
    assert.equal(h.scene.carriedCrate, nearby);
    assert.deepEqual(h.scene.restockCrates, []);
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
  h.scene.restockCrates.push(nearby);
  let opens = 0;
  let deliveries = 0;
  h.scene.tryOpenFixtureWindow = () => { opens += 1; return true; };
  h.scene.tryDeliverCarriedCrate = () => { deliveries += 1; };
  h.scene.handleInteract();
  assert.equal(opens, 1);
  assert.equal(h.scene.carriedCrate, null);
  assert.deepEqual(h.scene.restockCrates, [nearby]);
  h.scene.carriedCrate = nearby;
  h.scene.handleInteract();
  assert.equal(deliveries, 1);
});
