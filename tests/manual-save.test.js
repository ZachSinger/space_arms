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
import { ContractRenderer } from "../js/logic/ContractRenderer.js";
import { BACKROOM_UPGRADE_ORDER, EXPANSION_ORDER, ZONES } from "../js/logic/RoomLayout.js";
import { FIXTURE_TYPES, fixtureBounds, fixtureFacingStep, fixtureFootprint, positionRegisterQueue } from "../js/logic/FixtureLayout.js";

let server;
let cacheDirectory;
let GameScene;
let CheckoutWindow;
let PlayerState;
let CHARACTER_ART_WIDTH;
let CHARACTER_FEET_DROP;
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
  ({ CHARACTER_ART_WIDTH, CHARACTER_FEET_DROP } = await server.ssrLoadModule("/js/logic/CustomerSprites.js"));
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

test("fixtures can be placed during a closed mid-shift without unlocking saving or expansions", () => {
  const { scene } = createHarness();
  assert.equal(scene.canRearrangeFixtures(), true);
  Object.assign(scene.shiftClock, { started: true, isPaused: false, softClosed: false });
  scene.customers.push({});
  assert.equal(scene.canRearrangeFixtures(), false);
  scene.storeTemporarilyClosed = true;
  assert.equal(scene.canRearrangeFixtures(), true);
  assert.equal(scene.canSaveOffShift(), false);
  assert.equal(scene.canExpandStore(), false);
  scene.shiftClock.isPaused = true;
  assert.equal(scene.canRearrangeFixtures(), false);
  scene.shiftClock.isPaused = false;
  scene.startingShift = true;
  assert.equal(scene.canRearrangeFixtures(), false);
  scene.startingShift = false;
  scene.storeTemporarilyClosed = false;
  scene.shiftClock.softClosed = true;
  assert.equal(scene.canRearrangeFixtures(), true);
});

test("pause consumes menu, mouse and keyboard actions, leaving only resume available", () => {
  const { scene } = createHarness();
  scene.shiftClock.started = true;
  scene.shiftClock.isPaused = true;
  scene.shiftClock.togglePause = () => { scene.shiftClock.isPaused = !scene.shiftClock.isPaused; };
  scene.controlMode = new ControlMode(scene);
  const event = (type, options = {}) => ({
    type, blocked: false, prevented: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.blocked = true; },
    ...options,
  });
  for (const input of [
    event("keydown", { code: "KeyE" }),
    event("keydown", { code: "Tab" }),
    event("keydown", { code: "KeyP", repeat: true }),
    ...["pointerdown", "mousedown", "click", "dblclick", "wheel", "contextmenu", "touchstart", "touchmove", "pointermove"].map((type) => event(type)),
  ]) {
    scene.handlePausedInput(input);
    assert.equal(input.blocked, true, input.type);
    assert.equal(input.prevented, true, input.type);
    assert.equal(scene.shiftClock.isPaused, true);
  }
  const resumeClick = event("click", { target: { closest: () => ({}) } });
  scene.handlePausedInput(resumeClick);
  assert.equal(resumeClick.blocked, false);
  for (const key of [{ code: "KeyP" }, { key: "Escape" }]) {
    scene.shiftClock.isPaused = true;
    const resumeKey = event("keydown", key);
    scene.handlePausedInput(resumeKey);
    assert.equal(resumeKey.blocked, true, "resume must not also close an open window");
    assert.equal(scene.shiftClock.isPaused, false);
  }
  const normalClick = event("click");
  scene.handlePausedInput(normalClick);
  assert.equal(normalClick.blocked, false);
});

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
  assert.match(poor.messages[0], /costs 4,000\./);

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

test("debug upgrade buttons open the next zone free, even at Level 1 with the store open", () => {
  const harness = createExpansionHarness({ shopLevel: 1, credits: 0 });
  const { scene } = harness;
  scene.shiftClock.started = true;
  for (const [order, area] of [[EXPANSION_ORDER, "sales floor"], [BACKROOM_UPGRADE_ORDER, "backroom"]]) {
    for (const id of order) {
      assert.equal(scene.debugUnlockNextZone(order, area), true);
      assert.equal(scene.room.zones.find((zone) => zone.id === id).locked, false);
    }
    assert.equal(scene.debugUnlockNextZone(order, area), false);
    assert.match(harness.messages.at(-1), new RegExp(`Every ${area} upgrade is already open`));
  }
  assert.equal(scene.playerState.credits, 0);
});

test("the placement grid toggle stays hidden outside placement and independent of the tile grid", () => {
  const scene = Object.create(GameScene.prototype);
  const created = [];
  scene.debugGridOverlays = new Map();
  scene.fixturePlacement = { active: false };
  scene.add = {
    graphics() {
      const graphics = {
        visible: true,
        lines: [],
        clear() { return this; },
        setDepth(depth) { this.depth = depth; return this; },
        lineStyle(...style) { this.style = style; return this; },
        lineBetween(...line) { this.lines.push(line); return this; },
        setVisible(visible) { this.visible = visible; return this; },
      };
      created.push(graphics);
      return graphics;
    },
  };

  scene.toggleDebugGrid(8, 0x00ff00, 1);
  const fine = created[0];
  assert.equal(fine.visible, false);
  assert.equal(scene.debugPlacementGrid.enabled, true);
  assert.equal(fine.depth, 9998);

  scene.toggleDebugGrid();
  const coarse = created[1];
  assert.equal(coarse.visible, true);
  assert.deepEqual(coarse.style, [1, 0x00ffff, 0.5]);
  scene.toggleDebugGrid(8, 0x00ff00, 1);
  assert.equal(fine.visible, false);
  assert.equal(scene.debugPlacementGrid.enabled, false);
  assert.equal(coarse.visible, true);
  scene.toggleDebugGrid(8, 0x00ff00, 1);
  assert.equal(scene.debugPlacementGrid.enabled, true);
  assert.equal(created.length, 2);
});

test("temporarily closing the store pauses arrivals and reschedules them on reopening", () => {
  let elapsedMs = 0;
  const spawned = [];
  const storeStates = [];
  const messages = [];
  const scene = Object.create(GameScene.prototype);
  Object.assign(scene, {
    storeTemporarilyClosed: false,
    storeTemporarilyClosedSinceMs: null,
    shiftClock: {
      started: true,
      softClosed: false,
      isPaused: false,
      getElapsedMs: () => elapsedMs,
    },
    customerArrivalSchedule: [
      { factionId: "mercenaries", atMs: 1000 },
      { factionId: "explorers", atMs: 5000 },
    ],
    nextScheduledArrival: 0,
    spawnCustomer: (factionId) => spawned.push(factionId),
    hud: { renderStoreStatus: (closed) => storeStates.push(closed) },
    showGameMessage: (message) => messages.push(message),
  });

  assert.equal(scene.toggleTemporaryStoreClosure(), true);
  elapsedMs = 3000;
  scene.spawnScheduledCustomers();
  assert.deepEqual(spawned, []);
  assert.equal(scene.nextScheduledArrival, 0);
  assert.equal(scene.shiftClock.isPaused, false);

  assert.equal(scene.toggleTemporaryStoreClosure(), true);
  assert.deepEqual(scene.customerArrivalSchedule.map(({ atMs }) => atMs), [4000, 8000]);
  assert.deepEqual(storeStates, [true, false]);
  assert.match(messages[0], /Customers inside can finish shopping/);

  elapsedMs = 4000;
  scene.spawnScheduledCustomers();
  elapsedMs = 8000;
  scene.spawnScheduledCustomers();
  assert.deepEqual(spawned, ["mercenaries", "explorers"]);
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
    checkout.cart = cart;
    checkout.onComplete = onComplete;
    checkout.openedCarts.push(cart);
    checkout.uiWindow.openWindow();
  };
  const registerFixture = { id: "register_1", sprite: {} };
  const line = [];
  Object.assign(scene, {
    operatingRegister: true,
    operatingRegisterFixture: registerFixture,
    registerLine: line,
    registerLines: new Map([[registerFixture.id, line]]),
    fixtures: {
      register: () => registerFixture,
      registers: () => [registerFixture],
      get: (id) => id === registerFixture.id ? registerFixture : undefined,
    },
    checkoutWindow: checkout,
    windowManager: { windows: new Map([
      [tablet.id, tablet], [checkout.uiWindow.id, checkout.uiWindow],
    ]) },
    layoutRegisterLine() {},
    beginRegisterSession(register = registerFixture) {
      this.operatingRegister = true;
      this.operatingRegisterFixture = register;
    },
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
    hud: { renderStoreStatus() {} },
    room: { zones: ZONES },
    market: { day: 1 },
    fixturePlacement: { active: false },
    eventBus: { emit: (name, details) => events.push({ name, details }) },
    clearEmployees() {},
    getEmergencyLoanOffer: () => ({ available: false, amount: 0, repayTotal: 0 }),
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
  assert.match(messages[0], /Frontier Survival Kit.*Contracts tab/);
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
    hud: { renderStoreStatus() {} },
    room: { zones: ZONES },
    eventBus: { emit() {} },
    clearEmployees() {},
    showGameMessage: (message) => messages.push(message),
  });
  state.addReputation(72);
  scene.endShift();
  assert.equal(state.shopLevel, 4);
  assert.match(messages[0], /Shop Level 4 reached/);
  assert.match(messages[0], /Standard Pistol Ammo/);
  assert.match(messages[0], /You can now have 1 employee hired at once \(Employee tab\)/);

  state.endDay(2);
  state.addReputation(42);
  scene.endShift();
  assert.equal(state.shopLevel, 5);
  assert.match(messages[1], /Shop Level 5 reached/);
  assert.doesNotMatch(messages[1], /Contracts unlocked|employees? hired at once/);
  assert.match(messages[1], /Sales-floor expansion available to buy in the Layout tab/);
  assert.doesNotMatch(messages[1], /Some later level rewards are not in the game yet/);

  state.endDay(3);
  state.addReputation(51);
  scene.endShift();
  assert.equal(state.shopLevel, 6);
  assert.match(messages[2], /Shop Level 6 reached/);
  assert.match(messages[2], /Lyra Casual Wear.*Contracts tab/);
  assert.doesNotMatch(messages[2], /Some later level rewards are not in the game yet/);
});

test("a shift from Shop Level 6 to 30 announces all remaining reward types", () => {
  const state = new PlayerState();
  state.shopLevel = 6;
  state.globalReputation = 165;
  const scene = Object.create(GameScene.prototype);
  const messages = [];
  Object.assign(scene, {
    playerState: state,
    customersServedThisShift: 60,
    shiftClock: { started: true, isPaused: false, notifyListeners() {} },
    hud: { renderStoreStatus() {} },
    room: { zones: ZONES.map((zone) => ({ ...zone })) },
    eventBus: { emit() {} },
    clearEmployees() {},
    showGameMessage: (message) => messages.push(message),
  });
  state.addReputation(3924);
  scene.endShift();

  assert.equal(state.shopLevel, 30);
  assert.match(messages[0], /You can now have 6 employees hired at once/);
  assert.match(messages[0], /Breach-Tech Heavy Tools/);
  assert.match(messages[0], /Sales-floor expansions available to buy/);
  assert.match(messages[0], /Backroom expansions available to buy/);
  assert.doesNotMatch(messages[0], /Some later level rewards are not in the game yet/);
});

test("level-up messages do not reannounce contracts or staff already owned in older saves", () => {
  const state = new PlayerState();
  for (const id of ["lic_start_survival", "lic_start_surplus", "lic_start_ammo"]) {
    state.activeLicenses.add(id);
  }
  state.hiredEmployees.push("tavi_stock_clerk");
  const scene = Object.create(GameScene.prototype);
  const messages = [];
  Object.assign(scene, {
    playerState: state,
    customersServedThisShift: 60,
    shiftClock: { started: true, isPaused: false, notifyListeners() {} },
    hud: { renderStoreStatus() {} },
    room: { zones: ZONES },
    eventBus: { emit() {} },
    clearEmployees() {},
    showGameMessage: (message) => messages.push(message),
  });
  state.addReputation(72);
  scene.endShift();
  assert.match(messages[0], /Shop Level 4 reached/);
  assert.doesNotMatch(messages[0], /Contracts unlocked|Standard Pistol Ammo|Staff unlocked/);
});

test("level 1 saves keep starting contracts signed before their level requirement changed", () => {
  const state = new PlayerState();
  for (const id of ["lic_start_surplus", "lic_start_ammo"]) state.signLicense(id);
  const restored = PlayerState.deserialize(state.serialize());
  const contracts = globalThis.__progressionTestLicenses.filter((license) =>
    ["lic_start_surplus", "lic_start_ammo"].includes(license.id));
  assert.equal(restored.shopLevel, 1);
  assert.ok(contracts.every((license) => restored.activeLicenses.has(license.id)));
  const html = ContractRenderer.generateHTML(contracts, restored);
  assert.equal((html.match(/>PURCHASED</g) ?? []).length, 2);
  assert.doesNotMatch(html, />LOCKED</);
});

test("saves from before contracts were split keep every product they could already order", () => {
  const state = new PlayerState();
  state.signLicense("lic_start_ammo");
  const { contractsSplit, ...oldSave } = state.serialize();
  assert.equal(contractsSplit, true);
  const restored = PlayerState.deserialize(oldSave);
  assert.ok(restored.activeLicenses.has("lic_start_ammo"));
  assert.ok(restored.activeLicenses.has("lic_start_rifle_ammo"));
  assert.equal(restored.activeLicenses.has("lic_start_survival"), false);

  const current = PlayerState.deserialize(state.serialize());
  assert.equal(current.activeLicenses.has("lic_start_rifle_ammo"), false,
    "new saves do not get the follow-up contract for free");
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
  assert.match(warnings[0], /Shop Level 4.*72 store reputation/);
  assert.equal(state.credits, 1500);
  assert.equal(autosaves, 0);

  state.addReputation(72);
  state.finishShift({ customersServed: 72, customersTurnedAway: 0 });
  assert.equal(scene.hireEmployee("tavi_stock_clerk"), true);
  assert.equal(state.credits, 1250);
  assert.equal(autosaves, 1);
});

test("taking an employee off shift is between shifts only, stops wages, and keeps them hired", () => {
  const state = new PlayerState();
  state.shopLevel = 4;
  assert.equal(state.hireEmployee("tavi_stock_clerk"), true);
  const creditsAfterHire = state.credits;
  const scene = Object.create(GameScene.prototype);
  const warnings = [];
  const messages = [];
  let autosaves = 0;
  Object.assign(scene, {
    playerState: state,
    canHireEmployees: () => false,
    showShopMessage: (message) => warnings.push(message),
    showGameMessage: (message) => messages.push(message),
    requestAutosave: () => { autosaves += 1; },
  });

  assert.equal(scene.setEmployeeOnShift("tavi_stock_clerk", false), false);
  assert.match(warnings[0], /between shifts/);
  assert.deepEqual(state.offShiftEmployees, []);

  scene.canHireEmployees = () => true;
  assert.equal(scene.setEmployeeOnShift("tavi_stock_clerk", false), true);
  assert.deepEqual(state.hiredEmployees, ["tavi_stock_clerk"]);
  assert.match(messages[0], /Off Shift.*won't be paid/i);
  assert.equal(scene.payEmployeeWages(), 0);
  assert.equal(state.credits, creditsAfterHire);
  scene.spawnHiredEmployees();
  assert.deepEqual(scene.employees, []);
  assert.equal(autosaves, 1);

  const restored = new PlayerState();
  restored.applySave(state.serialize());
  assert.deepEqual(restored.offShiftEmployees, ["tavi_stock_clerk"]);
  assert.equal(scene.setEmployeeOnShift("tavi_stock_clerk", true), true);
  assert.equal(scene.payEmployeeWages(), 50);
});

test("training can only be booked between shifts and trainees are paid without spawning for work", () => {
  const state = new PlayerState();
  state.shopLevel = 4;
  state.hireEmployee("tavi_stock_clerk");
  const scene = Object.create(GameScene.prototype);
  const warnings = [];
  let autosaves = 0;
  Object.assign(scene, {
    playerState: state,
    canHireEmployees: () => false,
    showShopMessage: (message) => warnings.push(message),
    showGameMessage() {},
    requestAutosave: () => { autosaves += 1; },
  });
  assert.equal(scene.trainEmployee("tavi_stock_clerk", "register"), false);
  assert.match(warnings[0], /between shifts/);
  assert.equal(state.credits, 1250);
  scene.canHireEmployees = () => true;
  assert.equal(scene.trainEmployee("tavi_stock_clerk", "register"), true);
  assert.equal(autosaves, 1);
  assert.equal(scene.setEmployeeOnShift("tavi_stock_clerk", false), false);
  assert.match(warnings.at(-1), /away training/);
  assert.equal(scene.payEmployeeWages(), 50);
  assert.equal(state.credits, 950);
  scene.spawnHiredEmployees();
  assert.deepEqual(scene.employees, []);
  state.finishShift({ customersServed: 0, customersTurnedAway: 0 });
  assert.equal(state.getEmployeeProfile("tavi_stock_clerk").skillLevels.register, 2);
  assert.equal(scene.payEmployeeWages(), 55);
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
  assert.equal(scene.isServingCustomer(first), false, "the player's checkout never freezes patience");
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

test("stepping away from the register mid-sale and coming back resumes the same sale", () => {
  const { scene, checkout } = createRegisterHarness();
  const customer = { cart: [{ itemId: "rifle", price: 100 }] };
  scene.handleJoinQueue(customer);
  checkout.paymentBuffer = "10";
  checkout.suspend(); // what leaving the register does mid-sale
  scene.startCheckout(customer);
  assert.equal(checkout.uiWindow.isOpen, true);
  assert.equal(checkout.paymentBuffer, "10");
  assert.equal(checkout.openedCarts.length, 1, "not started over");
});

test("a customer's payment type is picked once, even if their sale is started over", () => {
  const { scene, checkout } = createRegisterHarness();
  const options = [];
  const open = checkout.openForCustomer;
  checkout.openForCustomer = (cart, onComplete, opts) => {
    options.push(opts);
    open(cart, onComplete);
  };
  const customer = { cart: [{ itemId: "rifle", price: 100 }] };
  scene.handleJoinQueue(customer);
  checkout.mode = null; // the sale was thrown away
  scene.startCheckout(customer);
  assert.equal(options.length, 2);
  assert.equal(options[1].paymentType, options[0].paymentType);
  assert.equal(options[1].exact, options[0].exact);
  assert.equal(options[1].chitCode, options[0].chitCode);
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

test("Escape never clears the amount typed at the register; Delete does", () => {
  const checkout = Object.create(CheckoutWindow.prototype);
  const visible = { classList: { contains: () => false } };
  let cleared = 0;
  Object.assign(checkout, {
    windowManager: { isConsumed: () => false },
    uiWindow: { element: visible },
    bodyElement: { querySelector: () => visible },
    clearBuffer: () => { cleared += 1; },
  });
  checkout.handleNumpadKeydown({ key: "Escape" });
  assert.equal(cleared, 0, "Esc pauses the shift instead");
  checkout.handleNumpadKeydown({ key: "Delete" });
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

test("the register refuses a player whose hands are full of crates", () => {
  const scene = Object.create(GameScene.prototype);
  const register = { type: "register_basic", rotation: 0, sprite: {
    depth: 1, body: { width: 72, height: 56, center: { x: 100, y: 100 } },
    setDepth(depth) { this.depth = depth; },
  } };
  const sprite = { x: 200, y: 200, depth: 2, displayWidth: 48, displayHeight: 72,
    body: { enable: true }, setDepth(depth) { this.depth = depth; } };
  const messages = [];
  Object.assign(scene, {
    fixtures: { register: () => register },
    customers: [],
    employees: [],
    eventBus: { emit() {} },
    checkoutWindow: { mode: "closed" },
    player: { sprite, inputEnabled: true,
      teleportTo(x, y) { sprite.x = x; sprite.y = y; }, forceFacing() {} },
    operatingRegister: false,
    carriedCrates: [{ id: "crate_1" }],
    carriedCrate: { id: "crate_1" },
    showShopMessage: (text) => messages.push(text),
  });
  scene.beginRegisterSession(register);
  assert.equal(scene.operatingRegister, false);
  assert.equal(sprite.body.enable, true);
  assert.match(messages[0], /Put down what you're carrying/);

  scene.carriedCrates = [];
  scene.carriedCrate = null;
  scene.beginRegisterSession(register);
  assert.equal(scene.operatingRegister, true);
});

test("a customer arriving while the player holds crates near the register never opens checkout", () => {
  const { scene, checkout } = createRegisterHarness();
  delete scene.beginRegisterSession; // use the real method so its crates guard applies
  scene.operatingRegister = false;
  scene.operatingRegisterFixture = null;
  scene.carriedCrates = [{ id: "crate_1" }];
  scene.getNearbyRegisterTarget = () => scene.fixtures.register();
  scene.showShopMessage = () => {};
  scene.handleJoinQueue({ cart: [{ itemId: "rifle", price: 100 }] });
  assert.equal(checkout.uiWindow.isOpen, false);
  assert.equal(scene.operatingRegister, false);
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
  assert.match(html, /id="hud-store-toggle-btn"/);
  assert.match(html, /id="hud-main-menu-btn"/);
  const elements = new Map();
  for (const id of [
    "hud-credits", "hud-rep", "hud-shop-level", "hud-shift-time", "hud-pause-btn",
    "hud-store-toggle-btn", "hud-start-shift-btn", "hud-end-day-btn", "hud-save-btn", "hud-main-menu-btn",
    "persistent-hud",
  ]) {
    elements.set(id, {
      listeners: new Map(),
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {},
      addEventListener(event, handler) { this.listeners.set(event, handler); },
      removeEventListener(event) { this.listeners.delete(event); },
    });
  }
  const hudButtons = [
    "hud-pause-btn", "hud-store-toggle-btn", "hud-start-shift-btn", "hud-end-day-btn", "hud-save-btn",
  ]
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
  let mainMenuRequests = 0;
  const hud = new HUDController({
    subscribe(callback) {
      callback({ credits: 436, globalReputation: 2, shopLevel: 1 });
    },
  }, {
    subscribe(callback) { callback({ started: false, isPaused: true, softClosed: false }); },
  }, () => {}, () => { saves += 1; }, () => {}, () => {}, () => { mainMenuRequests += 1; });
  const mainMenuButton = elements.get("hud-main-menu-btn");
  mainMenuButton.listeners.get("click")();
  assert.equal(mainMenuRequests, 1);
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
  assert.equal(mainMenuButton.listeners.size, 0);
  assert.equal(hudRoot.listeners.size, 0);
});

test("all placeable fixture physics bodies use the same art-trimmed bounds as placement", () => {
  const scene = Object.create(GameScene.prototype);
  const tree = { remove() {}, insert() {} };
  const body = { world: { staticTree: tree }, position: { set(x, y) { this.x = x; this.y = y; } },
    center: { set(x, y) { this.x = x; this.y = y; } } };
  const sprite = { displayWidth: 0, displayHeight: 0, body,
    setTexture() { return this; },
    setDisplaySize(width, height) { this.displayWidth = width; this.displayHeight = height; return this; },
    setPosition() { return this; }, setAngle(angle) { this.angle = angle; return this; } };
  for (const type of Object.keys(FIXTURE_TYPES)) {
    for (let rotation = 0; rotation < 4; rotation++) {
      const fixture = { type, x: 832, y: 192, rotation, sprite };
      scene.orientFixtureSprite(fixture);
      const footprint = fixtureFootprint(fixture);
      const bounds = fixtureBounds({ ...fixture, gx: 832 / 64 - footprint.w / 2, gy: 192 / 64 - footprint.h / 2 });
      assert.ok(Math.abs(body.width - (bounds.right - bounds.left) * 64) < 1e-9);
      assert.ok(Math.abs(body.height - (bounds.bottom - bounds.top) * 64) < 1e-9);
      assert.ok(Math.abs(body.position.x - bounds.left * 64) < 1e-9);
      assert.ok(Math.abs(body.position.y - bounds.top * 64) < 1e-9);
      assert.equal(sprite.angle, 0);
    }
  }
});

test("side-facing register queue and cashier align with the body box rather than transparent art", () => {
  const scene = Object.create(GameScene.prototype);
  const body = { width: 30, height: 68, center: { x: 100, y: 100 } };
  const register = { type: "register_basic", rotation: 1, sprite: { body } };
  scene.fixtures = { register: () => register };
  scene.player = { sprite: { displayWidth: 48, displayHeight: 72 } };
  assert.deepEqual(scene.getBehindRegisterPoint(), { x: 129, y: 100 });
  const first = positionRegisterQueue([{ x: 0, y: 100 }, { x: -64, y: 100 }], body, fixtureFacingStep(register))[0];
  assert.deepEqual(first, {
    x: 85 - CHARACTER_ART_WIDTH / 2 + 10,
    y: 100 + CHARACTER_FEET_DROP,
  });

  test("the player can enter and leave the register in every facing", () => {
    for (let rotation = 0; rotation < 4; rotation++) {
      const scene = Object.create(GameScene.prototype);
      const register = { type: "register_basic", rotation, sprite: {
        depth: 1, body: { width: 72, height: 56, center: { x: 100, y: 100 } },
        setDepth(depth) { this.depth = depth; },
      } };
      const sprite = { x: 200, y: 200, depth: 2, displayWidth: 48, displayHeight: 72,
        body: { enable: true }, setDepth(depth) { this.depth = depth; } };
      scene.fixtures = { register: () => register };
      scene.customers = [];
      scene.employees = [];
      scene.eventBus = { emit() {} };
      scene.checkoutWindow = { mode: "closed" };
      scene.player = { sprite, inputEnabled: true,
        teleportTo(x, y) { sprite.x = x; sprite.y = y; }, forceFacing() {} };
      scene.beginRegisterSession(register);
      assert.equal(scene.operatingRegister, true);
      assert.equal(sprite.body.enable, false);
      assert.ok(Number.isFinite(sprite.x) && Number.isFinite(sprite.y));
      scene.endRegisterSession();
      assert.equal(scene.operatingRegister, false);
      assert.equal(sprite.body.enable, true);
      assert.equal(scene.player.inputEnabled, true);
      assert.deepEqual({ x: sprite.x, y: sprite.y, depth: sprite.depth }, { x: 200, y: 200, depth: 2 });
      assert.equal(register.sprite.depth, 1, "the counter is back at its normal depth");
    }
  });
});

test("the budget shelf art fills its footprint in every direction; only the visible shelf is solid", () => {
  const scene = Object.create(GameScene.prototype);
  const tree = { remove() {}, insert() {} };
  const body = { world: { staticTree: tree }, position: { set() {} }, center: { set() {} } };
  const sprite = {
    displayWidth: 0, displayHeight: 0, body,
    setTexture(key) {
      this.texture = key;
      this.displayWidth = 256;
      this.displayHeight = key.endsWith("_left") || key.endsWith("_right") ? 375 : 256;
      return this;
    },
    setDisplaySize(width, height) { this.displayWidth = width; this.displayHeight = height; return this; },
    setPosition() { return this; },
    setAngle(angle) { this.angle = angle; return this; },
  };
  for (let rotation = 0; rotation < 4; rotation++) {
    scene.orientFixtureSprite({ type: "shelf_budget_2x2", x: 100, y: 200, rotation, sprite });
    const [width, height] = rotation % 2 === 0 ? [72, 64] : [64, 72];
    assert.equal(sprite.displayWidth, width);
    assert.equal(sprite.displayHeight, height);
    assert.equal(sprite.angle, 0);
    // The 2x2 art leaves an empty band at its top (facing up/down) or sides (facing left/right).
    const [solidWidth, solidHeight] = rotation % 2 === 0 ? [68, 48] : [44, 70];
    assert.equal(body.width, solidWidth);
    assert.equal(body.height, solidHeight);
  }
});
