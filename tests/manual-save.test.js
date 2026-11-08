import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { HUDController } from "../js/logic/HUDController.js";
import { SaveManager } from "../SaveManager.js";
import { ControlMode } from "../js/logic/ControlMode.js";

let server;
let cacheDirectory;
let GameScene;
let CheckoutWindow;
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
  ({ CheckoutWindow } = await server.ssrLoadModule("/js/logic/CheckoutWindow.js"));
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

function createRegisterHarness() {
  const scene = Object.create(GameScene.prototype);
  const checkout = Object.create(CheckoutWindow.prototype);
  const tablet = { id: "manager-tablet", isOpen: false };
  checkout.uiWindow = {
    id: "checkout-window",
    isOpen: false,
    openWindow() { this.isOpen = true; },
    close() { this.isOpen = false; },
  };
  checkout.mode = null;
  checkout.openedCarts = [];
  checkout.openForCustomer = (cart, onComplete) => {
    checkout.mode = "checkout";
    checkout.onComplete = onComplete;
    checkout.openedCarts.push(cart);
    checkout.uiWindow.openWindow();
  };
  Object.assign(scene, {
    operatingRegister: true,
    registerLine: [],
    checkoutWindow: checkout,
    windowManager: { windows: new Map([
      [tablet.id, tablet], [checkout.uiWindow.id, checkout.uiWindow],
    ]) },
    layoutRegisterLine() {},
    beginRegisterSession() { this.operatingRegister = true; },
    playerState: { addToGoBacks() {} },
    employees: [],
  });
  scene.controlMode = new ControlMode(scene);
  return { scene, checkout, tablet };
}

test("actual store price edits preserve cents and explain invalid prices", () => {
  const scene = Object.create(GameScene.prototype);
  const prices = new Map([["ration", 10]]);
  const warnings = [];
  scene.playerState = { setStorePrice: (id, price) => prices.set(id, price) };
  scene.showShopMessage = (message) => warnings.push(message);
  assert.equal(scene.setStorePrice("ration", 10.23), true);
  assert.equal(prices.get("ration"), 10.23);
  for (const invalid of [0.99, 10.234, NaN, Infinity]) {
    assert.equal(scene.setStorePrice("ration", invalid), false);
    assert.equal(prices.get("ration"), 10.23);
  }
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /two decimal places/);
});

test("customers queue without opening the register or freezing patience while the tablet is open", () => {
  const { scene, checkout, tablet } = createRegisterHarness();
  tablet.isOpen = true;
  const first = { cart: [{ itemId: "rifle", price: 100 }] };
  const second = { cart: [{ itemId: "pistol", price: 50 }] };
  scene.handleJoinQueue(first);
  scene.handleJoinQueue(second);
  assert.deepEqual(scene.registerLine, [first, second]);
  assert.equal(checkout.uiWindow.isOpen, false);
  assert.deepEqual(checkout.openedCarts, []);
  assert.equal(scene.isServingCustomer(first), false);

  tablet.isOpen = false;
  scene.resumeRegisterCheckout();
  assert.equal(checkout.uiWindow.isOpen, true);
  assert.deepEqual(checkout.openedCarts, [first.cart]);
  assert.equal(scene.isServingCustomer(first), true);
});

test("hiding checkout for the tablet preserves scanned items and payment progress on return", () => {
  const { scene, checkout, tablet } = createRegisterHarness();
  const customer = { cart: [{ itemId: "rifle", price: 100 }] };
  scene.handleJoinQueue(customer);
  const onComplete = checkout.onComplete;
  checkout.paymentBuffer = "10";
  checkout.isScanning = true;
  tablet.isOpen = true;
  checkout.suspend();
  assert.equal(checkout.uiWindow.isOpen, false);
  assert.equal(checkout.isScanning, false);
  assert.equal(scene.isServingCustomer(customer), false);
  scene.resumeRegisterCheckout();
  assert.equal(checkout.uiWindow.isOpen, false);

  tablet.isOpen = false;
  scene.resumeRegisterCheckout();
  assert.equal(checkout.uiWindow.isOpen, true);
  assert.equal(checkout.onComplete, onComplete);
  assert.equal(checkout.paymentBuffer, "10");
  assert.equal(checkout.openedCarts.length, 1);
});

test("a customer leaving while the tablet is open cannot leave a stale checkout to resume", () => {
  const { scene, checkout, tablet } = createRegisterHarness();
  const first = { cart: [{ itemId: "rifle", price: 100 }] };
  const second = { cart: [{ itemId: "pistol", price: 50 }] };
  scene.handleJoinQueue(first);
  tablet.isOpen = true;
  checkout.suspend();
  scene.handleJoinQueue(second);
  scene.handleAngryLeave(first, first.cart);
  assert.equal(checkout.mode, null);
  assert.equal(checkout.onComplete, null);
  assert.equal(checkout.uiWindow.isOpen, false);
  assert.deepEqual(scene.registerLine, [second]);

  tablet.isOpen = false;
  scene.resumeRegisterCheckout();
  assert.deepEqual(checkout.openedCarts, [first.cart, second.cart]);
  assert.equal(checkout.uiWindow.isOpen, true);
});

test("the Escape that closes the tablet does not also clear the amount typed at the register", () => {
  const checkout = Object.create(CheckoutWindow.prototype);
  const consumed = { key: "Escape" };
  const visible = { classList: { contains: () => false } };
  let cleared = 0;
  Object.assign(checkout, {
    windowManager: { isConsumed: (event) => event === consumed },
    uiWindow: { element: visible },
    bodyElement: { querySelector: () => visible },
    clearBuffer: () => { cleared += 1; },
  });
  checkout.handleNumpadKeydown(consumed);
  assert.equal(cleared, 0);
  checkout.handleNumpadKeydown({ key: "Escape" });
  assert.equal(cleared, 1);
});

test("closing the tablet does not start checkout with no customers or after leaving the register", () => {
  const { scene, checkout } = createRegisterHarness();
  scene.resumeRegisterCheckout();
  assert.equal(checkout.uiWindow.isOpen, false);
  scene.operatingRegister = false;
  scene.registerLine.push({ cart: [] });
  scene.resumeRegisterCheckout();
  assert.equal(checkout.uiWindow.isOpen, false);
});

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
    "hud-start-shift-btn", "hud-end-day-btn", "hud-save-btn", "persistent-hud",
  ]) {
    elements.set(id, {
      listeners: new Map(),
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(event, handler) { this.listeners.set(event, handler); },
      removeEventListener(event) { this.listeners.delete(event); },
    });
  }
  const hudButtons = ["hud-pause-btn", "hud-start-shift-btn", "hud-end-day-btn", "hud-save-btn"]
    .map((id) => elements.get(id));
  const hudRoot = elements.get("persistent-hud");
  hudRoot.querySelectorAll = (selector) => (selector === "button" ? hudButtons : []);
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
  // Top bar buttons never hold keyboard focus, so Space stays with the game.
  assert.ok(hudButtons.every((hudButton) => hudButton.tabIndex === -1));
  let focusPrevented = false;
  hudRoot.listeners.get("mousedown")({
    target: { closest: (selector) => (selector === "button" ? button : null) },
    preventDefault() { focusPrevented = true; },
  });
  assert.equal(focusPrevented, true);
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
  assert.equal(hudRoot.listeners.size, 0);
});
