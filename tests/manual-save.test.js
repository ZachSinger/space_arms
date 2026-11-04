import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { HUDController } from "../js/logic/HUDController.js";
import { SaveManager } from "../SaveManager.js";

let server;
let cacheDirectory;
let GameScene;
const originalPhaser = globalThis.Phaser;

before(async () => {
  globalThis.Phaser = { Scene: class {} };
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-manual-save-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    plugins: [{
      name: "manual-save-test-database",
      enforce: "pre",
      resolveId(source) {
        if (source === "./boot.js" || source === "../scenes/boot.js") {
          return "\0manual-save-test-database";
        }
      },
      load(id) {
        if (id === "\0manual-save-test-database") return "export const database = {};";
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

function createHarness(write = async () => true) {
  const scene = Object.create(GameScene.prototype);
  const messages = [];
  const errors = [];
  const writes = [];
  const controls = [];
  Object.assign(scene, {
    loadFailed: false,
    startingShift: false,
    shiftEnded: false,
    shiftClock: { started: false },
    customers: [],
    autosaveBlocked: false,
    saveInProgress: null,
    lastSavedSnapshot: null,
    saveStatus: "Not saved yet",
    credits: 436,
    hud: { renderSaveState: (state) => controls.push(state) },
    serialize: () => ({ credits: scene.credits }),
    showShopMessage: (message) => messages.push(message),
    handlePersistenceError: (error) => {
      errors.push(error);
      scene.autosaveBlocked = true;
      scene.setSaveStatus(`Not saved: ${error.message}`);
    },
  });
  scene.saveManager = new SaveManager({ shop: scene }, {
    write: async (payload) => {
      writes.push(payload);
      return write(payload);
    },
  });
  return { scene, messages, errors, writes, controls };
}

test("manual save persists the current shop and confirms unchanged saves without another write", async () => {
  const { scene, writes, messages, controls } = createHarness();
  await scene.saveManually();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].data.shop, { credits: 436 });
  assert.equal(scene.lastSavedSnapshot, JSON.stringify({ credits: 436 }));
  assert.deepEqual(messages, ["Game saved."]);
  assert.equal(controls.at(-1).canSave, true);
  assert.equal(controls.at(-1).saving, false);

  await scene.saveManually();
  assert.equal(writes.length, 1);
  assert.equal(messages.at(-1), "Game saved.");
});

test("manual save shows busy controls until the write finishes", async () => {
  let finishWrite;
  const { scene, controls, messages } = createHarness(() =>
    new Promise((resolve) => { finishWrite = resolve; }),
  );
  const saving = scene.saveManually();
  assert.equal(controls.at(-1).saving, true);
  assert.equal(messages.length, 0);

  finishWrite(true);
  await saving;
  assert.equal(controls.at(-1).saving, false);
  assert.equal(messages.at(-1), "Game saved.");
});

test("manual save failures use the save error path and never confirm success", async () => {
  const failure = new Error("Disk full");
  const { scene, errors, messages, controls } = createHarness(async () => { throw failure; });
  await scene.saveManually();
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(messages, []);
  assert.equal(scene.lastSavedSnapshot, null);
  assert.equal(scene.saveInProgress, null);
  assert.equal(controls.at(-1).saving, false);
  assert.match(scene.saveStatus, /Disk full/);
});

test("manual saving stays blocked mid-shift, while starting a shift, and after a load error", async () => {
  for (const flags of [
    { shiftClock: { started: true, isPaused: false } },
    { shiftClock: { started: true, isPaused: true } },
    { startingShift: true },
    { loadFailed: true },
  ]) {
    const { scene, writes, messages, controls } = createHarness();
    Object.assign(scene, flags);
    scene.updateSaveControls();
    assert.equal(controls.at(-1).canSave, false);
    await scene.saveManually();
    assert.equal(writes.length, 0);
    assert.equal(messages.length, 1);
    assert.doesNotMatch(messages[0], /Game saved/);
  }
});

test("HUD Save button is wired, reflects availability, and removes its handler on destroy", async (context) => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="hud-save-btn"/);
  const elements = new Map();
  for (const id of [
    "hud-credits", "hud-rep", "hud-hovercart", "hud-shift-time", "hud-pause-btn",
    "hud-start-shift-btn", "hud-save-btn", "persistent-hud",
  ]) {
    elements.set(id, {
      listeners: new Map(),
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(event, handler) { this.listeners.set(event, handler); },
      removeEventListener(event) { this.listeners.delete(event); },
    });
  }
  const originalDocument = globalThis.document;
  globalThis.document = { getElementById: (id) => elements.get(id) };
  context.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  let saves = 0;
  const hud = new HUDController({
    subscribe(callback) {
      callback({ credits: 436, globalReputation: 2, hovercart: { usedCapacity: () => 0, capacity: 10 } });
    },
  }, {
    subscribe(callback) { callback({ started: false, isPaused: true, softClosed: false }); },
  }, () => {}, () => { saves += 1; });
  const button = elements.get("hud-save-btn");
  assert.equal(button.disabled, true);
  hud.renderSaveState({ canSave: true, saving: false, status: "Saved." });
  assert.equal(button.disabled, false);
  button.listeners.get("click")();
  assert.equal(saves, 1);

  hud.renderSaveState({ canSave: true, saving: true, status: "Saving..." });
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "SAVING...");
  hud.renderSaveState({
    canSave: false, saving: false, unavailableReason: "Finish the shift before saving.",
  });
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "SAVE");
  assert.match(button.title, /Finish the shift/);
  hud.destroy();
  assert.equal(button.listeners.size, 0);
});
