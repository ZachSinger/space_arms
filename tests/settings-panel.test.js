import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SettingsPanel } from "../js/logic/SettingsPanel.js";

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
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
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
    settingsSnapshot: { resolution: large, displayMode: "fullscreen", textSize: "default", cursorMode: "hardware" },
    close() { this.closed = true; },
  });

  await panel.previewResolution();
  assert.deepEqual(panel.appliedResolution, small);
  assert.equal(panel.select.value, "1280x720");
  assert.equal(panel.status.textContent, "CURRENT: 1280 x 720");

  await panel.cancel();
  assert.deepEqual(requested, [small, large]);
  assert.deepEqual(panel.appliedResolution, large);
  assert.equal(panel.select.value, "1920x1080");
  assert.equal(panel.closed, true);
  assert.equal(events.filter((event) => event === "game-viewport-changed").length, 2);
});
