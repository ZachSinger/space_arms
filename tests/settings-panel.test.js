import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SettingsPanel } from "../js/logic/SettingsPanel.js";
import {
  bindingConflict, bindingForEvent, defaultBindings, getBindings, isWorldMouseBinding, matchesBinding, setBindings, validateBindings,
} from "../js/input/KeyBindings.js";
import { getControllerLabelStyle, setControllerLabelStyle } from "../js/input/InputDevice.js";

test("settings styles live in their own window stylesheet", async () => {
  const [shared, settings] = await Promise.all([
    readFile(new URL("../styles/space_dealer_window.css", import.meta.url), "utf8"),
    readFile(new URL("../styles/windows/settings.css", import.meta.url), "utf8"),
  ]);
  assert.match(settings, /\.settings-window\s*\{/);
  assert.match(settings, /\.settings-actions\s*\{/);
  assert.doesNotMatch(shared, /\.settings-window\s*\{/);
});

test("resolution preview updates the frame and cancel restores the previous choice", async (t) => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const events = [];
  const requested = [];
  const large = { width: 1920, height: 1080 };
  const small = { width: 1280, height: 720 };
  const resolutions = [small, large];
  const displaySize = { width: 2560, height: 1440 };
  t.after(() => {
    setControllerLabelStyle("automatic");
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });

  test("keyboard and mouse bindings reject conflicts and keep a control for every action", (t) => {
    t.after(() => setBindings(defaultBindings()));
    const bindings = defaultBindings();
    assert.equal(validateBindings(bindings), true);
    assert.equal(bindingConflict(bindings, "interact", 0, "KeyW"), "Walk up");
    assert.equal(bindingConflict(bindings, "cancel", 0, "Escape"), null);
    bindings.interact = [null, null];
    assert.equal(validateBindings(bindings), false);
    bindings.interact = ["Mouse1", null];
    setBindings(bindings);
    assert.equal(matchesBinding("interact", { type: "mousedown", button: 1 }), true);
    assert.equal(isWorldMouseBinding({ type: "pointerdown", button: 1 }), true);
    assert.equal(isWorldMouseBinding({ type: "pointerdown", button: 0 }), false);
    assert.equal(matchesBinding("interact", { code: "KeyE" }), false);
    assert.equal(bindingForEvent({ code: "ControlRight" }), "Control");
    getBindings().interact[0] = "KeyE";
    assert.equal(matchesBinding("interact", { type: "mousedown", button: 1 }), true);
  });

  test("saved bindings reload with both keyboard and mouse controls", async (t) => {
    const previousStorage = globalThis.localStorage;
    const stored = new Map();
    globalThis.localStorage = {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    };
    t.after(() => {
      setBindings(defaultBindings());
      if (previousStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previousStorage;
    });
    const bindings = defaultBindings();
    bindings.moveUp[0] = "KeyT";
    bindings.interact[0] = "Mouse1";
    setBindings(bindings, { persist: true });
    const reloaded = await import("../js/input/KeyBindings.js?test-reload");
    assert.deepEqual(reloaded.getBindings(), bindings);
  });
  globalThis.window = {
    dispatchEvent: (event) => events.push(event.type),
    desktopApi: {
      async setResolution(resolution) {
        requested.push(resolution);
        return { current: resolution, resolutions, displayMode: "fullscreen", displaySize };
      },
    },
  };
  globalThis.document = {
    documentElement: { dataset: {} },
    createElement: () => ({}),
  };

  const panel = Object.create(SettingsPanel.prototype);
  const select = {
    value: "1280x720",
    replaceChildren() { this.value = ""; },
    appendChild(option) { if (option.selected) this.value = option.value; },
  };
  Object.assign(panel, {
    select,
    displayModeSelect: { value: "fullscreen" },
    textSizeSelect: { value: "default" },
    cursorSelect: { value: "hardware" },
    status: { textContent: "" },
    appliedResolution: large,
    appliedDisplayMode: "fullscreen",
    settingsSnapshot: {
      resolution: large, displayMode: "fullscreen", textSize: "default", cursorMode: "hardware",
      controllerLabelStyle: "nintendo",
    },
    controllerLayoutSelect: { value: "playstation" },
    close() { this.closed = true; },
  });
  setControllerLabelStyle("playstation");

  await panel.previewResolution();
  assert.deepEqual(panel.appliedResolution, small);
  assert.equal(panel.select.value, "1280x720");
  assert.equal(panel.status.textContent, "CURRENT: 1280 x 720");

  await panel.cancel();
  assert.deepEqual(requested, [small, large]);
  assert.deepEqual(panel.appliedResolution, large);
  assert.equal(panel.select.value, "1920x1080");
  assert.equal(panel.controllerLayoutSelect.value, "nintendo");
  assert.equal(getControllerLabelStyle(), "nintendo");
  assert.equal(panel.closed, true);
  assert.equal(events.filter((event) => event === "game-viewport-changed").length, 2);
});
