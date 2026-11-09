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
import { GAME_EVENTS } from "../js/logic/EventBus.js";
import { SupplierLicense } from "../js/logic/Licenses.js";
import { BACKROOM_UPGRADE_ORDER, EXPANSION_ORDER, ZONES } from "../js/logic/RoomLayout.js";

let server;
let cacheDirectory;
let GameScene;
let CheckoutWindow;
let PlayerState;
const originalPhaser = globalThis.Phaser;

before(async () => {
  globalThis.Phaser = { Scene: class {} };
  const licenses = JSON.parse(await readFile(new URL("../data/Licenses.json", import.meta.url), "utf8"));
  globalThis.__progressionTestLicenses = licenses.map((data) => new SupplierLicense(data));
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
        if (id === "\0manual-save-test-database") {
          return "export const database = { getAllLicenses: () => globalThis.__progressionTestLicenses };";
        }
      },
    }],
  });
  ({ GameScene } = await server.ssrLoadModule("/js/scenes/game.js"));
  ({ CheckoutWindow } = await server.ssrLoadModule("/js/logic/CheckoutWindow.js"));
  ({ PlayerState } = await server.ssrLoadModule("/js/logic/PlayerState.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
  delete globalThis.__progressionTestLicenses;
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

function createExpansionHarness({ shopLevel, credits }) {
  const scene = Object.create(GameScene.prototype);
  const playerState = new PlayerState();
  playerState.shopLevel = shopLevel;
  playerState.credits = credits;
  const messages = [];
  let cameraRefreshes = 0;
  let autosaves = 0;
  Object.assign(scene, {
    playerState,
    startingShift: false,
    loadFailed: false,
    shiftEnded: false,
    shiftClock: { started: false },
    customers: [],
    room: {
      zones: ZONES.map((zone) => ({ ...zone })),
      unlockZone(id) {
        const zone = this.zones.find((candidate) => candidate.id === id);
        zone.locked = false;
      },
    },
    refreshCamera() { cameraRefreshes++; },
    requestAutosave() { autosaves++; },
    showShopMessage(message) { messages.push(message); },
  });
  return {
    scene,
    messages,
    get cameraRefreshes() { return cameraRefreshes; },
    get autosaves() { return autosaves; },
  };
}

test("store expansions require their level, credits, and previous purchases", () => {
  const locked = createExpansionHarness({ shopLevel: 4, credits: 5000 });
  assert.equal(locked.scene.getExpansionPurchaseOptions()[0].levelMet, false);
  assert.equal(locked.scene.buyExpansion("expansion_west"), false);
  assert.equal(locked.scene.playerState.credits, 5000);
  assert.match(locked.messages[0], /Shop Level 5/);

  const poor = createExpansionHarness({ shopLevel: 5, credits: 3999 });
  assert.equal(poor.scene.buyExpansion("expansion_west"), false);
  assert.equal(poor.scene.room.zones.find((zone) => zone.id === "expansion_west").locked, true);
  assert.equal(poor.scene.playerState.credits, 3999);

  const open = createExpansionHarness({ shopLevel: 5, credits: 4000 });
  open.scene.shiftClock.started = true;
  assert.equal(open.scene.buyExpansion("expansion_west"), false);
  assert.equal(open.scene.playerState.credits, 4000);
  assert.match(open.messages[0], /while the store is closed/);

  const wrongOrder = createExpansionHarness({ shopLevel: 30, credits: 100000 });
  assert.equal(wrongOrder.scene.buyExpansion("expansion_a"), false);
  assert.equal(wrongOrder.scene.playerState.credits, 100000);
  assert.match(wrongOrder.messages[0], /in order/);
});

test("buying the first store expansion deducts credits and records a receipt line", () => {
  const harness = createExpansionHarness({ shopLevel: 5, credits: 4000 });
  const { scene } = harness;
  assert.equal(scene.getExpansionPurchaseOptions()[0].canAfford, true);
  assert.equal(scene.buyExpansion("expansion_west"), true);
  assert.equal(scene.playerState.credits, 0);
  assert.equal(scene.room.zones.find((zone) => zone.id === EXPANSION_ORDER[0]).locked, false);
  assert.deepEqual(scene.playerState.dayLedger.serialize().lines, [{
    category: "expansions",
    label: "Sales Floor Expansion West",
    amount: -4000,
    quantity: 1,
  }]);
  assert.equal(harness.cameraRefreshes, 1);
  assert.equal(harness.autosaves, 1);
});

test("backroom expansions require their level, credits, and previous purchases", () => {
  const locked = createExpansionHarness({ shopLevel: 12, credits: 20000 });
  assert.equal(locked.scene.getBackroomPurchaseOptions()[0].levelMet, false);
  assert.equal(locked.scene.buyBackroomUpgrade(BACKROOM_UPGRADE_ORDER[0]), false);
  assert.match(locked.messages[0], /Shop Level 13/);

  const poor = createExpansionHarness({ shopLevel: 13, credits: 3999 });
  assert.equal(poor.scene.buyBackroomUpgrade(BACKROOM_UPGRADE_ORDER[0]), false);
  assert.equal(poor.scene.playerState.credits, 3999);
  assert.match(poor.messages[0], /costs 4,000 credits/);

  const wrongOrder = createExpansionHarness({ shopLevel: 27, credits: 20000 });
  assert.equal(wrongOrder.scene.buyBackroomUpgrade(BACKROOM_UPGRADE_ORDER[1]), false);
  assert.match(wrongOrder.messages[0], /in order/);
});

test("buying all backroom expansions records costs and opens the wider room", () => {
  const harness = createExpansionHarness({ shopLevel: 27, credits: 19000 });
  const { scene } = harness;
  for (const id of BACKROOM_UPGRADE_ORDER) {
    assert.equal(scene.buyBackroomUpgrade(id), true);
  }
  assert.equal(scene.playerState.credits, 0);
  assert.ok(BACKROOM_UPGRADE_ORDER.every((id) =>
    !scene.room.zones.find((zone) => zone.id === id).locked));
  assert.deepEqual(scene.playerState.dayLedger.serialize().lines.map((line) => line.amount), [
    -4000, -6000, -9000,
  ]);
  assert.equal(harness.cameraRefreshes, 3);
  assert.equal(harness.autosaves, 3);
});

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

test("the shift-end event, receipt, and save observers see the applied reputation and level", () => {
  const scene = Object.create(GameScene.prototype);
  const state = new PlayerState();
  const events = [];
  const messages = [];
  const savedStates = [];
  Object.assign(scene, {
    playerState: state,
    customersServedThisShift: 16,
    customers: [],
    loadFailed: false,
    startingShift: false,
    shiftEnded: false,
    shiftClock: { started: true, isPaused: false, notifyListeners() {} },
    room: { zones: ZONES },
    market: { day: 1 },
    fixturePlacement: { active: false },
    eventBus: { emit: (name, details) => events.push({ name, details }) },
    clearEmployees() {},
    showGameMessage: (message) => messages.push(message),
  });
  state.subscribe((current) => {
    if (current.awaitingEndDay && scene.canSaveOffShift()) {
      savedStates.push(current.serialize());
    }
  });
  state.addReputation(16, "scavengers");
  state.subReputation(1, "mercenaries");
  assert.equal(state.globalReputation, 0);
  assert.equal(scene.getFinancesView().pendingReputationChange, 15);

  scene.endShift();
  assert.equal(state.globalReputation, 15);
  assert.equal(state.shopLevel, 2);
  assert.equal(scene.shiftClock.started, false);
  assert.deepEqual(events, [{
    name: GAME_EVENTS.SHIFT_ENDED,
    details: {
      served: 16,
      turnedAway: 0,
      reputation: 15,
      factionReputation: { scavengers: 16, mercenaries: -1, explorers: 0 },
    },
  }]);
  assert.equal(scene.getFinancesView().today.reputationChange, 15);
  assert.equal(scene.getFinancesView().pendingReputationChange, null);
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0].globalReputation, 15);
  assert.equal(savedStates[0].shopLevel, 2);
  assert.match(messages[0], /Shop Level 2 reached/);
  assert.match(messages[0], /Civilian Threads.*Contracts tab/);
  assert.doesNotMatch(messages[0], /Staff unlocked|Employee tab/);
});

test("a shift that earns multiple levels announces each implemented unlock", () => {
  const state = new PlayerState();
  const scene = Object.create(GameScene.prototype);
  const messages = [];
  Object.assign(scene, {
    playerState: state,
    customersServedThisShift: 60,
    shiftEnded: false,
    shiftClock: { started: true, isPaused: false, notifyListeners() {} },
    room: { zones: ZONES },
    eventBus: { emit() {} },
    clearEmployees() {},
    showGameMessage: (message) => messages.push(message),
  });
  state.addReputation(60);
  scene.endShift();
  assert.equal(state.shopLevel, 4);
  assert.match(messages[0], /Shop Level 4 reached/);
  assert.match(messages[0], /Civilian Threads/);
  assert.match(messages[0], /Expanded Fixture Supply/);
  assert.match(messages[0], /Staff unlocked: Tavi.*Employee tab/);

  state.endDay(2);
  state.addReputation(30);
  scene.endShift();
  assert.equal(state.shopLevel, 5);
  assert.match(messages[1], /Shop Level 5 reached/);
  assert.doesNotMatch(messages[1], /Contracts unlocked|Staff unlocked/);
  assert.match(messages[1], /Sales-floor expansion available to buy in the Layout tab/);
  assert.doesNotMatch(messages[1], /Some later level rewards are not in the game yet/);

  state.endDay(3);
  state.addReputation(35);
  scene.endShift();
  assert.equal(state.shopLevel, 6);
  assert.match(messages[2], /Shop Level 6 reached/);
  assert.match(messages[2], /Stellaris Civilian Defense.*Contracts tab/);
  assert.doesNotMatch(messages[2], /Some later level rewards are not in the game yet/);
});

test("a shift from Shop Level 6 to 30 announces all remaining reward types", () => {
  const state = new PlayerState();
  state.shopLevel = 6;
  state.globalReputation = 125;
  const scene = Object.create(GameScene.prototype);
  const messages = [];
  Object.assign(scene, {
    playerState: state,
    customersServedThisShift: 60,
    shiftClock: { started: true, isPaused: false, notifyListeners() {} },
    room: { zones: ZONES.map((zone) => ({ ...zone })) },
    eventBus: { emit() {} },
    clearEmployees() {},
    showGameMessage: (message) => messages.push(message),
  });
  state.addReputation(2340);
  scene.endShift();

  assert.equal(state.shopLevel, 30);
  assert.match(messages[0], /Sera.*Dax.*Ivo.*Rhea.*Kel/);
  assert.match(messages[0], /Premium Shelf Supply/);
  assert.match(messages[0], /Hazard & Medical Supply/);
  assert.match(messages[0], /Armory Display Supply/);
  assert.match(messages[0], /Sales-floor expansions available to buy/);
  assert.match(messages[0], /Backroom expansions available to buy/);
  assert.doesNotMatch(messages[0], /Some later level rewards are not in the game yet/);
});

test("level-up messages do not reannounce contracts or staff already owned in older saves", () => {
  const state = new PlayerState();
  state.activeLicenses.add("lic_start_apparel");
  state.hiredEmployees.push("tavi_stock_clerk");
  const scene = Object.create(GameScene.prototype);
  const messages = [];
  Object.assign(scene, {
    playerState: state,
    customersServedThisShift: 60,
    shiftClock: { started: true, isPaused: false, notifyListeners() {} },
    room: { zones: ZONES },
    eventBus: { emit() {} },
    clearEmployees() {},
    showGameMessage: (message) => messages.push(message),
  });
  state.addReputation(60);
  scene.endShift();
  assert.match(messages[0], /Expanded Fixture Supply/);
  assert.doesNotMatch(messages[0], /Civilian Threads|Staff unlocked/);
});

test("the actual hire action explains the level lock and allows hiring after the unlock", () => {
  const scene = Object.create(GameScene.prototype);
  const state = new PlayerState();
  const warnings = [];
  let autosaves = 0;
  Object.assign(scene, {
    playerState: state,
    canHireEmployees: () => true,
    showShopMessage: (message) => warnings.push(message),
    showGameMessage() {},
    requestAutosave: () => { autosaves += 1; },
  });
  assert.equal(scene.hireEmployee("tavi_stock_clerk"), false);
  assert.match(warnings[0], /Shop Level 4.*60 store reputation/);
  assert.equal(state.credits, 1500);
  assert.equal(autosaves, 0);

  state.addReputation(60);
  state.finishShift({ customersServed: 60, customersTurnedAway: 0 });
  assert.equal(scene.hireEmployee("tavi_stock_clerk"), true);
  assert.equal(state.credits, 1250);
  assert.equal(autosaves, 1);
});

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
    "hud-credits", "hud-rep", "hud-shop-level", "hud-hovercart", "hud-shift-time", "hud-pause-btn",
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
      callback({ credits: 436, globalReputation: 2, shopLevel: 1, hovercart: { usedCapacity: () => 0, capacity: 10 } });
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
