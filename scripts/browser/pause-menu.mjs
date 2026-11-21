import assert from "node:assert/strict";
import { startGame } from "./harness.mjs";

const game = await startGame({ port: 5393 });
try {
  await game.newGame();
  assert.equal(await game.page.locator(".pause-shade").isVisible(), false);
  await game.game((scene) => {
    const cell = scene.fixtureSystem.findNearestCell("shelf_budget_2x2", { gx: 5, gy: 4 });
    scene.fixtureSystem.spawn({ id: "pause-test-shelf", type: "shelf_budget_2x2", ...cell });
    scene.fixtureSystem.applyCurrentLayout();
    scene.pauseProbe = { ticks: 0, x: 0 };
    scene.time.addEvent({ delay: 100, loop: true, callback: () => { scene.pauseProbe.ticks += 1; } });
    scene.tweens.add({ targets: scene.pauseProbe, x: 100, duration: 5000 });
    scene.messages.show("Pause test message");
  });
  await game.wait(200);
  await game.page.keyboard.down("p");
  await game.page.keyboard.down("p");
  await game.page.keyboard.up("p");
  await game.page.locator("#pause-menu").waitFor({ state: "visible" });
  assert.deepEqual(await game.page.locator("[data-pause-action]").allTextContents(),
    ["Resume", "Save Game", "Load Game", "Settings", "Exit to Main Menu", "Exit to Desktop"]);
  await game.page.keyboard.press("Tab");
  assert.equal(await game.page.evaluate(() => document.activeElement.dataset.pauseAction), "save");
  const snapshot = () => game.game((scene) => ({
    probe: { ...scene.pauseProbe },
    worldElapsedMs: scene.worldElapsedMs,
    facingLight: [...scene.fixtures.shelves()[0].facingLight.graphics.commandBuffer],
    player: { x: scene.player.sprite.x, y: scene.player.sprite.y },
    message: scene.messages.element.textContent,
  }));
  const frozen = await snapshot();
  await game.page.keyboard.down("ArrowRight");
  await game.wait(2800);
  await game.page.keyboard.up("ArrowRight");
  assert.deepEqual(await snapshot(), frozen);
  await game.page.locator('[data-pause-action="settings"]').click();
  await game.page.locator(".settings-window").waitFor({ state: "visible" });
  assert.equal(await game.page.locator(".settings-resolution").isDisabled(), true);
  await game.page.locator(".settings-cursor").selectOption("software");
  await game.page.mouse.move(320, 420);
  assert.equal(await game.page.locator("#game-cursor").isVisible(), true);
  await game.page.keyboard.press("Escape");
  await game.page.locator("#pause-menu").waitFor({ state: "visible" });
  assert.equal(await game.page.locator("html").getAttribute("data-game-cursor"), "hardware");
  assert.equal(await game.game((scene) => scene.gamePaused), true);
  await game.page.locator('[data-pause-action="settings"]').click();
  await game.page.locator(".settings-cursor").selectOption("software");
  await game.page.locator(".settings-apply").click();
  await game.page.locator(".settings-cursor").selectOption("hardware");
  await game.page.locator(".settings-cancel").click();
  assert.equal(await game.page.locator("html").getAttribute("data-game-cursor"), "software");
  await game.page.locator('[data-pause-action="save"]').click();
  await game.page.waitForFunction(() => document.querySelector(".pause-status").textContent.startsWith("Saved"));
  assert.equal(await game.game(async (scene) => Boolean(await scene.saves.manager.read())), true);
  await game.page.locator('[data-pause-action="menu"]').click();
  await game.page.keyboard.press("Escape");
  assert.equal(await game.game((scene) => scene.gamePaused), true);
  await game.page.locator('[data-pause-action="resume"]').click();
  assert.equal(await game.page.locator(".pause-shade").isVisible(), false);
  await game.wait(200);
  const resumed = await snapshot();
  assert.ok(resumed.probe.ticks > frozen.probe.ticks);
  assert.ok(resumed.probe.x > frozen.probe.x);
  assert.ok(resumed.worldElapsedMs > frozen.worldElapsedMs);
  assert.notDeepEqual(resumed.facingLight, frozen.facingLight);
  await game.game((scene) => {
    scene.shiftClock.started = true;
    scene.shiftClock.isPaused = false;
  });
  await game.page.keyboard.press("p");
  assert.equal(await game.page.locator('[data-pause-action="save"]').isDisabled(), true);
  assert.equal(await game.game((scene) => scene.shiftClock.isPaused), true);
  await game.page.locator('[data-pause-action="resume"]').click();
  assert.equal(await game.game((scene) => scene.shiftClock.isPaused), false);
  await game.page.keyboard.press("p");
  await game.page.locator('[data-pause-action="load"]').click();
  await game.page.locator("[data-pause-confirm]").click();
  await game.page.waitForFunction(() => {
    const scene = window.__game.scene.getScene("scene-game");
    return scene.saves.lastSavedSnapshot && !scene.gamePaused && !scene.shiftClock.started;
  });
  const paymentPauseScope = await game.game((scene) => {
    scene.checkoutWindow.openForCustomer([{ itemId: "wpn_pis_02", price: 1.23 }], () => {}, { cash: true, exact: false });
    scene.checkoutWindow.startTakingPayment();
    scene.pauseMenu.open();
    return scene.controls.uiNavigator.getScope().id;
  });
  assert.equal(paymentPauseScope, "pause-menu");
  await game.page.locator('[data-pause-action="resume"]').click();
  assert.equal(game.errors().length, 0, JSON.stringify(game.errors()));
  console.log("Verified pause freeze/resume, six menu actions, save/load, and cursor preview/apply/cancel.");
} catch (error) {
  console.error("Browser errors:", JSON.stringify(game.errors()));
  console.error("Pause state:", await game.game((scene) => ({
    paused: scene.gamePaused,
    started: scene.shiftClock.started,
    saved: Boolean(scene.saves.lastSavedSnapshot),
    status: scene.pauseMenu.uiWindow.element.querySelector(".pause-status").textContent,
  })));
  throw error;
} finally {
  await game.close();
}
