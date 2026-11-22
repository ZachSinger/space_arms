import { GAME_EVENTS } from "../core/Events.js";

const MAX_EVENTS = 200;
const MAX_ERRORS = 50;
const MAX_INPUTS = 100;

function safeErrorText(value) {
  return String(value ?? "").replace(
    /(?:[A-Za-z]:[\\/]|file:\/\/\/)[^\s)]+/g,
    (filePath) => filePath.split(/[\\/]/).pop() || "<local file>",
  );
}

function safeStack(error) {
  return typeof error?.stack === "string" ? safeErrorText(error.stack) : undefined;
}

export class RecentDiagnostics {
  constructor(scene, environment = window) {
    this.scene = scene;
    this.environment = environment;
    this.startedAt = Date.now();
    this.events = [];
    this.errors = [];
    this.inputs = [];
    this.handleError = (event) => this.recordError({
      type: "runtime-error",
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack,
    });
    this.handleRejection = (event) => this.recordError({
      type: "unhandled-rejection",
      message: event.reason?.message ?? String(event.reason),
      stack: event.reason?.stack,
    });
    this.handleKeyDown = (event) => {
      if (!event.isTrusted || event.repeat || this.isPrivateInput(event.target)) return;
      this.recordInput({ device: "keyboard", code: event.code || event.key });
    };
    this.handleMouseDown = (event) => {
      if (!event.isTrusted || this.isPrivateInput(event.target)) return;
      this.recordInput({
        device: "mouse",
        button: event.button,
        target: event.target === scene.game.canvas ? "game" : event.target?.id || event.target?.tagName || "interface",
      });
    };

    environment.addEventListener("error", this.handleError);
    environment.addEventListener("unhandledrejection", this.handleRejection);
    environment.addEventListener("keydown", this.handleKeyDown, true);
    environment.addEventListener("mousedown", this.handleMouseDown, true);
    this.listenToGameEvents(scene.eventBus);
  }

  isPrivateInput(target) {
    return Boolean(target?.closest?.(
      "input, textarea, select, [contenteditable='true'], #bug-report-window, .settings-window",
    ));
  }

  stamp() {
    return {
      at: new Date().toISOString(),
      shiftDay: this.scene.gameState.calendar.day,
      elapsedMs: this.scene.shiftClock.getElapsedMs(),
    };
  }

  recordInput(input) {
    this.inputs.push({ ...this.stamp(), ...input });
    if (this.inputs.length > MAX_INPUTS) this.inputs.shift();
  }

  recordError(error) {
    this.errors.push({
      ...this.stamp(),
      type: error.type,
      message: safeErrorText(error.message),
      filename: safeErrorText(error.filename),
      line: error.line,
      column: error.column,
      stack: safeStack({ stack: error.stack }),
    });
    if (this.errors.length > MAX_ERRORS) this.errors.shift();
  }

  recordEvent(type, details = {}) {
    const safeDetails = {};
    for (const [key, value] of Object.entries(details ?? {})) {
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
        safeDetails[key] = value;
      } else if (Array.isArray(value) && value.every((entry) => ["string", "number", "boolean"].includes(typeof entry))) {
        safeDetails[key] = value;
      }
    }
    this.events.push({ ...this.stamp(), type, details: safeDetails });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  listenToGameEvents(eventBus) {
    if (!eventBus) return;
    for (const [event, name] of [
      [GAME_EVENTS.CUSTOMER_HIT_BY_CRATE, "customer-hit-by-crate"],
      [GAME_EVENTS.CUSTOMER_MISSING_PRIMARY, "customer-missing-primary"],
      [GAME_EVENTS.CRATE_PICKED_UP, "crate-picked-up"],
      [GAME_EVENTS.CRATE_DROPPED, "crate-dropped"],
      [GAME_EVENTS.FIXTURE_OPENED, "fixture-opened"],
      [GAME_EVENTS.INVENTORY_TRANSFERRED, "inventory-transferred"],
      [GAME_EVENTS.REGISTER_SESSION_ENDED, "register-session-ended"],
      [GAME_EVENTS.REGISTER_SESSION_STARTED, "register-session-started"],
      [GAME_EVENTS.SHIFT_ENDED, "shift-ended"],
      [GAME_EVENTS.SHIFT_STARTED, "shift-started"],
    ]) {
      eventBus.on(event, (details) => this.recordEvent(name, details));
    }
  }

  destroy() {
    this.environment.removeEventListener("error", this.handleError);
    this.environment.removeEventListener("unhandledrejection", this.handleRejection);
    this.environment.removeEventListener("keydown", this.handleKeyDown, true);
    this.environment.removeEventListener("mousedown", this.handleMouseDown, true);
  }
}
