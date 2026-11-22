import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultControllerBindings, setControllerBindings, swapControllerBinding,
  validateControllerBindings,
} from "../js/input/ControllerBindings.js";
import { GamepadInput, PAD } from "../js/input/GamepadInput.js";
import { controlLabel, setControllerLabelStyle } from "../js/input/InputDevice.js";
import { SettingsPanel } from "../js/logic/SettingsPanel.js";

test("controller bindings only allow unique assignable buttons and swap occupied assignments", () => {
  const defaults = defaultControllerBindings();
  assert.equal(validateControllerBindings(defaults), true);

  const { bindings, replacedAction } = swapControllerBinding(defaults, "interact", PAD.RB);
  assert.equal(replacedAction, "zoomIn");
  assert.equal(bindings.interact, PAD.RB);
  assert.equal(bindings.zoomIn, PAD.A);
  assert.equal(validateControllerBindings(bindings), true);
  assert.equal(validateControllerBindings({ ...bindings, crate: PAD.A }), false);
  assert.throws(() => swapControllerBinding(bindings, "interact", PAD.LT), /cannot be assigned/);
});

test("gameplay actions and prompts follow the saved button assignment", (t) => {
  t.after(() => {
    setControllerBindings(defaultControllerBindings());
    setControllerLabelStyle("automatic");
  });
  const bindings = defaultControllerBindings();
  const remapped = swapControllerBinding(bindings, "interact", PAD.RB).bindings;
  setControllerBindings(remapped);
  setControllerLabelStyle("playstation");

  const state = {
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
  const input = new GamepadInput(() => [{ connected: true, ...state }]);
  input.poll(0);
  state.buttons[PAD.RB] = { pressed: true, value: 1 };
  input.poll(16);

  assert.equal(input.justPressedAction("interact"), true);
  assert.equal(input.isActionDown("interact"), true);
  assert.equal(input.justPressedAction("zoomIn"), false);
  assert.equal(controlLabel("interact", "gamepad"), "R1");
});

test("Settings captures a button swap and lets the D-pad stop listening", (t) => {
  const defaults = defaultControllerBindings();
  t.after(() => setControllerBindings(defaults));
  const panel = Object.create(SettingsPanel.prototype);
  Object.assign(panel, {
    controllerCapture: "interact",
    controllerBindings: defaults,
    controllerBindingList: { querySelectorAll: () => [] },
    controllerCaptureActions: { classList: { add() {} } },
    bindingStatus: { textContent: "" },
    renderControllerBindings() {},
  });

  panel.captureControllerButton(PAD.RB);
  assert.equal(panel.controllerBindings.interact, PAD.RB);
  assert.equal(panel.controllerBindings.zoomIn, PAD.A);
  assert.equal(panel.controllerCapture, null);
  assert.match(panel.bindingStatus.textContent, /now uses/);

  panel.controllerCapture = "crate";
  panel.captureControllerButton(PAD.UP);
  assert.equal(panel.controllerCapture, null);
  assert.match(panel.bindingStatus.textContent, /stopped/);
});

test("controller assignments persist and reload", async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const stored = new Map();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    } },
  });
  t.after(() => {
    setControllerBindings(defaultControllerBindings());
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  });

  const bindings = defaultControllerBindings();
  bindings.interact = PAD.RB;
  bindings.zoomIn = PAD.A;
  setControllerBindings(bindings, { persist: true });

  const reloaded = await import("../js/input/ControllerBindings.js?controller-bindings-reload");
  assert.deepEqual(reloaded.getControllerBindings(), bindings);
});
