// Checks, in a real shift, that an employee on the cleaning job walks to dirt, mops it with the
// sweeping animation in all four facing directions (no bucket needed), and puts the mop away.
// Optional: pass a file path to save a screenshot of the employee mopping.
import assert from "node:assert/strict";
import { startGame } from "./harness.mjs";

const screenshotPath = process.argv[2];
const h = await startGame({ port: 5398 });
try {
  await h.newGame();
  await h.game((scene) => {
    scene.gameState.reputation.shopLevel = 7;
    scene.gameState.economy.credits += 20000;
    scene.debugTools.quickstart({ shelfCount: 2, itemCount: 8 });
    if (!scene.gameState.hireEmployee("tavi_stock_clerk")) throw new Error("Could not hire.");
    scene.gameState.staff.jobPriorities.tavi_stock_clerk = ["clean", "register", "stock_shelves"];
    scene.gameState.staff.registerAssignments = {};
    scene.shift.start();
  });
  await h.page.waitForFunction(() => window.__game.scene.getScene("scene-game").shiftClock.started);
  await h.game((scene) => {
    scene.customerFlow.spawn = () => null;
    scene.cleaningSystem.dirt.add("smudge", 980, 280);
    scene.cleaningSystem.dirt.add("footprints", 1100, 300);
  });

  await h.page.waitForFunction(() => window.__game.scene.getScene("scene-game").employees[0]?.state === "MOPPING",
    null, { timeout: 60000 });
  await h.wait(120);
  const rows = await h.game(async (scene) => {
    const employee = scene.employees[0];
    const seen = {};
    const natural = employee.currentFacing;
    for (const facing of ["down", "left", "right", "up"]) {
      employee.currentFacing = facing;
      await new Promise((resolve) => setTimeout(resolve, 80));
      seen[facing] = { key: employee.sprite.texture.key, frame: Number(employee.sprite.frame.name) };
    }
    employee.currentFacing = natural;
    return seen;
  });
  for (const [facing, { key, frame }] of Object.entries(rows)) {
    const row = { down: 0, left: 1, right: 2, up: 3 }[facing];
    assert.match(key, /_mopping$/, `${facing}: employee is not in the mopping pose`);
    assert.ok(frame >= row * 8 && frame < (row + 1) * 8, `${facing}: wrong mopping row (${frame})`);
  }
  if (screenshotPath) {
    await h.game((scene) => {
      const employee = scene.employees[0];
      scene.player.teleportTo(employee.sprite.x - 90, employee.sprite.y);
    });
    await h.wait(150);
    await h.page.screenshot({ path: screenshotPath });
  }

  await h.page.waitForFunction(() => {
    const scene = window.__game.scene.getScene("scene-game");
    return scene.cleaningSystem.dirt.count === 0 && !scene.cleaningSystem.isStaffHoldingMop(scene.employees[0]);
  }, null, { timeout: 60000 });
  const done = await h.game((scene) => ({
    score: scene.cleaningSystem.getCleanliness(),
    texture: scene.employees[0].sprite.texture.key,
  }));
  assert.equal(done.score.dirtCount, 0);
  assert.doesNotMatch(done.texture, /_mopping$/);
  assert.deepEqual(h.errors(), []);
  console.log("Employee walked to both marks, mopped them in all four facings without a bucket, and put the mop away.");
} finally {
  await h.close();
}
