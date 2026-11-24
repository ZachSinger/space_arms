import assert from "node:assert/strict";
import test from "node:test";
import { RecentDiagnostics } from "../js/debug/RecentDiagnostics.js";
import { GAME_EVENTS } from "../js/core/Events.js";

function fixture() {
  const listeners = new Map();
  const handlers = new Map();
  const environment = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type, event) {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
  };
  const scene = {
    game: { canvas: {} },
    gameState: { calendar: { day: 4 } },
    shiftClock: { getElapsedMs: () => 2500 },
    eventBus: {
      on(type, handler) {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type).add(handler);
      },
      emit(type, value) {
        for (const handler of handlers.get(type) ?? []) handler(value);
      },
    },
  };
  return { environment, scene, listeners, handlers };
}

test("recent diagnostics retain errors, safe inputs, and useful game events", () => {
  const { environment, scene } = fixture();
  const diagnostics = new RecentDiagnostics(scene, environment);
  environment.dispatch("error", {
    message: "Broken",
    filename: "C:\\Users\\Private\\game.js",
    lineno: 8,
    error: new Error("Broken at C:\\Users\\Private\\game.js:8"),
  });
  environment.dispatch("keydown", {
    isTrusted: true, repeat: false, code: "KeyW",
    target: { closest: () => null },
  });
  environment.dispatch("keydown", {
    isTrusted: true, repeat: false, code: "KeyA",
    target: { closest: () => ({}) },
  });
  scene.eventBus.emit(GAME_EVENTS.CRATE_PICKED_UP, {
    crateId: "crate-1", quantity: 3, crate: { private: "not serialized" },
  });

  assert.equal(diagnostics.errors[0].message, "Broken");
  assert.doesNotMatch(diagnostics.errors[0].stack, /Private/);
  assert.equal(diagnostics.inputs.length, 1);
  assert.equal(diagnostics.inputs[0].code, "KeyW");
  assert.equal(diagnostics.events[0].details.crateId, "crate-1");
  assert.equal(Object.hasOwn(diagnostics.events[0].details, "crate"), false);
  diagnostics.destroy();
});

test("recent diagnostics bound each history and remove global listeners", () => {
  const { environment, scene, listeners } = fixture();
  const diagnostics = new RecentDiagnostics(scene, environment);
  for (let index = 0; index < 110; index += 1) {
    diagnostics.recordInput({ device: "gamepad", buttons: ["A"] });
  }
  for (let index = 0; index < 55; index += 1) {
    diagnostics.recordError({ type: "runtime-error", message: `Error ${index}` });
  }
  assert.equal(diagnostics.inputs.length, 100);
  assert.equal(diagnostics.errors.length, 50);
  diagnostics.destroy();
  assert.equal([...listeners.values()].every((set) => set.size === 0), true);
});
