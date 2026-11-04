import assert from "node:assert/strict";
import test from "node:test";
import { DebugInfo, createDebugSnapshot } from "../js/logic/DebugInfo.js";

function fixtureScene() {
  const fixture = {
    id: "shelf_1", type: "shelf_test", gx: 2, gy: 3,
    placements: [{ itemId: "ammo", quantity: -1 }],
  };
  fixture.self = fixture;
  const customer = {
    state: "QUEUEING", factionId: "mercenaries", fixture,
    sprite: { x: 10, y: 20, body: { velocity: { x: 0, y: 0 }, enable: true } },
    primaryBought: new Set(["ammo"]), primaryMissing: new Set(),
    shoppingPlan: {
      primaryItemIds: ["ammo"], bonusItemIds: [],
      shelfStops: [{ fixture }], matchingAmmoIdsByFirearm: {},
    },
    cart: [{ itemId: "ammo", price: 5 }],
    path: [{ x: 11, y: 20 }],
    patienceRemainingMs: 30000,
  };
  return {
    shiftClock: {
      getElapsedMs: () => 4000, getFormattedTime: () => "08:04",
      started: true, isPaused: false, softClosed: false,
    },
    game: { canvas: { width: 1280, height: 720 }, loop: { actualFps: 60 } },
    cameras: { main: { scrollX: 0, scrollY: 0, zoom: 1, width: 1280, height: 720 } },
    player: { sprite: { x: 40, y: 50 }, inputEnabled: true },
    playerState: {
      serialize: () => ({ globalReputation: 5, hovercart: { stock: [] } }),
      activeFactions: new Set(["mercenaries"]),
    },
    market: { day: 1, serialize: () => ({ day: 1, prices: { ammo: 5 } }) },
    customerPool: { totalCustomers: 4, stockScaler: 0.5 },
    customerArrivalSchedule: [{ atMs: 2000, factionId: "mercenaries" }, { atMs: 8000, factionId: null }],
    nextScheduledArrival: 1,
    customers: [customer], registerLine: [customer],
    fixtures: { all: () => [fixture] },
    restockCrates: [{ serialize: () => ({ itemId: "ammo", quantity: 5, velocityX: NaN }) }],
    carriedCrate: null,
    room: { zones: [{ id: "sales_floor", locked: false }] },
    windowManager: { windows: new Map() },
    fixtureWindow: { fixture, pendingPlacement: { itemId: "ammo", moving: { quantity: 3 } } },
    fixturePlacement: { active: false },
    checkoutWindow: { mode: "checkout", total: 5, uiWindow: { element: { querySelectorAll: () => [] } } },
    saveStatus: "Saved", loadFailed: false,
  };
}

function environment(api) {
  const elements = new Map();
  for (const id of ["hud-debug-info-btn", "debug-feedback", "debug-status", "debug-folder-btn"]) {
    const classes = new Set();
    elements.set(id, {
      listeners: new Map(), disabled: false, textContent: "",
      classList: {
        add: (value) => classes.add(value),
        remove: (value) => classes.delete(value),
        contains: (value) => classes.has(value),
        toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); },
      },
      addEventListener(name, handler) { this.listeners.set(name, handler); },
      removeEventListener(name) { this.listeners.delete(name); },
    });
  }
  return {
    desktopApi: api,
    navigator: { userAgent: "debug-test" }, innerWidth: 1280, innerHeight: 720,
    document: { getElementById: (id) => elements.get(id) },
    listeners: new Map(),
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    removeEventListener(name) { this.listeners.delete(name); },
  };
}

test("debug snapshots detach raw runtime state without save validation or Phaser cycles", () => {
  const scene = fixtureScene();
  const snapshot = createDebugSnapshot(scene, () => 7, [], environment());
  assert.equal(snapshot.formatVersion, 1);
  assert.deepEqual(snapshot.player.activeFactions, ["mercenaries"]);
  assert.deepEqual(snapshot.traffic.registerLine, [7]);
  assert.equal(snapshot.traffic.remainingScheduledArrivals, 1);
  assert.deepEqual(snapshot.customers[0].primaryBought, ["ammo"]);
  assert.deepEqual(snapshot.customers[0].shoppingPlan.shelfIds, ["shelf_1"]);
  assert.equal(snapshot.fixtures[0].placements[0].quantity, -1);
  assert.equal(snapshot.crates[0].velocityX, "NaN");
  assert.equal(snapshot.ui.pendingShelfPlacement.moving.quantity, 3);
  scene.fixtures.all()[0].placements[0].quantity = 10;
  scene.customers[0].cart[0].price = 99;
  assert.equal(snapshot.fixtures[0].placements[0].quantity, -1);
  assert.equal(snapshot.customers[0].cart[0].price, 5);
  assert.equal(scene.shiftClock.isPaused, false);
});

test("one click captures once, retains customer IDs, opens the folder, and cleans up listeners", async () => {
  let finishCapture;
  let snapshot;
  let folderOpens = 0;
  const env = environment({
    captureDebugInfo: (value) => {
      snapshot = value;
      return new Promise((resolve) => { finishCapture = resolve; });
    },
    openDebugFolder: async () => { folderOpens += 1; return true; },
  });
  const scene = fixtureScene();
  const debug = new DebugInfo(scene, env);
  const capture = debug.capture();
  assert.equal(debug.button.disabled, true);
  await debug.capture();
  assert.equal(snapshot.customers[0].id, debug.identifyCustomer(scene.customers[0]));
  finishCapture({ captureNumber: 1, directory: "C:\\debug-session" });
  await capture;
  assert.equal(debug.button.disabled, false);
  assert.equal(debug.status.textContent, "Debug #0001 saved.");
  assert.equal(debug.folderButton.classList.contains("hidden"), false);
  await debug.openFolder();
  assert.equal(folderOpens, 1);
  debug.destroy();
  assert.equal(env.listeners.size, 0);
  assert.equal(debug.button.listeners.size, 0);
  assert.equal(debug.folderButton.listeners.size, 0);
});

test("debug events preserve runtime errors and bound the history to the most recent 200", () => {
  const env = environment();
  const debug = new DebugInfo(fixtureScene(), env);
  for (let index = 0; index < 205; index += 1) debug.record("test", { index });
  env.listeners.get("error")({ message: "Broken", filename: "game.js", lineno: 3, error: new Error("Broken") });
  env.listeners.get("unhandledrejection")({ reason: new Error("Rejected") });
  assert.equal(debug.recentEvents.length, 200);
  assert.equal(debug.recentEvents[0].details.index, 7);
  assert.equal(debug.recentEvents.at(-2).type, "runtime-error");
  assert.match(debug.recentEvents.at(-1).details.stack, /Rejected/);
  debug.destroy();
});

test("browser and native capture errors are visible, not success-shaped fallbacks", async (context) => {
  context.mock.method(console, "error", () => {});
  const browserDebug = new DebugInfo(fixtureScene(), environment());
  await browserDebug.capture();
  assert.match(browserDebug.status.textContent, /requires the desktop app/);
  assert.equal(browserDebug.feedback.classList.contains("debug-error"), true);
  assert.equal(browserDebug.button.disabled, false);
  browserDebug.destroy();

  const desktopDebug = new DebugInfo(fixtureScene(), environment({
    captureDebugInfo: async () => { throw new Error("Disk full"); },
    openDebugFolder: async () => { throw new Error("Folder unavailable"); },
  }));
  await desktopDebug.capture();
  assert.match(desktopDebug.status.textContent, /Disk full/);
  assert.equal(desktopDebug.folderButton.classList.contains("hidden"), true);
  await desktopDebug.openFolder();
  assert.match(desktopDebug.status.textContent, /Folder unavailable/);
  desktopDebug.destroy();
});
