import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("in-game HUD styles are isolated from shared window primitives", async () => {
  const [shared, hud, entryPoint] = await Promise.all([
    readFile(new URL("../styles/space_dealer_window.css", import.meta.url), "utf8"),
    readFile(new URL("../styles/windows/hud.css", import.meta.url), "utf8"),
    readFile(new URL("../js/scenes/main.js", import.meta.url), "utf8"),
  ]);
  assert.match(hud, /#persistent-hud\s*\{/);
  assert.match(hud, /\.hud-section\s*\{/);
  assert.match(hud, /\.game-message\s*\{/);
  assert.doesNotMatch(shared, /#persistent-hud\s*\{/);
  assert.doesNotMatch(shared, /\.hud-section\s*\{/);
  assert.match(entryPoint, /styles\/windows\/hud\.css/);
});
