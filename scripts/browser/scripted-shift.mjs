// ==========================================
// FILE: scripted-shift.mjs
// ==========================================
// Plays a real shift in a hidden browser and checks that it behaves: no errors, sales happen,
// few customers give up, stock adds up, the shift ends, End Day works, and the shop survives a
// save and reload. Plays at normal speed for `playSeconds`, then moves the shift clock to
// closing time (time only; nothing else is sped up).
import { startGame } from "./harness.mjs";

/**
 * @param {{ employees?: string[], playSeconds?: number, shelves?: number, items?: number }} options
 */
export async function runScriptedShift(harness, { employees = [], playSeconds = 150, shelves = 2, items = 8 } = {}) {
  const h = harness;
  await h.newGame();
  const setup = await h.game((scene, { employees, shelves, items }) => {
    // Level 7 allows two staff members.
    scene.gameState.reputation.shopLevel = 7;
    scene.gameState.economy.credits += 20000;
    scene.debugTools.quickstart({ shelfCount: shelves, itemCount: items });
    const hired = employees.map((id) => scene.gameState.hireEmployee(id));
    const log = { sales: 0, angry: 0, missing: 0, spawned: 0, gaveUp: [] };
    window.__shiftLog = log;
    scene.eventBus.on("customer-sale-completed", () => { log.sales += 1; });
    scene.eventBus.on("customer-left-angry", () => { log.angry += 1; });
    scene.eventBus.on("customer-missing-primary", () => { log.missing += 1; });
    const note = scene.noteCustomerGaveUp.bind(scene);
    scene.noteCustomerGaveUp = (customer, reason) => { log.gaveUp.push(reason); note(customer, reason); };
    const frames = [];
    window.__frames = frames;
    scene.events.on("postupdate", (_time, delta) => frames.push(delta));
    return { hired, stock: 0 };
  }, { employees, shelves, items });
  if (setup.hired.some((ok) => !ok)) throw new Error(`Could not hire ${employees.join(", ")}`);
  const before = await h.game((scene) => {
    const total = scene.getInventoryItems()
      .reduce((sum, { offShelves, stock, inCustomerCarts }) => sum + offShelves + stock + inCustomerCarts, 0);
    return { stock: total, credits: scene.gameState.economy.credits };
  });
  await h.game((scene) => scene.shift.start());
  await h.page.waitForFunction(() => window.__game.scene.getScene("scene-game").shiftClock.started, null, { timeout: 30000 });
  await h.game((scene) => {
    const spawn = scene.customerFlow.spawn.bind(scene.customerFlow);
    scene.customerFlow.spawn = (...args) => {
      const before = scene.customers.length;
      const result = spawn(...args);
      if (scene.customers.length > before) window.__shiftLog.spawned += 1;
      return result;
    };
  });
  await h.wait(playSeconds * 1000);
  await h.game((scene) => { scene.shiftClock.elapsedMs = Math.max(scene.shiftClock.elapsedMs, 12 * 35 * 1000 - 500); });
  await h.page.waitForFunction(() => window.__game.scene.getScene("scene-game").shift.ended, null, { timeout: 240000 });
  const after = await h.game((scene) => {
    const total = scene.getInventoryItems()
      .reduce((sum, { offShelves, stock, inCustomerCarts }) => sum + offShelves + stock + inCustomerCarts, 0);
    const soldUnits = scene.gameState.economy.dayLedger.lines
      .filter((line) => line.category === "sales").reduce((sum, line) => sum + (line.quantity ?? 1), 0);
    const frames = window.__frames.slice(60);
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      stock: total,
      soldUnits,
      log: window.__shiftLog,
      customersLeft: scene.customers.length,
      frames: {
        count: frames.length,
        averageMs: frames.reduce((sum, ms) => sum + ms, 0) / Math.max(1, frames.length),
        p99Ms: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
        worstMs: sorted.at(-1) ?? 0,
      },
    };
  });
  const endDay = await h.game((scene) => {
    const day = scene.gameState.calendar.day;
    const ended = scene.shift.endDay();
    return { ended, advanced: scene.gameState.calendar.day === day + 1 };
  });
  const saved = await h.game((scene) => JSON.stringify(scene.saves.serialize()));
  await h.loadSave(JSON.parse(saved));
  const reloaded = await h.game((scene) => JSON.stringify(scene.saves.serialize()));
  return { before, after, endDay, saveRoundTrip: reloaded === saved, saved, reloaded };
}

/** Checks a scripted-shift result; returns a list of failures (empty when it passed). */
export function checkScriptedShift(result, { expectSales, maxGiveUpShare = 0.25 }) {
  const failures = [];
  const { before, after, endDay } = result;
  const { log } = after;
  if (expectSales && log.sales === 0) failures.push("no sales happened");
  if (log.spawned === 0) failures.push("no customers came in");
  if (log.spawned > 0 && log.gaveUp.length / log.spawned > maxGiveUpShare) {
    failures.push(`${log.gaveUp.length} of ${log.spawned} customers gave up: ${[...new Set(log.gaveUp)].join("; ")}`);
  }
  if (before.stock - after.soldUnits !== after.stock) {
    failures.push(`stock does not add up: ${before.stock} - ${after.soldUnits} sold != ${after.stock}`);
  }
  if (after.customersLeft !== 0) failures.push(`${after.customersLeft} customers still inside after closing`);
  if (!endDay.ended || !endDay.advanced) failures.push("End Day did not work");
  if (!result.saveRoundTrip) failures.push("save -> load -> save changed the shop");
  return failures;
}
