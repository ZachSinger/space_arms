// ==========================================
// FILE: replay.mjs
// ==========================================
// Replay check: the same seed must give the same shift, whether it is played one game step per
// browser frame (normal pace) or many steps per frame (fast-forward). Both runs play a busy
// stretch of a shift with two staff and a customer arriving every few seconds, then compare
// where everyone is, what sold, and the money, step for step.

const REPLAY_SEED = 20240611;

/**
 * @param {Awaited<ReturnType<import("./harness.mjs").startGame>>} h
 * @param {{ perFrame: number, steps: number }} options
 */
async function playSeededShift(h, { perFrame, steps }) {
  await h.resumeLoop();
  await h.newGame({ seed: REPLAY_SEED });
  // Stop the real loop at once so frames of uneven length never touch the run.
  await h.step(0);
  await h.game((scene) => {
    scene.gameState.reputation.shopLevel = 7;
    scene.gameState.economy.credits += 20000;
    scene.debugTools.quickstart({ shelfCount: 2, itemCount: 8 });
    for (const id of ["tavi_stock_clerk", "sera_floor_assistant"]) scene.gameState.hireEmployee(id);
    // Physics carries leftover frame time between steps; start both runs from none.
    scene.physics.world._elapsed = 0;
    scene.shift.start();
    const log = { sales: 0, spawned: 0 };
    window.__replayLog = log;
    scene.eventBus.on("customer-sale-completed", () => { log.sales += 1; });
    const spawn = scene.spawnCustomer.bind(scene);
    scene.spawnCustomer = (...args) => {
      const before = scene.customers.length;
      const result = spawn(...args);
      if (scene.customers.length > before) log.spawned += 1;
      return result;
    };
    window.__onStep = (index) => {
      if (scene.shiftClock.started && index % 240 === 0) scene.spawnCustomer();
    };
  });
  await h.step(steps, { perFrame });
  return h.game((scene) => {
    const at = (sprite) => sprite ? [Math.round(sprite.x * 10) / 10, Math.round(sprite.y * 10) / 10] : null;
    return {
      log: window.__replayLog,
      shiftMs: Math.round(scene.shiftClock.getElapsedMs()),
      credits: scene.gameState.economy.credits,
      customers: scene.customers.map((customer) => [customer.state, ...at(customer.sprite), customer.cart.length]),
      employees: scene.employees.map((employee) => [employee.state, ...at(employee.sprite)]),
      crates: scene.restockCrates.map((crate) => at(crate)),
      trash: scene.trash.pieces.length,
    };
  });
}

/**
 * @returns {Promise<{ name: string, failures: string[], detail: string }>}
 */
export async function runReplayCheck(h, { gameSeconds = 60 } = {}) {
  const steps = gameSeconds * 60;
  const normal = await playSeededShift(h, { perFrame: 1, steps });
  const fast = await playSeededShift(h, { perFrame: 12, steps });
  await h.resumeLoop();
  const failures = [];
  if (normal.log.spawned === 0) failures.push("no customers arrived, so the replay proved nothing");
  for (const key of Object.keys(normal)) {
    const a = JSON.stringify(normal[key]);
    const b = JSON.stringify(fast[key]);
    if (a !== b) failures.push(`${key} differs: normal ${a} vs fast ${b}`);
  }
  return {
    name: "same seed replays the same at normal and fast-forward pace",
    failures,
    detail: `${gameSeconds} s of shift, ${normal.log.spawned} customers, ${normal.log.sales} sales, ` +
      `${normal.employees.length} staff`,
  };
}
