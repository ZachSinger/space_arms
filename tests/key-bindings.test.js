import test from "node:test";
import assert from "node:assert/strict";

test("saved controls from before a new control existed keep their keys and gain the new one", async (t) => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => JSON.stringify({ ...savedWithout("paint"), interact: ["KeyG", null] }),
    setItem() {},
  };
  t.after(() => {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });
  const { getBindings } = await import("../js/input/KeyBindings.js");
  const bindings = getBindings();
  assert.deepEqual(bindings.interact, ["KeyG", null]);
  assert.deepEqual(bindings.paint, ["KeyF", null]);
});

function savedWithout(action) {
  const defaults = {
    moveUp: ["KeyW", "ArrowUp"], moveDown: ["KeyS", "ArrowDown"], moveLeft: ["KeyA", "ArrowLeft"],
    moveRight: ["KeyD", "ArrowRight"], dash: ["Shift", null], interact: ["KeyE", null], crate: ["Space", null],
    putDown: ["KeyQ", null], nextCrate: ["Control", null], highlightTrash: ["KeyH", null], paint: ["KeyF", null],
    rotate: ["KeyR", null], place: ["Mouse0", null], cancel: ["Escape", "Mouse2"], tablet: ["KeyI", "Tab"],
    pause: ["KeyP", "Escape"], zoomIn: ["PageUp", null], zoomOut: ["PageDown", null],
  };
  delete defaults[action];
  return defaults;
}
