import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startGame } from "./harness.mjs";

const disableCleaning = {
  name: "test-disable-cleaning",
  enforce: "pre",
  transform(source, id) {
    if (!id.replaceAll("\\", "/").endsWith("/js/modules/GameModules.js")) return null;
    const enabled = 'export const ENABLED_GAME_MODULES = Object.freeze(["cleaning"]);';
    if (!source.includes(enabled)) throw new Error("Cannot locate the enabled game modules list.");
    return source.replace(enabled, "export const ENABLED_GAME_MODULES = Object.freeze([]);");
  },
};

const disabled = await startGame({ port: 5392, vitePlugins: [disableCleaning] });
try {
  await disabled.newGame();
  const initial = await disabled.game((scene) => {
    const hud = document.getElementById("hud-cleanliness").parentElement;
    const trashcan = scene.fixtures.ofKind("trash")[0];
    scene.player.sprite.body.reset(1168, 206);
    scene.player.currentFacing = "up";
    const nearby = scene.fixtureSystem.getNearbyTrashcan()?.id;
    scene.interactionSystem.handleInteract();
    const afterTaking = scene.crateSystem.getCarriedCrates().length;
    scene.interactionSystem.handleInteract();
    const afterReturning = scene.crateSystem.getCarriedCrates().length;
    return {
      cleaning: scene.cleaningSystem,
      visible: getComputedStyle(hud).display !== "none",
      trashcan: trashcan.id, nearby, afterTaking, afterReturning,
    };
  });
  assert.equal(initial.cleaning, null);
  assert.equal(initial.visible, false);
  assert.equal(initial.nearby, initial.trashcan);
  assert.equal(initial.afterTaking, 1);
  assert.equal(initial.afterReturning, 0);

  const saved = JSON.parse(await readFile(new URL("../../tests/golden-saves/trash.json", import.meta.url), "utf8"));
  await disabled.loadSave(saved);
  const loaded = await disabled.game((scene) => scene.saves.serialize());
  assert.deepEqual(loaded.trash, saved.trash);
  await disabled.loadSave(loaded);
  assert.deepEqual((await disabled.game((scene) => scene.saves.serialize())).trash, saved.trash);

  await disabled.game((scene) => {
    scene.debugTools.quickstart({ shelfCount: 2, itemCount: 8 });
    return scene.shift.start();
  });
  await disabled.page.waitForFunction(() => window.__game.scene.getScene("scene-game").shiftClock.started);
  const customer = await disabled.game((scene) => {
    scene.customerFlow.spawn();
    const customer = scene.customers.at(-1);
    return { cleaning: customer.cleaning, verdict: customer.judgeStoreCleanliness() };
  });
  assert.deepEqual(customer, { cleaning: null, verdict: null });
  await disabled.wait(4000);
  assert.deepEqual(disabled.errors(), []);
} finally {
  await disabled.close();
}

const enabled = await startGame({ port: 5392 });
try {
  await enabled.newGame();
  const visibility = await enabled.game((scene) => {
    const hud = document.getElementById("hud-cleanliness").parentElement;
    scene.hud.setCleanlinessEnabled(false);
    const hidden = getComputedStyle(hud).display === "none";
    scene.hud.setCleanlinessEnabled(true);
    return { hidden, restored: getComputedStyle(hud).display !== "none" };
  });
  assert.deepEqual(visibility, { hidden: true, restored: true });
  assert.deepEqual(enabled.errors(), []);
} finally {
  await enabled.close();
}
console.log("Optional cleaning: startup, customer, trashcan, HUD, and saved trash passed.");
