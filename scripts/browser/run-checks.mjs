// ==========================================
// FILE: run-checks.mjs
// ==========================================
// Every browser check in one go (npm run check:game): two scripted shifts (no staff, two
// staff), the targeted scenarios, the seeded replay, and the busy-shop speed test. Needs the local art in img/.
//   node scripts/browser/run-checks.mjs                 everything
//   node scripts/browser/run-checks.mjs --only=settings  check title-screen settings
//   node scripts/browser/run-checks.mjs --only=scenarios  just one part (shift | scenarios | replay | speed)
//   node scripts/browser/run-checks.mjs --quick          shorter shifts, for quick re-checks
import { startGame } from "./harness.mjs";
import { runScriptedShift, checkScriptedShift } from "./scripted-shift.mjs";
import { runScenarios } from "./scenarios.mjs";
import { runReplayCheck } from "./replay.mjs";
import { checkTitleSettings } from "./title-settings.mjs";

const args = process.argv.slice(2);
const only = args.find((arg) => arg.startsWith("--only="))?.slice(7) ?? null;
const quick = args.includes("--quick");

// The speed test fails if a busy shop's work per frame passes these limits: about 1.5x the
// pre-rebuild baseline recorded in documentation/RebuildBaseline.md.
const SPEED_LIMITS = { averageMs: 9, p99Ms: 25 };

export async function runSpeedTest(h, seconds = 45) {
  await h.newGame();
  await h.game((scene) => {
    scene.gameState.reputation.shopLevel = 10;
    scene.gameState.economy.credits += 100000;
    for (const zone of scene.room.zones) if (zone.locked) scene.fixtureSystem.openZone(zone.id);
    scene.cameraRig.refresh();
    scene.debugTools.quickstart({ shelfCount: 6, itemCount: 20 });
    for (const id of ["tavi_stock_clerk", "sera_floor_assistant", "dax_stock_clerk"]) scene.gameState.hireEmployee(id);
    const itemIds = [...new Set(scene.fixtures.shelves().flatMap((shelf) => shelf.placements.map((entry) => entry.itemId)))];
    // A messy backroom: thirty loose crates.
    const storeroom = scene.room.zones.find((zone) => zone.id === "storeroom");
    for (let index = 0; index < 30; index += 1) {
      const x = (storeroom.gridX + 0.5 + (index % 4)) * 64;
      const y = (storeroom.gridY + 0.5 + Math.floor(index / 4) % 4) * 64;
      const crate = scene.crateSystem.createItemCrate(itemIds[index % itemIds.length], 4, x, y);
      crate.drop(x, y, 0, 0, false);
      scene.restockCrates.push(crate);
    }
  });
  await h.game((scene) => scene.shift.start());
  await h.page.waitForFunction(() => window.__game.scene.getScene("scene-game").shiftClock.started);
  await h.game((scene) => {
    // Time the game spends working on each frame (update and drawing), not the gap between
    // frames, which mostly follows the browser's refresh pace.
    const frames = [];
    window.__frames = frames;
    const loop = window.__game.loop;
    const step = loop.callback;
    window.__untime = () => { loop.callback = step; };
    loop.callback = (time, delta) => {
      const started = performance.now();
      step(time, delta);
      frames.push(performance.now() - started);
    };
    window.__topUp = setInterval(() => scene.customerFlow.spawn(), 700);
  });
  await h.wait(seconds * 1000);
  return h.game((scene) => {
    clearInterval(window.__topUp);
    window.__untime();
    const frames = window.__frames.slice(120);
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      customers: scene.customers.length,
      employees: scene.employees.length,
      crates: scene.restockCrates.length,
      frames: frames.length,
      averageMs: frames.reduce((sum, ms) => sum + ms, 0) / Math.max(1, frames.length),
      p99Ms: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
      worstMs: sorted.at(-1) ?? 0,
      renderer: window.__game.renderer.type,
    };
  });
}

const report = [];
const record = (name, failures, detail = "") => {
  report.push({ name, failures });
  console.log(`${failures.length ? "FAIL" : "ok  "} ${name}${detail ? `  (${detail})` : ""}`);
  for (const failure of failures) console.log(`       - ${failure.slice(0, 500)}`);
};

const h = await startGame();
try {
  if (!only || only === "settings") {
    const errorsBefore = h.errors().length;
    let failures;
    try {
      await checkTitleSettings(h);
      failures = [];
    } catch (error) {
      failures = [`crashed: ${error.message}`];
    }
    failures.push(...h.errors().slice(errorsBefore).map((problem) => `${problem.type}: ${problem.text}`));
    record("main-menu settings controller remapping", failures);
  }
  if (!only || only === "shift") {
    for (const employees of [[], ["tavi_stock_clerk", "sera_floor_assistant"]]) {
      const errorsBefore = h.errors().length;
      const result = await runScriptedShift(h, { employees, playSeconds: quick ? 60 : 150 });
      // The no-staff shift uses a simulated cashier only after closing.
      const failures = checkScriptedShift(result, { expectSales: employees.length > 0 });
      failures.push(...h.errors().slice(errorsBefore).map((problem) => `${problem.type}: ${problem.text}`));
      const { log, frames } = result.after;
      record(`scripted shift with ${employees.length} staff`, failures,
        `${log.spawned} customers, ${log.sales} sales, ${log.gaveUp.length} gave up, ` +
        `${frames.averageMs.toFixed(1)} ms average frame`);
    }
  }
  if (!only || only === "scenarios") {
    for (const { name, failures } of await runScenarios(h)) record(name, failures);
  }
  if (!only || only === "replay") {
    const errorsBefore = h.errors().length;
    const { name, failures, detail } = await runReplayCheck(h, { gameSeconds: quick ? 30 : 60 });
    failures.push(...h.errors().slice(errorsBefore).map((problem) => `${problem.type}: ${problem.text}`));
    record(name, failures, detail);
  }
  if (!only || only === "speed") {
    const errorsBefore = h.errors().length;
    const speed = await runSpeedTest(h, quick ? 20 : 45);
    const failures = h.errors().slice(errorsBefore).map((problem) => `${problem.type}: ${problem.text}`);
    if (speed.averageMs > SPEED_LIMITS.averageMs) failures.push(`average frame ${speed.averageMs.toFixed(2)} ms`);
    if (speed.p99Ms > SPEED_LIMITS.p99Ms) failures.push(`slowest 1% of frames ${speed.p99Ms.toFixed(2)} ms`);
    record("busy shop speed test", failures,
      `${speed.customers} customers, ${speed.employees} staff, ${speed.crates} crates: ` +
      `average ${speed.averageMs.toFixed(2)} ms, slowest 1% ${speed.p99Ms.toFixed(2)} ms, worst ${speed.worstMs.toFixed(1)} ms`);
  }
} finally {
  await h.close();
}

const failed = report.filter(({ failures }) => failures.length);
console.log(failed.length ? `\n${failed.length} of ${report.length} checks failed.` : `\nAll ${report.length} checks passed.`);
process.exitCode = failed.length ? 1 : 0;
