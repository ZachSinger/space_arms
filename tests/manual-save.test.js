import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { TEST_STARTING_TEMPLATE, useFixedStart } from "./support/fixed-start.js";
import { getShopLevelRequirement, getStaffLimit, STAFF_LIMIT_LEVELS } from "../js/logic/ShopProgression.js";
import { EMPLOYEE_BASE_WAGE, EMPLOYEE_HIRE_COST, getEmployeeTrainingCost } from "../js/logic/EmployeeTraining.js";
import { HUDController } from "../js/logic/HUDController.js";
import { ControlMode } from "../js/input/ControlMode.js";
import { PlayerControls } from "../js/input/PlayerControls.js";
import { UINavigator } from "../js/logic/UINavigator.js";
import { GAME_EVENTS } from "../js/core/Events.js";
import { SupplierLicense } from "../js/logic/Licenses.js";
import { ContractRenderer } from "../js/logic/ContractRenderer.js";
import { BACKROOM_UPGRADE_ORDER, EXPANSION_ORDER, ZONES, getZone } from "../js/logic/RoomLayout.js";
import { formatMoneyAmount } from "../js/logic/Money.js";
import { FIXTURE_TYPES, fixtureFacingStep, fixtureFootprint, fixtureSolidBounds, positionRegisterQueue } from "../js/logic/FixtureLayout.js";
import { upgradeContractSplit } from "../js/state/migrations/contractSplit.js";

let server;
let cacheDirectory;
let GameScene;
let CheckoutWindow;
let GameState;
let CHARACTER_ART_WIDTH;
let CHARACTER_FEET_DROP;
let DebugTools;
let ShiftSystem;
let StaffSystem;
let SaveSystem;
let FixtureSystem;
let FixtureViews;
let CustomerFlow;
let CheckoutSystem;
let CatalogSystem;
const originalPhaser = globalThis.Phaser;

before(async () => {
  globalThis.Phaser = { Scene: class {} };
  const licenses = JSON.parse(await readFile(new URL("../data/Licenses.json", import.meta.url), "utf8"));
  globalThis.__progressionTestLicenses = licenses.map((data) => new SupplierLicense(data));
  cacheDirectory = await mkdtemp(join(fileURLToPath(new URL("..", import.meta.url)), ".manual-save-test-"));
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
  await useFixedStart(server);
  ({ GameScene } = await server.ssrLoadModule("/js/scenes/game.js"));
  ({ CheckoutWindow } = await server.ssrLoadModule("/js/logic/CheckoutWindow.js"));
  ({ GameState } = await server.ssrLoadModule("/js/state/GameState.js"));
  ({ DebugTools } = await server.ssrLoadModule("/js/debug/DebugTools.js"));
  ({ ShiftSystem } = await server.ssrLoadModule("/js/systems/ShiftSystem.js"));
  ({ StaffSystem } = await server.ssrLoadModule("/js/systems/StaffSystem.js"));
  ({ SaveSystem } = await server.ssrLoadModule("/js/systems/SaveSystem.js"));
  ({ FixtureSystem } = await server.ssrLoadModule("/js/systems/FixtureSystem.js"));
  ({ FixtureViews } = await server.ssrLoadModule("/js/world/FixtureViews.js"));
  ({ CustomerFlow } = await server.ssrLoadModule("/js/systems/CustomerFlow.js"));
  ({ CheckoutSystem } = await server.ssrLoadModule("/js/systems/CheckoutSystem.js"));
  ({ CatalogSystem } = await server.ssrLoadModule("/js/systems/CatalogSystem.js"));
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
  let stored = null;
  Object.assign(scene, {
    shift: { starting: false, ended: false },
    shiftClock: { started: false },
    customers: [],
    credits: 436,
    hud: { renderSaveState: (state) => controls.push(state) },
    messages: { closeSaveError() {}, show: (message) => messages.push(message) },
  });
  scene.saves = new SaveSystem(scene, {
    read: async () => structuredClone(stored),
    write: async (payload) => {
      writes.push(payload);
      const result = await write(payload);
      if (result === true) stored = structuredClone(payload);
      return result;
    },
  });
  scene.saves.serialize = () => ({ credits: scene.credits });
  scene.saves.handleError = (error) => {
    errors.push(error);
    scene.saves.autosaveBlocked = true;
    scene.saves.setStatus(`Not saved: ${error.message}`);
  };
  scene.fixtureSystem = new FixtureSystem(scene);
  scene.customerFlow = new CustomerFlow(scene);
  return { scene, messages, errors, writes, controls };
}

test("fixtures can be placed during a closed mid-shift without unlocking saving or expansions", () => {
  const { scene } = createHarness();
  assert.equal(scene.fixtureSystem.canRearrange(), true);
  Object.assign(scene.shiftClock, { started: true, isPaused: false, softClosed: false });
  scene.customers.push({});
  assert.equal(scene.fixtureSystem.canRearrange(), false);
  scene.customerFlow.temporarilyClosed = true;
  assert.equal(scene.fixtureSystem.canRearrange(), true);
  assert.equal(scene.saves.canSaveOffShift(), false);
  assert.equal(scene.fixtureSystem.canExpand(), false);
  scene.shiftClock.isPaused = true;
  assert.equal(scene.fixtureSystem.canRearrange(), false);
  scene.shiftClock.isPaused = false;
  scene.shift.starting = true;
  assert.equal(scene.fixtureSystem.canRearrange(), false);
  scene.shift.starting = false;
  scene.customerFlow.temporarilyClosed = false;
  scene.shiftClock.softClosed = true;
  assert.equal(scene.fixtureSystem.canRearrange(), true);
});

test("pause consumes menu, mouse and keyboard actions, leaving only resume available", () => {
  const { scene } = createHarness();
  scene.shiftClock.started = true;
  scene.shiftClock.isPaused = true;
  scene.shiftClock.togglePause = () => { scene.shiftClock.isPaused = !scene.shiftClock.isPaused; };
  scene.controlMode = new ControlMode(scene);
  scene.controls = new PlayerControls(scene);
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
    scene.controls.handlePausedInput(input);
    assert.equal(input.blocked, true, input.type);
    assert.equal(input.prevented, true, input.type);
    assert.equal(scene.shiftClock.isPaused, true);
  }
  const resumeClick = event("click", { target: { closest: () => ({}) } });
  scene.controls.handlePausedInput(resumeClick);
  assert.equal(resumeClick.blocked, false);
  for (const type of ["keydown", "pointerdown", "mousedown", "click"]) {
    const reportInput = event(type, {
      code: "KeyP",
      target: { closest: (selector) => selector.includes("#bug-report-window") ? {} : null },
    });
    scene.controls.handlePausedInput(reportInput);
    assert.equal(reportInput.blocked, false, `report form ${type}`);
    assert.equal(reportInput.prevented, false, `report form ${type}`);
    assert.equal(scene.shiftClock.isPaused, true);
  }
  for (const key of [{ code: "KeyP" }, { key: "Escape" }]) {
    scene.shiftClock.isPaused = true;
    const resumeKey = event("keydown", key);
    scene.controls.handlePausedInput(resumeKey);
    assert.equal(resumeKey.blocked, true, "resume must not also close an open window");
    assert.equal(scene.shiftClock.isPaused, false);
  }
  const normalClick = event("click");
  scene.controls.handlePausedInput(normalClick);
  assert.equal(normalClick.blocked, false);
});

test("a paused scene polls menu input without updating any world systems", () => {
  let polls = 0;
  const scene = Object.create(GameScene.prototype);
  Object.assign(scene, {
    gamePaused: true,
    worldElapsedMs: 345,
    controls: { handleGamepad: () => { polls += 1; } },
  });
  scene.update(1000, 16);
  scene.update(9000, 32);
  assert.equal(polls, 2);
  assert.equal(scene.worldElapsedMs, 345);
});

test("a paused cash handover cannot take the controller away from the pause menu", (t) => {
  const originalDocument = globalThis.document;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const cash = {};
  const menu = { hasAttribute: () => false };
  globalThis.document = {
    querySelector(selector) {
      if (selector === ".cash-tender-overlay:not(.hidden)") return cash;
      if (selector === ".retro-window.active:not(.hidden)") return menu;
      return null;
    },
  };
  assert.equal(new UINavigator().getScope(), menu);
});

test("explicit pause freezes physics, animations, tweens, timers, and resumes them", (t) => {
  const originalDocument = globalThis.document;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const calls = [];
  const animation = { playState: "running", pause: () => calls.push("dom-pause"), play: () => calls.push("dom-resume") };
  globalThis.document = { body: { classList: { toggle() {} } }, getAnimations: () => [animation] };
  const scene = Object.create(GameScene.prototype);
  const toggle = (name) => ({ setPaused: (paused) => calls.push(`${name}:${paused}`) });
  const engine = (name) => ({
    pause: () => calls.push(`${name}-pause`), resume: () => calls.push(`${name}-resume`),
    pauseAll: () => calls.push(`${name}-pause`), resumeAll: () => calls.push(`${name}-resume`),
  });
  Object.assign(scene, {
    gamePaused: false, time: { paused: false },
    checkoutWindow: toggle("checkout"),
    crateSystem: { setMotionPaused: (paused) => calls.push(`crates:${paused}`) },
    messages: { timers: toggle("messages") },
    controls: { cancelPresses() {} }, shelfStockingWindow: { stopHolding() {} },
    physics: { world: engine("physics") }, anims: engine("animations"),
    tweens: engine("tweens"), sound: engine("sound"),
  });
  scene.setGamePaused(true);
  assert.equal(scene.time.paused, true);
  scene.setGamePaused(true);
  assert.equal(calls.filter((value) => value === "physics-pause").length, 1);
  scene.setGamePaused(false);
  assert.equal(scene.time.paused, false);
  assert.deepEqual(calls, [
    "checkout:true", "crates:true", "messages:true", "physics-pause", "animations-pause",
    "tweens-pause", "sound-pause", "dom-pause",
    "checkout:false", "crates:false", "messages:false", "physics-resume", "tweens-resume",
    "animations-resume", "sound-resume", "dom-resume",
  ]);
});

const ITEMS = [{ id: "ration", baseCost: 10 }];
const newGame = () => new GameState({ items: ITEMS, random: () => 0.5 });
const reload = (state) => GameState.fromSave(JSON.parse(JSON.stringify(state.toSave())), { items: ITEMS });
const loadPlayer = (player) =>
  GameState.fromSave({ playerState: player, market: { day: 1, ...newGame().market.serialize() } }, { items: ITEMS });
const FIRST_STAFF_LEVEL = STAFF_LIMIT_LEVELS[0];

test("Robot Service inventory and assembled robots survive a GameState save and reload", () => {
  const state = newGame();
  for (const id of ["worker_frame", "basic_cell", "self_charge_1", "register_1"]) state.robotService.addPart(id);
  state.robotService.addRobot({
    name: "Register Bot", frame: "worker_frame", cell: "basic_cell",
    boards: [{ board: "self_charge_1" }, { board: "register_1" }],
  });
  const restored = reload(state);
  assert.deepEqual(restored.robotService.toSave(), state.robotService.toSave());
  assert.deepEqual(restored.toSave().playerState.robotService, state.toSave().playerState.robotService);
});

// Every contract a level-up from `from` to `to` should name: reached, still unsigned, and unlocked.
function assertNamesNewContracts(message, state, from, to) {
  for (const license of globalThis.__progressionTestLicenses) {
    if (license.requiredShopLevel > from && license.requiredShopLevel <= to &&
      !state.catalog.owns(license.id) && license.isUnlocked(state)) {
      assert.ok(message.includes(license.name), license.id);
      assert.match(message, /Contracts tab/);
    }
  }
}

function createExpansionHarness({ shopLevel, credits }) {
  const scene = Object.create(GameScene.prototype);
  const gameState = newGame();
  gameState.reputation.shopLevel = shopLevel;
  gameState.economy.credits = credits;
  const messages = [];
  let cameraRefreshes = 0;
  let autosaves = 0;
  Object.assign(scene, {
    gameState,
    shift: { starting: false, ended: false },
    shiftClock: { started: false },
    customers: [],
    room: {
      zones: ZONES.map((zone) => ({ ...zone })),
      unlockZone(id) {
        const zone = this.zones.find((candidate) => candidate.id === id);
        zone.locked = false;
      },
    },
    cameraRig: { refresh() { cameraRefreshes++; }, reset() { cameraRefreshes++; } },
    messages: { show(message) { messages.push(message); } },
  });
  scene.saves = new SaveSystem(scene, { write: async () => true });
  scene.saves.requestAutosave = () => { autosaves++; };
  scene.fixtureSystem = new FixtureSystem(scene);
  return {
    scene,
    messages,
    get cameraRefreshes() { return cameraRefreshes; },
    get autosaves() { return autosaves; },
  };
}

test("store expansions require their level, credits, and previous purchases", () => {
  const west = getZone("expansion_west");
  const locked = createExpansionHarness({ shopLevel: west.requiredShopLevel - 1, credits: west.cost * 2 });
  assert.equal(locked.scene.fixtureSystem.expansionOptions()[0].levelMet, false);
  assert.equal(locked.scene.fixtureSystem.buyExpansion("expansion_west"), false);
  assert.equal(locked.scene.gameState.economy.credits, west.cost * 2);
  assert.match(locked.messages[0], new RegExp(`Shop Level ${west.requiredShopLevel}\\b`));

  const poor = createExpansionHarness({ shopLevel: west.requiredShopLevel, credits: west.cost - 1 });
  assert.equal(poor.scene.fixtureSystem.buyExpansion("expansion_west"), false);
  assert.equal(poor.scene.room.zones.find((zone) => zone.id === "expansion_west").locked, true);
  assert.equal(poor.scene.gameState.economy.credits, west.cost - 1);

  const open = createExpansionHarness({ shopLevel: west.requiredShopLevel, credits: west.cost });
  open.scene.shiftClock.started = true;
  assert.equal(open.scene.fixtureSystem.buyExpansion("expansion_west"), false);
  assert.equal(open.scene.gameState.economy.credits, west.cost);
  assert.match(open.messages[0], /while the store is closed/);

  const plenty = getZone("expansion_a").cost * 2;
  const wrongOrder = createExpansionHarness({ shopLevel: 50, credits: plenty });
  assert.equal(wrongOrder.scene.fixtureSystem.buyExpansion("expansion_a"), false);
  assert.equal(wrongOrder.scene.gameState.economy.credits, plenty);
  assert.match(wrongOrder.messages[0], /in order/);
});

test("Decorator Mode can buy a later store expansion, opening the earlier ones with it", () => {
  const harness = createExpansionHarness({ shopLevel: 50, credits: 100000 });
  const { scene } = harness;
  scene.fixtureSystem.anyZoneOrder = true;
  assert.equal(scene.fixtureSystem.expansionOptions()[1].isNext, true);
  assert.equal(scene.fixtureSystem.buyExpansion("expansion_a"), true);
  assert.equal(scene.room.zones.find((zone) => zone.id === "expansion_west").locked, false);
  assert.equal(scene.room.zones.find((zone) => zone.id === "expansion_a").locked, false);
  assert.equal(scene.gameState.economy.credits, 100000 - getZone("expansion_west").cost - getZone("expansion_a").cost);
});

test("buying the first store expansion deducts credits and records a receipt line", () => {
  const first = getZone(EXPANSION_ORDER[0]);
  const harness = createExpansionHarness({ shopLevel: first.requiredShopLevel, credits: first.cost });
  const { scene } = harness;
  assert.equal(scene.fixtureSystem.expansionOptions()[0].canAfford, true);
  assert.equal(scene.fixtureSystem.buyExpansion(first.id), true);
  assert.equal(scene.gameState.economy.credits, 0);
  assert.equal(scene.room.zones.find((zone) => zone.id === EXPANSION_ORDER[0]).locked, false);
  assert.ok(scene.gameState.shop.unlockedZones.has(EXPANSION_ORDER[0]), "the save keeps the new zone");
  assert.deepEqual(scene.gameState.economy.dayLedger.serialize().lines, [{
    category: "expansions",
    label: first.name,
    amount: -first.cost,
    quantity: 1,
  }]);
  assert.equal(harness.cameraRefreshes, 1);
  assert.equal(harness.autosaves, 1);
});

test("backroom expansions require their level, credits, and previous purchases", () => {
  const first = getZone(BACKROOM_UPGRADE_ORDER[0]);
  const locked = createExpansionHarness({ shopLevel: first.requiredShopLevel - 1, credits: first.cost * 2 });
  assert.equal(locked.scene.fixtureSystem.backroomOptions()[0].levelMet, false);
  assert.equal(locked.scene.fixtureSystem.buyBackroomUpgrade(BACKROOM_UPGRADE_ORDER[0]), false);
  assert.match(locked.messages[0], new RegExp(`Shop Level ${first.requiredShopLevel}\\b`));

  const poor = createExpansionHarness({ shopLevel: first.requiredShopLevel, credits: first.cost - 1 });
  assert.equal(poor.scene.fixtureSystem.buyBackroomUpgrade(BACKROOM_UPGRADE_ORDER[0]), false);
  assert.equal(poor.scene.gameState.economy.credits, first.cost - 1);
  assert.ok(poor.messages[0].includes(`costs ${formatMoneyAmount(first.cost)}.`));

  const wrongOrder = createExpansionHarness({ shopLevel: 50, credits: getZone(BACKROOM_UPGRADE_ORDER[1]).cost });
  assert.equal(wrongOrder.scene.fixtureSystem.buyBackroomUpgrade(BACKROOM_UPGRADE_ORDER[1]), false);
  assert.match(wrongOrder.messages[0], /in order/);
});

test("buying all backroom expansions records costs and opens the wider room", () => {
  const costs = BACKROOM_UPGRADE_ORDER.map((id) => getZone(id).cost);
  const harness = createExpansionHarness({ shopLevel: 50, credits: costs.reduce((sum, cost) => sum + cost, 0) });
  const { scene } = harness;
  for (const id of BACKROOM_UPGRADE_ORDER) {
    assert.equal(scene.fixtureSystem.buyBackroomUpgrade(id), true);
  }
  assert.equal(scene.gameState.economy.credits, 0);
  assert.ok(BACKROOM_UPGRADE_ORDER.every((id) =>
    !scene.room.zones.find((zone) => zone.id === id).locked));
  assert.deepEqual(scene.gameState.economy.dayLedger.serialize().lines.map((line) => line.amount),
    costs.map((cost) => -cost));
  assert.equal(harness.cameraRefreshes, 3);
  assert.equal(harness.autosaves, 3);
});

test("debug upgrade buttons open the next zone free, even at Level 1 with the store open", () => {
  const harness = createExpansionHarness({ shopLevel: 1, credits: 0 });
  const { scene } = harness;
  scene.shiftClock.started = true;
  const debugTools = new DebugTools(scene);
  for (const [order, area] of [[EXPANSION_ORDER, "sales floor"], [BACKROOM_UPGRADE_ORDER, "backroom"]]) {
    for (const id of order) {
      assert.equal(debugTools.unlockNextZone(order, area), true);
      assert.equal(scene.room.zones.find((zone) => zone.id === id).locked, false);
    }
    assert.equal(debugTools.unlockNextZone(order, area), false);
    assert.match(harness.messages.at(-1), new RegExp(`Every ${area} upgrade is already open`));
  }
  assert.equal(scene.gameState.economy.credits, 0);
});

test("debug shortcuts bind the spawn-customer, Quickstart, and employee-testing keys", (t) => {
  const originalDocument = globalThis.document;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  globalThis.document = { getElementById: () => null };
  const bindings = new Map();
  const scene = {
    controls: { bindKey: (key, action, handler) => bindings.set(key, { action, handler }) },
  };
  new DebugTools(scene).install();
  assert.deepEqual([...bindings.keys()], ["keydown-Y", "keydown-K", "keydown-L"]);
});

test("Employee Test refuses to run during a shift and changes nothing", () => {
  const harness = createExpansionHarness({ shopLevel: 1, credits: 500 });
  const { scene } = harness;
  scene.shiftClock.started = true;

  assert.equal(new DebugTools(scene).prepareEmployeeTesting(), false);
  assert.equal(scene.gameState.reputation.shopLevel, 1);
  assert.equal(scene.gameState.economy.credits, 500);
  assert.equal(harness.autosaves, 0);
  assert.match(harness.messages.at(-1), /only works before a shift starts/);
});

test("temporarily closing the store pauses arrivals and reschedules them on reopening", () => {
  let elapsedMs = 0;
  const spawned = [];
  const storeStates = [];
  const messages = [];
  const scene = Object.create(GameScene.prototype);
  Object.assign(scene, {
    shiftClock: {
      started: true,
      softClosed: false,
      isPaused: false,
      getElapsedMs: () => elapsedMs,
    },
    hud: { renderStoreStatus: (closed) => storeStates.push(closed) },
    messages: { show: (message) => messages.push(message) },
  });
  const flow = new CustomerFlow(scene);
  flow.schedule = [
    { factionId: "mercenaries", atMs: 1000 },
    { factionId: "explorers", atMs: 5000 },
  ];
  flow.spawn = (factionId) => spawned.push(factionId);

  assert.equal(flow.toggleTemporaryClosure(), true);
  elapsedMs = 3000;
  flow.spawnScheduled();
  assert.deepEqual(spawned, []);
  assert.equal(flow.nextArrival, 0);
  assert.equal(scene.shiftClock.isPaused, false);

  assert.equal(flow.toggleTemporaryClosure(), true);
  assert.deepEqual(flow.schedule.map(({ atMs }) => atMs), [4000, 8000]);
  assert.deepEqual(storeStates, [true, false]);
  assert.match(messages[0], /Customers inside can finish shopping/);

  elapsedMs = 4000;
  flow.spawnScheduled();
  elapsedMs = 8000;
  flow.spawnScheduled();
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
  checkout.timers = { now: () => 0 };
  checkout.bodyElement = { querySelectorAll: () => [] };
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
    fixtures: {
      register: () => registerFixture,
      registers: () => [registerFixture],
      get: (id) => id === registerFixture.id ? registerFixture : undefined,
    },
    checkoutWindow: checkout,
    windowManager: { windows: new Map([
      [tablet.id, tablet], [checkout.uiWindow.id, checkout.uiWindow],
    ]) },
    gameState: { goBacks: { addCart() {} } },
    employees: [],
    saves: { loadFailed: false },
  });
  scene.carriedCrates = [];
  scene.carriedCrate = null;
  scene.crateSystem = { getCarriedCrates: () => scene.carriedCrates, syncCarriedCrate() {}, syncFloorStacks() {} };
  scene.controlMode = new ControlMode(scene);
  scene.checkoutSystem = new CheckoutSystem(scene);
  scene.checkoutSystem.operatingRegister = true;
  scene.checkoutSystem.operatingRegisterFixture = registerFixture;
  scene.checkoutSystem.registerLines.set(registerFixture.id, line);
  scene.checkoutSystem.layoutRegisterLine = () => {};
  return { scene, checkout, tablet };
}

test("the shift-end event, receipt, and save observers see the applied reputation and level", () => {
  const scene = Object.create(GameScene.prototype);
  const state = newGame();
  const events = [];
  const messages = [];
  const savedStates = [];
  Object.assign(scene, {
    gameState: state,
    customers: [],
    shiftClock: { started: true, isPaused: false, notifyListeners() {} },
    hud: { renderStoreStatus() {} },
    room: { zones: ZONES },
    fixturePlacement: { active: false },
    eventBus: { emit: (name, details) => events.push({ name, details }) },
    messages: { show: (message) => messages.push(message) },
  });
  scene.shift = new ShiftSystem(scene);
  scene.saves = new SaveSystem(scene, { write: async () => true });
  scene.staffSystem = { clear() {} };
  scene.customerFlow = new CustomerFlow(scene);
  const levelTwo = getShopLevelRequirement(2);
  scene.shift.customersServed = levelTwo + 1;
  scene.shift.loanOffer = () => ({ available: false, amount: 0, repayTotal: 0 });
  state.subscribe((current) => {
    if (current.calendar.awaitingEndDay && scene.saves.canSaveOffShift()) {
      savedStates.push(current.toSave().playerState);
    }
  });
  state.reputation.gain(levelTwo + 1, "scavengers");
  state.reputation.lose(1, "mercenaries");
  assert.equal(state.reputation.global, 0);
  assert.equal(scene.shift.financesView().pendingReputationChange, levelTwo);

  scene.shift.end();
  assert.equal(state.reputation.global, levelTwo);
  assert.equal(state.reputation.shopLevel, 2);
  assert.equal(scene.shiftClock.started, false);
  assert.deepEqual(events, [{
    name: GAME_EVENTS.SHIFT_ENDED,
    details: {
      served: levelTwo + 1,
      turnedAway: 0,
      reputation: levelTwo,
      factionReputation: { scavengers: levelTwo + 1, mercenaries: -1, explorers: 0 },
    },
  }]);
  assert.equal(scene.shift.financesView().today.reputationChange, levelTwo);
  assert.equal(scene.shift.financesView().pendingReputationChange, null);
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0].globalReputation, levelTwo);
  assert.equal(savedStates[0].shopLevel, 2);
  assert.match(messages[0], /Shop Level 2 reached/);
  assertNamesNewContracts(messages[0], state, 1, 2);
  if (FIRST_STAFF_LEVEL > 2) assert.doesNotMatch(messages[0], /Staff unlocked|Employee tab/);
});

test("a shift that earns multiple levels announces each implemented unlock", () => {
  const state = newGame();
  const scene = Object.create(GameScene.prototype);
  const messages = [];
  Object.assign(scene, {
    gameState: state,
    shiftClock: { started: true, isPaused: false, notifyListeners() {} },
    hud: { renderStoreStatus() {} },
    room: { zones: ZONES },
    eventBus: { emit() {} },
    messages: { show: (message) => messages.push(message) },
  });
  scene.shift = new ShiftSystem(scene);
  scene.staffSystem = { clear() {} };
  scene.customerFlow = new CustomerFlow(scene);
  scene.shift.customersServed = 60;
  assert.ok(FIRST_STAFF_LEVEL > 2, "the first staff spot is a multi-level jump away");
  state.reputation.gain(getShopLevelRequirement(FIRST_STAFF_LEVEL));
  scene.shift.end();
  assert.equal(state.reputation.shopLevel, FIRST_STAFF_LEVEL);
  assert.match(messages[0], new RegExp(`Shop Level ${FIRST_STAFF_LEVEL} reached`));
  assertNamesNewContracts(messages[0], state, 1, FIRST_STAFF_LEVEL);
  assert.match(messages[0], /You can now have 1 employee hired at once \(Employee tab\)/);

  const nextLevel = FIRST_STAFF_LEVEL + 1;
  state.endDay();
  state.reputation.gain(getShopLevelRequirement(nextLevel) - state.reputation.global);
  scene.shift.end();
  assert.equal(state.reputation.shopLevel, nextLevel);
  assert.match(messages[1], new RegExp(`Shop Level ${nextLevel} reached`));
  assertNamesNewContracts(messages[1], state, FIRST_STAFF_LEVEL, nextLevel);
  assert.doesNotMatch(messages[1], /Some later level rewards are not in the game yet/);

  const expansionLevel = getZone(EXPANSION_ORDER[0]).requiredShopLevel;
  assert.ok(expansionLevel > nextLevel);
  state.endDay();
  state.reputation.gain(getShopLevelRequirement(expansionLevel) - state.reputation.global);
  scene.shift.end();
  assert.equal(state.reputation.shopLevel, expansionLevel);
  assert.match(messages[2], new RegExp(`Shop Level ${expansionLevel} reached`));
  assertNamesNewContracts(messages[2], state, nextLevel, expansionLevel);
  assert.match(messages[2], /Sales-floor expansion available to buy in the Layout tab/);
  assert.doesNotMatch(messages[2], /Some later level rewards are not in the game yet/);
});

test("a shift from the first expansion's Shop Level to a much later one announces all remaining reward types", () => {
  const from = getZone(EXPANSION_ORDER[0]).requiredShopLevel;
  const to = Math.max(getZone(BACKROOM_UPGRADE_ORDER[1]).requiredShopLevel, STAFF_LIMIT_LEVELS.at(-1));
  const state = newGame();
  state.reputation.shopLevel = from;
  state.reputation.global = getShopLevelRequirement(from);
  const scene = Object.create(GameScene.prototype);
  const messages = [];
  Object.assign(scene, {
    gameState: state,
    shiftClock: { started: true, isPaused: false, notifyListeners() {} },
    hud: { renderStoreStatus() {} },
    room: { zones: ZONES.map((zone) => ({ ...zone })) },
    eventBus: { emit() {} },
    messages: { show: (message) => messages.push(message) },
  });
  scene.shift = new ShiftSystem(scene);
  scene.staffSystem = { clear() {} };
  scene.customerFlow = new CustomerFlow(scene);
  scene.shift.customersServed = 60;
  state.reputation.gain(getShopLevelRequirement(to) - getShopLevelRequirement(from));
  scene.shift.end();

  assert.equal(state.reputation.shopLevel, to);
  assert.match(messages[0], new RegExp(`You can now have ${getStaffLimit(to)} employees hired at once`));
  assertNamesNewContracts(messages[0], state, from, to);
  assert.match(messages[0], /Sales-floor expansions? available to buy/);
  assert.match(messages[0], /Backroom expansions? available to buy/);
  assert.doesNotMatch(messages[0], /Some later level rewards are not in the game yet/);
});

test("level-up news announces Robot Service and later robot parts", () => {
  const state = newGame();
  const scene = { gameState: state, room: { zones: [] } };
  const shift = new ShiftSystem(scene);
  state.reputation.shopLevel = 5;
  assert.match(shift.levelUpMessage(4), /Robot Service is available in the manager's tablet/);
  state.reputation.shopLevel = 10;
  assert.match(shift.levelUpMessage(9), /New robot parts are available/);
  assert.doesNotMatch(shift.levelUpMessage(5), /Robot Service is available/);
});

test("level-up messages do not reannounce contracts or staff already owned in older saves", () => {
  const state = newGame();
  const owned = globalThis.__progressionTestLicenses.filter((license) =>
    license.requiredShopLevel > 1 && license.requiredShopLevel <= FIRST_STAFF_LEVEL);
  for (const license of owned) state.catalog.sign(license.id);
  state.staff.add("tavi_stock_clerk");
  const scene = Object.create(GameScene.prototype);
  const messages = [];
  Object.assign(scene, {
    gameState: state,
    shiftClock: { started: true, isPaused: false, notifyListeners() {} },
    hud: { renderStoreStatus() {} },
    room: { zones: ZONES },
    eventBus: { emit() {} },
    messages: { show: (message) => messages.push(message) },
  });
  scene.shift = new ShiftSystem(scene);
  scene.staffSystem = { clear() {} };
  scene.customerFlow = new CustomerFlow(scene);
  scene.shift.customersServed = 60;
  state.reputation.gain(getShopLevelRequirement(FIRST_STAFF_LEVEL));
  scene.shift.end();
  assert.match(messages[0], new RegExp(`Shop Level ${FIRST_STAFF_LEVEL} reached`));
  assert.doesNotMatch(messages[0], /Contracts unlocked|Staff unlocked/);
  for (const license of owned) assert.ok(!messages[0].includes(license.name), license.id);
});

test("level 1 saves keep starting contracts signed before their level requirement changed", () => {
  const state = newGame();
  for (const id of ["lic_start_surplus", "lic_start_ammo"]) state.catalog.sign(id);
  const restored = reload(state);
  const contracts = globalThis.__progressionTestLicenses.filter((license) =>
    ["lic_start_surplus", "lic_start_ammo"].includes(license.id));
  assert.equal(restored.reputation.shopLevel, 1);
  assert.ok(contracts.every((license) => restored.catalog.owns(license.id)));
  const html = ContractRenderer.generateHTML(contracts, restored);
  assert.equal((html.match(/>PURCHASED</g) ?? []).length, 2);
  assert.doesNotMatch(html, />LOCKED</);
});

test("saves from before contracts were split keep every product they could already order", () => {
  const state = newGame();
  state.catalog.sign("lic_start_ammo");
  const { contractsSplit, ...oldSave } = state.toSave().playerState;
  assert.equal(contractsSplit, true);
  const restored = loadPlayer(upgradeContractSplit({ playerState: oldSave }).playerState);
  assert.ok(restored.catalog.owns("lic_start_ammo"));
  assert.ok(restored.catalog.owns("lic_start_rifle_ammo"));
  assert.equal(restored.catalog.owns("lic_start_survival"), false);

  const current = loadPlayer(upgradeContractSplit({ playerState: state.toSave().playerState }).playerState);
  assert.equal(current.catalog.owns("lic_start_rifle_ammo"), false,
    "new saves do not get the follow-up contract for free");
});

test("the actual hire action explains the level lock and allows hiring after the unlock", () => {
  const state = newGame();
  const warnings = [];
  let autosaves = 0;
  const scene = {
    gameState: state,
    messages: { show: (message) => warnings.push(message) },
    saves: { requestAutosave: () => { autosaves += 1; } },
  };
  const staffSystem = new StaffSystem(scene);
  staffSystem.canManage = () => true;
  assert.equal(staffSystem.hire("tavi_stock_clerk"), false);
  const needed = getShopLevelRequirement(FIRST_STAFF_LEVEL);
  assert.match(warnings[0], new RegExp(`Shop Level ${FIRST_STAFF_LEVEL}\\b.*${needed} store reputation`));
  assert.equal(state.economy.credits, TEST_STARTING_TEMPLATE.money);
  assert.equal(autosaves, 0);

  state.reputation.gain(needed);
  state.finishShift({ customersServed: needed, customersTurnedAway: 0 });
  assert.equal(staffSystem.hire("tavi_stock_clerk"), true);
  assert.equal(state.economy.credits, TEST_STARTING_TEMPLATE.money - EMPLOYEE_HIRE_COST);
  assert.equal(autosaves, 1);
});

test("taking an employee off shift is between shifts only, stops wages, and keeps them hired", () => {
  const state = newGame();
  state.reputation.shopLevel = FIRST_STAFF_LEVEL;
  assert.equal(state.hireEmployee("tavi_stock_clerk"), true);
  const creditsAfterHire = state.economy.credits;
  const messages = [];
  let autosaves = 0;
  const scene = {
    gameState: state,
    employees: [],
    messages: { show: (message) => messages.push(message) },
    saves: { requestAutosave: () => { autosaves += 1; } },
  };
  const staffSystem = new StaffSystem(scene);
  staffSystem.canManage = () => false;

  assert.equal(staffSystem.setOnShift("tavi_stock_clerk", false), false);
  assert.match(messages[0], /between shifts/);
  assert.deepEqual(state.staff.offShift, []);

  staffSystem.canManage = () => true;
  assert.equal(staffSystem.setOnShift("tavi_stock_clerk", false), true);
  assert.deepEqual(state.staff.hired, ["tavi_stock_clerk"]);
  assert.match(messages[1], /Off Shift.*won't be paid/i);
  assert.equal(staffSystem.payWages(), 0);
  assert.equal(state.economy.credits, creditsAfterHire);
  staffSystem.spawnWorking();
  assert.deepEqual(scene.employees, []);
  assert.equal(autosaves, 1);

  const restored = reload(state);
  assert.deepEqual(restored.staff.offShift, ["tavi_stock_clerk"]);
  assert.equal(staffSystem.setOnShift("tavi_stock_clerk", true), true);
  assert.equal(staffSystem.payWages(), EMPLOYEE_BASE_WAGE);
});

test("moving employee jobs preserves full order and saves only valid between-shift changes", () => {
  const state = newGame();
  state.reputation.shopLevel = FIRST_STAFF_LEVEL;
  state.hireEmployee("tavi_stock_clerk");
  const messages = [];
  let autosaves = 0;
  const staffSystem = new StaffSystem({
    gameState: state,
    messages: { show: (message) => messages.push(message) },
    saves: { requestAutosave: () => { autosaves += 1; } },
  });
  const employeeId = "tavi_stock_clerk";
  state.staff.jobPriorities[employeeId] = ["register", "stock_shelves", "clean"];
  staffSystem.canManage = () => false;
  assert.equal(staffSystem.moveJob(employeeId, "clean", 1), false);
  assert.match(messages[0], /between shifts/);
  assert.deepEqual(state.staff.jobPriorities[employeeId], ["register", "stock_shelves", "clean"]);
  staffSystem.canManage = () => true;
  assert.equal(staffSystem.moveJob(employeeId, "clean", 1), true);
  assert.deepEqual(state.staff.jobPriorities[employeeId], ["register", "clean", "stock_shelves"]);
  assert.equal(staffSystem.moveJob(employeeId, "register", 2), true);
  assert.deepEqual(reload(state).staff.jobPriorities[employeeId], ["clean", "stock_shelves", "register"]);
  for (const [id, job, index] of [
    [employeeId, "register", 2], [employeeId, "register", -1],
    [employeeId, "clean", 3], [employeeId, "unknown", 1],
    ["not-hired", "clean", 1], [employeeId, "clean", 0.5],
  ]) {
    assert.equal(staffSystem.moveJob(id, job, index), false);
  }
  assert.equal(autosaves, 2);
});

test("training can only be booked between shifts and trainees are paid without spawning for work", () => {
  const state = newGame();
  state.reputation.shopLevel = FIRST_STAFF_LEVEL;
  state.hireEmployee("tavi_stock_clerk");
  const warnings = [];
  let autosaves = 0;
  const scene = {
    gameState: state,
    employees: [],
    messages: { show: (message) => warnings.push(message) },
    saves: { requestAutosave: () => { autosaves += 1; } },
  };
  const staffSystem = new StaffSystem(scene);
  staffSystem.canManage = () => false;
  assert.equal(staffSystem.train("tavi_stock_clerk", "register"), false);
  assert.match(warnings[0], /between shifts/);
  const afterHire = TEST_STARTING_TEMPLATE.money - EMPLOYEE_HIRE_COST;
  assert.equal(state.economy.credits, afterHire);
  staffSystem.canManage = () => true;
  assert.equal(staffSystem.train("tavi_stock_clerk", "register"), true);
  assert.equal(autosaves, 1);
  assert.equal(staffSystem.setOnShift("tavi_stock_clerk", false), false);
  assert.match(warnings.at(-1), /away training/);
  assert.equal(staffSystem.payWages(), EMPLOYEE_BASE_WAGE);
  assert.equal(state.economy.credits, afterHire - getEmployeeTrainingCost(0) - EMPLOYEE_BASE_WAGE);
  staffSystem.spawnWorking();
  assert.deepEqual(scene.employees, []);
  state.finishShift({ customersServed: 0, customersTurnedAway: 0 });
  assert.equal(state.staff.profile("tavi_stock_clerk").skillLevels.register, 2);
  assert.equal(staffSystem.payWages(), EMPLOYEE_BASE_WAGE + Math.ceil(EMPLOYEE_BASE_WAGE / 10));
});

test("actual store price edits preserve cents and explain invalid prices", () => {
  const scene = Object.create(GameScene.prototype);
  const prices = new Map([["ration", 10]]);
  const warnings = [];
  scene.gameState = { catalog: { setPrice: (id, price) => prices.set(id, price) } };
  scene.messages = { show: (message) => warnings.push(message) };
  scene.catalogSystem = new CatalogSystem(scene);
  assert.equal(scene.catalogSystem.setStorePrice("ration", 10.23), true);
  assert.equal(prices.get("ration"), 10.23);
  for (const invalid of [0.99, 10.234, NaN, Infinity]) {
    assert.equal(scene.catalogSystem.setStorePrice("ration", invalid), false);
    assert.equal(prices.get("ration"), 10.23);
  }
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /two decimal places/);
});

test("customers queue without opening the register while the tablet is open", () => {
  const { scene, checkout, tablet } = createRegisterHarness();
  tablet.isOpen = true;
  const first = { cart: [{ itemId: "rifle", price: 100 }] };
  const second = { cart: [{ itemId: "pistol", price: 50 }] };
  scene.checkoutSystem.handleJoinQueue(first);
  scene.checkoutSystem.handleJoinQueue(second);
  assert.deepEqual(scene.checkoutSystem.lineFor(scene.fixtures.register()), [first, second]);
  assert.equal(checkout.uiWindow.isOpen, false);
  assert.deepEqual(checkout.openedCarts, []);
  tablet.isOpen = false;
  scene.checkoutSystem.resumeRegisterCheckout();
  assert.equal(checkout.uiWindow.isOpen, true);
  assert.deepEqual(checkout.openedCarts, [first.cart]);
});

test("hiding checkout for the tablet preserves scanned items and payment progress on return", () => {
  const { scene, checkout, tablet } = createRegisterHarness();
  const customer = { cart: [{ itemId: "rifle", price: 100 }] };
  scene.checkoutSystem.handleJoinQueue(customer);
  const onComplete = checkout.onComplete;
  checkout.paymentBuffer = "10";
  checkout.isScanning = true;
  tablet.isOpen = true;
  checkout.suspend();
  assert.equal(checkout.uiWindow.isOpen, false);
  assert.equal(checkout.isScanning, false);
  scene.checkoutSystem.resumeRegisterCheckout();
  assert.equal(checkout.uiWindow.isOpen, false);

  tablet.isOpen = false;
  scene.checkoutSystem.resumeRegisterCheckout();
  assert.equal(checkout.uiWindow.isOpen, true);
  assert.equal(checkout.onComplete, onComplete);
  assert.equal(checkout.paymentBuffer, "10");
  assert.equal(checkout.openedCarts.length, 1);
});

test("stepping away from the register mid-sale and coming back resumes the same sale", () => {
  const { scene, checkout } = createRegisterHarness();
  const customer = { cart: [{ itemId: "rifle", price: 100 }] };
  scene.checkoutSystem.handleJoinQueue(customer);
  checkout.paymentBuffer = "10";
  checkout.suspend(); // what leaving the register does mid-sale
  scene.checkoutSystem.startCheckout(customer);
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
  scene.checkoutSystem.handleJoinQueue(customer);
  checkout.mode = null; // the sale was thrown away
  scene.checkoutSystem.startCheckout(customer);
  assert.equal(options.length, 2);
  assert.equal(options[1].paymentType, options[0].paymentType);
  assert.equal(options[1].exact, options[0].exact);
  assert.equal(options[1].chitCode, options[0].chitCode);
});

test("a customer leaving while the tablet is open cannot leave a stale checkout to resume", () => {
  const { scene, checkout, tablet } = createRegisterHarness();
  const first = { cart: [{ itemId: "rifle", price: 100 }] };
  const second = { cart: [{ itemId: "pistol", price: 50 }] };
  scene.checkoutSystem.handleJoinQueue(first);
  tablet.isOpen = true;
  checkout.suspend();
  scene.checkoutSystem.handleJoinQueue(second);
  scene.checkoutSystem.handleAngryLeave(first, first.cart);
  assert.equal(checkout.mode, null);
  assert.equal(checkout.onComplete, null);
  assert.equal(checkout.uiWindow.isOpen, false);
  assert.deepEqual(scene.checkoutSystem.lineFor(scene.fixtures.register()), [second]);

  tablet.isOpen = false;
  scene.checkoutSystem.resumeRegisterCheckout();
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
  scene.checkoutSystem.resumeRegisterCheckout();
  assert.equal(checkout.uiWindow.isOpen, false);
  scene.checkoutSystem.operatingRegister = false;
  scene.checkoutSystem.lineFor(scene.fixtures.register()).push({ cart: [] });
  scene.checkoutSystem.resumeRegisterCheckout();
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
    carriedCrates: [{ id: "crate_1" }],
    carriedCrate: { id: "crate_1" },
    messages: { show: (text) => messages.push(text) },
  });
  scene.crateSystem = { getCarriedCrates: () => scene.carriedCrates, syncCarriedCrate() {}, syncFloorStacks() {} };
  scene.checkoutSystem = new CheckoutSystem(scene);
  scene.checkoutSystem.beginRegisterSession(register);
  assert.equal(scene.checkoutSystem.operatingRegister, false);
  assert.equal(sprite.body.enable, true);
  assert.match(messages[0], /Put down what you're carrying/);

  scene.carriedCrates = [];
  scene.carriedCrate = null;
  scene.checkoutSystem.beginRegisterSession(register);
  assert.equal(scene.checkoutSystem.operatingRegister, true);
});

test("a customer arriving while the player holds crates near the register never opens checkout", () => {
  const { scene, checkout } = createRegisterHarness();
  scene.checkoutSystem.operatingRegister = false;
  scene.checkoutSystem.operatingRegisterFixture = null;
  scene.carriedCrates = [{ id: "crate_1" }];
  scene.checkoutSystem.getNearbyRegisterTarget = () => scene.fixtures.register();
  scene.messages = { show() {} };
  scene.checkoutSystem.handleJoinQueue({ cart: [{ itemId: "rifle", price: 100 }] });
  assert.equal(checkout.uiWindow.isOpen, false);
  assert.equal(scene.checkoutSystem.operatingRegister, false);
});

test("manual save persists the current shop and confirms unchanged saves without another write", async () => {
  const { scene, writes, messages, controls } = createHarness();
  await scene.saves.saveManually();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].slots[0].data.shop, { credits: 436 });
  assert.equal(scene.saves.lastSavedSnapshot, JSON.stringify({ credits: 436 }));
  assert.deepEqual(messages, ["Game saved."]);
  assert.equal(controls.at(-1).canSave, true);
  assert.equal(controls.at(-1).saving, false);

  await scene.saves.saveManually();
  assert.equal(writes.length, 1);
  assert.equal(messages.at(-1), "Game saved.");
});

test("manual save shows busy controls until the write finishes", async () => {
  let finishWrite;
  const { scene, controls, messages } = createHarness(() =>
    new Promise((resolve) => { finishWrite = resolve; }),
  );
  const saving = scene.saves.saveManually();
  assert.equal(controls.at(-1).saving, true);
  assert.equal(messages.length, 0);

  await new Promise((resolve) => setImmediate(resolve));
  finishWrite(true);
  await saving;
  assert.equal(controls.at(-1).saving, false);
  assert.equal(messages.at(-1), "Game saved.");
});

test("play time is saved during shifts without overwriting the last closed-shop checkpoint", async () => {
  const { scene } = createHarness();
  scene.saves.updatePlayTime(10000);
  await scene.saves.saveManually();
  const slotId = scene.saves.manager.slotId;
  scene.shiftClock.started = true;
  scene.credits = 1000;
  scene.saves.updatePlayTime(12000);
  await scene.saves.flushMetadata();
  const slot = await scene.saves.manager.read(slotId);
  assert.equal(slot.playTimeMs, 22000);
  assert.deepEqual(slot.data.shop, { credits: 436 });
  assert.equal(scene.saves.canWrite(), false);
});

test("manual save failures use the save error path and never confirm success", async () => {
  const failure = new Error("Disk full");
  const { scene, errors, messages, controls } = createHarness(async () => { throw failure; });
  await scene.saves.saveManually();
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(messages, []);
  assert.equal(scene.saves.lastSavedSnapshot, null);
  assert.equal(scene.saves.inProgress, null);
  assert.equal(controls.at(-1).saving, false);
  assert.match(scene.saves.status, /Disk full/);
});

test("manual saving stays blocked mid-shift, while starting a shift, and after a load error", async () => {
  for (const flags of [
    { shiftClock: { started: true, isPaused: false } },
    { shiftClock: { started: true, isPaused: true } },
    { shift: { starting: true, ended: false } },
    { saves: { loadFailed: true } },
  ]) {
    const { scene, writes, messages, controls } = createHarness();
    if (flags.saves) Object.assign(scene.saves, flags.saves);
    else Object.assign(scene, flags);
    scene.saves.updateControls();
    assert.equal(controls.at(-1).canSave, false);
    await scene.saves.saveManually();
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
  const hud = new HUDController(newGame(), {
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

test("all placeable fixture physics bodies match the solid part of their placement bounds", () => {
  const views = new FixtureViews(Object.create(GameScene.prototype));
  const tree = { remove() {}, insert() {} };
  const body = { world: { staticTree: tree }, position: { set(x, y) { this.x = x; this.y = y; } },
    center: { set(x, y) { this.x = x; this.y = y; } } };
  const sprite = { displayWidth: 0, displayHeight: 0, body,
    setTexture() { return this; },
    setDisplaySize(width, height) { this.displayWidth = width; this.displayHeight = height; return this; },
    setPosition() { return this; }, setAngle(angle) { this.angle = angle; return this; }, play() { return this; },
    setDepth(depth) { this.depth = depth; return this; } };
  for (const type of Object.keys(FIXTURE_TYPES)) {
    for (let rotation = 0; rotation < 4; rotation++) {
      if (FIXTURE_TYPES[type].fixedFacing && rotation !== 0) continue;
      const fixture = { type, x: 832, y: 192, rotation, sprite };
      views.orient(fixture);
      const footprint = fixtureFootprint(fixture);
      const bounds = fixtureSolidBounds({ ...fixture, gx: 832 / 64 - footprint.w / 2, gy: 192 / 64 - footprint.h / 2 });
      assert.ok(Math.abs(body.width - (bounds.right - bounds.left) * 64) < 1e-9);
      assert.ok(Math.abs(body.height - (bounds.bottom - bounds.top) * 64) < 1e-9);
      assert.ok(Math.abs(body.position.x - bounds.left * 64) < 1e-9);
      assert.ok(Math.abs(body.position.y - bounds.top * 64) < 1e-9);
      assert.equal(sprite.angle, 0);
    }
  }
});

test("the register's solid box leaves its front strip open, like customer routes", () => {
  const views = new FixtureViews(Object.create(GameScene.prototype));
  const makeBody = () => ({ world: { staticTree: { remove() {}, insert() {} } },
    position: { set(x, y) { this.x = x; this.y = y; } }, center: { set() {} } });
  const sprite = { body: makeBody(), setTexture() { return this; }, setDisplaySize() { return this; },
    setPosition() { return this; }, setAngle() { return this; }, setDepth() { return this; } };
  for (let rotation = 0; rotation < 4; rotation++) {
    const registerSolid = { body: makeBody() };
    views.orient({ type: "register_basic", x: 832, y: 192, rotation, sprite, registerSolid });
    const full = sprite.body;
    const solid = registerSolid.body;
    const { dx, dy } = fixtureFacingStep({ type: "register_basic", rotation });
    assert.equal(solid.width, full.width - (dx ? 10 : 0));
    assert.equal(solid.height, full.height - (dy ? 10 : 0));
    assert.equal(solid.position.x, full.position.x + (dx < 0 ? 10 : 0));
    assert.equal(solid.position.y, full.position.y + (dy < 0 ? 10 : 0));
  }
});

test("side-facing register queue and cashier align with the body box rather than transparent art", () => {
  const scene = Object.create(GameScene.prototype);
  const body = { width: 30, height: 68, center: { x: 100, y: 100 } };
  const register = { type: "register_basic", rotation: 1, sprite: { body } };
  scene.checkoutSystem = new CheckoutSystem(scene);
  scene.fixtures = { register: () => register };
  scene.player = { sprite: { displayWidth: 48, displayHeight: 72 } };
  assert.deepEqual(scene.checkoutSystem.behindRegisterPoint(), { x: 129, y: 100 });
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
      scene.crateSystem = { getCarriedCrates: () => [], syncCarriedCrate() {}, syncFloorStacks() {} };
      scene.checkoutSystem = new CheckoutSystem(scene);
      scene.player = { sprite, inputEnabled: true,
        teleportTo(x, y) { sprite.x = x; sprite.y = y; }, forceFacing() {} };
      scene.checkoutSystem.beginRegisterSession(register);
      assert.equal(scene.checkoutSystem.operatingRegister, true);
      assert.equal(sprite.body.enable, false);
      assert.ok(Number.isFinite(sprite.x) && Number.isFinite(sprite.y));
      scene.checkoutSystem.endRegisterSession();
      assert.equal(scene.checkoutSystem.operatingRegister, false);
      assert.equal(sprite.body.enable, true);
      assert.equal(scene.player.inputEnabled, true);
      assert.deepEqual({ x: sprite.x, y: sprite.y, depth: sprite.depth }, { x: 200, y: 200, depth: 2 });
      assert.equal(register.sprite.depth, 1, "the counter is back at its normal depth");
    }
  });
});

test("the budget shelf art fills its footprint in every direction; only its feet or visible sides are solid", () => {
  const views = new FixtureViews(Object.create(GameScene.prototype));
  const tree = { remove() {}, insert() {} };
  const body = { world: { staticTree: tree }, position: { set() {} }, center: { set() {} } };
  const sprite = {
    displayWidth: 0, displayHeight: 0, body,
    setTexture(key) {
      this.texture = key;
      this.displayWidth = 256;
      this.displayHeight = key.endsWith("_left_narrow") || key.endsWith("_right_narrow") ? 375 : 256;
      return this;
    },
    setDisplaySize(width, height) { this.displayWidth = width; this.displayHeight = height; return this; },
    setPosition() { return this; },
    setAngle(angle) { this.angle = angle; return this; },
    setDepth(depth) { this.depth = depth; return this; },
  };
  for (let rotation = 0; rotation < 4; rotation++) {
    views.orient({ type: "shelf_budget_2x2", x: 100, y: 200, rotation, sprite });
    const [width, height] = rotation % 2 === 0 ? [72, 64] : [64, 72];
    assert.equal(sprite.displayWidth, width);
    assert.equal(sprite.displayHeight, height);
    assert.equal(sprite.angle, 0);
    // Facing up/down only the bottom 24px (half the player's height) is solid; facing
    // left/right the art leaves empty bands at its sides.
    const [solidWidth, solidHeight] = rotation % 2 === 0 ? [68, 24] : [64 / 3, 68];
    assert.ok(Math.abs(body.width - solidWidth) < 1e-10);
    assert.equal(body.height, solidHeight);
  }
});
