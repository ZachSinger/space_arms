import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  controlLabel, detectControllerLabelStyle, getControlHelp, getResolvedControllerLabelStyle,
  setControllerLabelStyle,
} from "../js/input/InputDevice.js";

test("controller button labels follow the selected layout without changing keyboard labels", (t) => {
  t.after(() => setControllerLabelStyle("automatic"));

  setControllerLabelStyle("playstation");
  assert.equal(controlLabel("interact", "gamepad"), "✕");
  assert.equal(controlLabel("cancel", "gamepad"), "○");
  assert.equal(controlLabel("zoomIn", "gamepad"), "R1");
  assert.equal(controlLabel("interact", "keyboard"), "E");
  assert.equal(getControlHelp().find(({ label }) => label === "Use or open").gamepad, "✕");

  setControllerLabelStyle("nintendo");
  assert.equal(controlLabel("interact", "gamepad"), "B");
  assert.equal(controlLabel("cancel", "gamepad"), "A");
  assert.equal(controlLabel("zoomOut", "gamepad"), "L");

  setControllerLabelStyle("xbox");
  assert.equal(controlLabel("interact", "gamepad"), "A");
  assert.equal(controlLabel("cancel", "gamepad"), "B");
});

test("automatic controller labels recognize reported device names and fall back to Xbox", (t) => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => {
    setControllerLabelStyle("automatic");
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  });

  assert.equal(detectControllerLabelStyle("DualSense Wireless Controller"), "playstation");
  assert.equal(detectControllerLabelStyle("Pro Controller (Vendor: 057e)"), "nintendo");
  assert.equal(detectControllerLabelStyle("Xbox 360 Controller"), "xbox");
  assert.equal(detectControllerLabelStyle("Generic USB Gamepad"), null);

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { getGamepads: () => [{ id: "DualSense Wireless Controller", connected: true }] },
  });
  setControllerLabelStyle("automatic");
  assert.equal(getResolvedControllerLabelStyle(), "playstation");

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { getGamepads: () => [{ id: "Generic USB Gamepad", connected: true }] },
  });
  assert.equal(getResolvedControllerLabelStyle(), "xbox");
});

test("the selected button-name layout is saved for the next game session", async (t) => {
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
    setControllerLabelStyle("automatic");
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  });

  setControllerLabelStyle("playstation", { persist: true });
  const reloaded = await import("../js/input/InputDevice.js?controller-labels-reload");
  assert.equal(reloaded.getControllerLabelStyle(), "playstation");
});

test("the Settings frame uses one size for every tab", async () => {
  const styles = await readFile(new URL("../styles/windows/settings.css", import.meta.url), "utf8");
  assert.match(styles, /\.settings-window\s*\{[^}]*width:\s*min\(970px/);
  assert.match(styles, /\.settings-window\s*\{[^}]*height:\s*min\(760px/);
  assert.doesNotMatch(styles, /settings-controls-open/);
});
