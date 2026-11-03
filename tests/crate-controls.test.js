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
  const messages = [];
  scene.showFloatingText = (x, y, text) => messages.push(text);
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
