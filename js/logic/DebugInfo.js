// ==========================================
// FILE: DebugInfo.js
// ==========================================
// The HUD "Debug Info" button: keeps a ring buffer of recent game events and errors, and
// captures a JSON snapshot of the live scene to disk through the desktop app.
// See also: main.js (writes captures to the debug folder).
import { CUSTOMER_POOL_TUNING } from "./CustomerPooling.js";
import { SHIFT_DURATION_MS } from "./ShiftClock.js";

// Oldest events are dropped past this count.
const MAX_RECENT_EVENTS = 200;

function point(value) {
  return value ? { x: value.x, y: value.y } : null;
}

function spriteState(sprite) {
  if (!sprite) return null;
  return {
    ...point(sprite),
    velocity: point(sprite.body?.velocity),
    bodyEnabled: sprite.body?.enable,
    texture: sprite.texture?.key,
    visible: sprite.visible,
  };
}

/**
 * Deep copy that survives JSON: Sets/Maps become arrays/objects, and NaN/Infinity become
 * strings instead of silently turning into null.
 * @param {any} value
 */
function diagnosticCopy(value) {
  return JSON.parse(JSON.stringify(value, (key, entry) => {
    if (entry instanceof Set) return [...entry];
    if (entry instanceof Map) return Object.fromEntries(entry);
    if (typeof entry === "number" && !Number.isFinite(entry)) return String(entry);
    return entry;
  }));
}

/**
 * Plain-object view of a customer's AI and shopping state.
 * @param {object} customer
 * @param {number} id - stable debug id from DebugInfo.identifyCustomer
 */
export function snapshotCustomer(customer, id) {
  const plan = customer.shoppingPlan;
  return {
    id,
    factionId: customer.factionId,
    traits: customer.traits,
    state: customer.state,
    sprite: spriteState(customer.sprite),
    destroyed: customer.isDestroyed,
    shoppingPhase: customer.shoppingPhase,
    fixtureId: customer.fixture?.id ?? null,
    shelfStopIndex: customer.shelfStopIndex,
    phaseItemIds: customer.phaseItemIds,
    primaryBought: customer.primaryBought,
    primaryMissing: customer.primaryMissing,
    bonusBought: customer.bonusBought,
    bonusAttempted: customer.bonusAttempted,
    purchasedFirearms: customer.purchasedFirearms,
    shoppingPlan: plan ? {
      primaryItemIds: plan.primaryItemIds,
      bonusItemIds: plan.bonusItemIds,
      matchingAmmoIdsByFirearm: plan.matchingAmmoIdsByFirearm,
      shelfIds: plan.shelfStops?.map(({ fixture }) => fixture.id),
    } : null,
    cart: customer.cart,
    priceTolerance: customer.priceTolerance,
    patienceRemainingMs: customer.patienceRemainingMs,
    seekingTimer: customer.seekingTimer,
    leavingTimer: customer.leavingTimer,
    destination: point(customer.destination),
    reservedTarget: point(customer.reservedTarget),
    queueTarget: point(customer.queueTarget),
    path: customer.path?.map(point),
  };
}

/**
 * Read raw runtime state rather than the save validator: invalid state is evidence, too.
 * @param {Phaser.Scene} scene
 * @param {(customer: object) => number} identifyCustomer
 * @param {object[]} recentEvents
 * @param {Window} environment
 */
export function createDebugSnapshot(scene, identifyCustomer, recentEvents, environment = window) {
  const clock = scene.shiftClock;
  const camera = scene.cameras.main;
  return diagnosticCopy({
    formatVersion: 1,
    requestedAt: new Date().toISOString(),
    environment: {
      userAgent: environment.navigator.userAgent,
      viewport: { width: environment.innerWidth, height: environment.innerHeight },
      canvas: { width: scene.game.canvas.width, height: scene.game.canvas.height },
      fps: scene.game.loop.actualFps,
      camera: {
        scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom,
        width: camera.width, height: camera.height,
      },
    },
    shift: {
      marketDay: scene.market.day,
      durationMs: SHIFT_DURATION_MS,
      elapsedMs: clock.getElapsedMs(),
      displayedTime: clock.getFormattedTime(),
      started: clock.started,
      paused: clock.isPaused,
      softClosed: clock.softClosed,
      ended: scene.shiftEnded,
      starting: scene.startingShift,
      customersServed: scene.customersServedThisShift,
      creditsAtStart: scene.creditsAtShiftStart,
      reputationAtStart: scene.reputationAtShiftStart,
    },
    player: {
      ...scene.playerState.serialize(),
      activeFactions: scene.playerState.activeFactions,
      sprite: spriteState(scene.player.sprite),
      inputEnabled: scene.player.inputEnabled,
      operatingRegister: scene.operatingRegister,
    },
    traffic: {
      tuning: CUSTOMER_POOL_TUNING,
      poolAtShiftStart: scene.customerPoolAtShiftStart ?? scene.customerPool,
      currentPool: scene.customerPool,
      arrivalSchedule: scene.customerArrivalSchedule,
      nextScheduledArrival: scene.nextScheduledArrival,
      remainingScheduledArrivals: scene.customerArrivalSchedule.length - scene.nextScheduledArrival,
      registerLine: scene.registerLine.map(identifyCustomer),
    },
    customers: scene.customers.map((customer) =>
      snapshotCustomer(customer, identifyCustomer(customer)),
    ),
    fixtures: scene.fixtures.all().map((fixture) => ({
      id: fixture.id, type: fixture.type, gx: fixture.gx, gy: fixture.gy,
      x: fixture.x, y: fixture.y,
      standPoint: point(fixture.standPoint),
      placements: fixture.placements,
      stock: fixture.stock,
      capacity: fixture.capacity,
    })),
    crates: scene.restockCrates.map((crate) => crate.serialize()),
    carriedCrate: scene.carriedCrate ? {
      ...scene.carriedCrate.serializePayload(),
      sprite: spriteState(scene.carriedCrate.sprite),
    } : null,
    rooms: scene.room.zones.map(({ id, locked }) => ({ id, locked })),
    market: scene.market.serialize(),
    ui: {
      openWindows: [...scene.windowManager.windows.values()]
        .filter((win) => win.isOpen)
        .map((win) => ({
          id: win.id, title: win.title,
          bounds: point({ x: win.element.offsetLeft, y: win.element.offsetTop }),
          width: win.element.offsetWidth, height: win.element.offsetHeight,
        })),
      fixtureId: scene.fixtureWindow.fixture?.id ?? null,
      pendingShelfPlacement: scene.fixtureWindow.pendingPlacement,
      fixturePlacement: {
        active: scene.fixturePlacement.active,
        placement: scene.fixturePlacement.placement,
        originalId: scene.fixturePlacement.original?.id ?? null,
      },
      checkout: {
        mode: scene.checkoutWindow.mode,
        total: scene.checkoutWindow.total,
        scannedCards: [...scene.checkoutWindow.uiWindow.element.querySelectorAll("[data-scanned]")]
          .map((card) => ({ index: card.dataset.index, scanned: card.dataset.scanned })),
      },
    },
    persistence: {
      status: scene.saveStatus,
      loadFailed: scene.loadFailed,
      autosaveBlocked: scene.autosaveBlocked,
      saveInProgress: Boolean(scene.saveInProgress),
      autosaveQueued: scene.autosaveQueued,
    },
    recentEvents,
  });
}

/**
 * Owned by the game scene for one session; call destroy() when the scene shuts down.
 */
export class DebugInfo {
  constructor(scene, environment = window) {
    this.scene = scene;
    this.environment = environment;
    this.recentEvents = [];
    this.customerIds = new WeakMap();
    this.nextCustomerId = 1;
    this.busy = false;
    this.destroyed = false;
    const document = environment.document;
    this.button = document.getElementById("hud-debug-info-btn");
    this.feedback = document.getElementById("debug-feedback");
    this.status = document.getElementById("debug-status");
    this.folderButton = document.getElementById("debug-folder-btn");
    this.feedback.classList.add("hidden");
    this.folderButton.classList.add("hidden");
    this.button.disabled = false;
    this.handleCapture = () => this.capture();
    this.handleOpenFolder = () => this.openFolder();
    this.handleError = (event) => this.record("runtime-error", {
      message: event.message, filename: event.filename,
      line: event.lineno, column: event.colno, stack: event.error?.stack,
    });
    this.handleRejection = (event) => this.record("unhandled-rejection", {
      message: String(event.reason), stack: event.reason?.stack,
    });
    this.button.addEventListener("click", this.handleCapture);
    this.folderButton.addEventListener("click", this.handleOpenFolder);
    environment.addEventListener("error", this.handleError);
    environment.addEventListener("unhandledrejection", this.handleRejection);
  }

  /**
   * Stable small id per customer so events and snapshots can be cross-referenced.
   * @param {object} customer
   */
  identifyCustomer(customer) {
    if (!this.customerIds.has(customer)) this.customerIds.set(customer, this.nextCustomerId++);
    return this.customerIds.get(customer);
  }

  /**
   * Add an event to the recent-events buffer included in captures.
   * @param {string} type
   * @param {object} details
   */
  record(type, details) {
    this.recentEvents.push(diagnosticCopy({
      at: new Date().toISOString(),
      shiftDay: this.scene.market.day,
      elapsedMs: this.scene.shiftClock.getElapsedMs(),
      type,
      details,
    }));
    if (this.recentEvents.length > MAX_RECENT_EVENTS) this.recentEvents.shift();
  }

  recordCustomer(type, customer) {
    this.record(type, snapshotCustomer(customer, this.identifyCustomer(customer)));
  }

  showStatus(message, failed = false) {
    if (this.destroyed) return;
    this.feedback.classList.remove("hidden");
    this.feedback.classList.toggle("debug-error", failed);
    this.status.textContent = message;
  }

  // Snapshot the scene and ask the desktop app to save it; reports the result in the HUD.
  async capture() {
    if (this.busy || this.destroyed) return;
    this.busy = true;
    this.button.disabled = true;
    this.feedback.classList.add("hidden");
    try {
      const api = this.environment.desktopApi;
      if (!api?.captureDebugInfo) {
        throw new Error("Debug Info requires the desktop app. Run npm start while npm run dev is running.");
      }
      const snapshot = createDebugSnapshot(
        this.scene, (customer) => this.identifyCustomer(customer),
        this.recentEvents, this.environment,
      );
      const result = await api.captureDebugInfo(snapshot);
      if (!Number.isInteger(result?.captureNumber) || typeof result.directory !== "string") {
        throw new Error("The desktop app did not confirm the debug capture.");
      }
      if (this.destroyed) return;
      this.folderButton.classList.remove("hidden");
      this.folderButton.title = result.directory;
      this.showStatus(`Debug #${String(result.captureNumber).padStart(4, "0")} saved.`);
    } catch (error) {
      console.error("Debug Info capture failed", error);
      this.record("debug-capture-error", { message: error.message, stack: error.stack });
      this.showStatus(`Debug Info failed: ${error.message}`, true);
    } finally {
      this.busy = false;
      if (!this.destroyed) this.button.disabled = false;
    }
  }

  async openFolder() {
    try {
      const opened = await this.environment.desktopApi.openDebugFolder();
      if (opened !== true) throw new Error("The desktop app did not open the debug folder.");
    } catch (error) {
      console.error("Debug folder could not be opened", error);
      this.showStatus(`Debug folder failed: ${error.message}`, true);
    }
  }

  destroy() {
    this.destroyed = true;
    this.button.removeEventListener("click", this.handleCapture);
    this.folderButton.removeEventListener("click", this.handleOpenFolder);
    this.environment.removeEventListener("error", this.handleError);
    this.environment.removeEventListener("unhandledrejection", this.handleRejection);
    this.feedback.classList.add("hidden");
  }
}
