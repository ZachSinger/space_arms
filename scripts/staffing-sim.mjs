// ==========================================
// FILE: scripts/staffing-sim.mjs
// ==========================================
// Staffing simulation: can N employees with given skill levels run a shift alone
// (player AFK)? Models customer arrivals, shopping, queue patience, employee register
// service, and crate-hauling restock trips, using the game's real timing constants.
// Run with: node scripts/staffing-sim.mjs
import { getEmployeeJobSpeed } from "../js/logic/EmployeeTraining.js";
import { BASE_PATIENCE_MS } from "../js/logic/CustomerTraits.js";
import { SHIFT_DURATION_MS } from "../js/logic/ShiftClock.js";

// --- Real game constants (cited from the source) ---
// Override the first one from the command line to test tunings: node scripts/staffing-sim.mjs 5000
const REGISTER_MS_PER_ITEM = Number(process.argv[2] ?? 5000); // Employee.js REGISTER_SERVICE_MS_PER_ITEM
const WALK_SPEED = 120; // px/s, Employee.js WALK_SPEED
const JOB_RETRY_MS = 1000; // Employee.js: idle employees re-check for work every second
const CRATE_UNITS = 20; // one ordered crate of a boxSize-1 item (SupplyOrder.js)

// --- Layout assumptions (px, a mid-size shop; walking is the stocking bottleneck) ---
const DIST = {
  register_pad: 600,
  register_shelf: 300,
  shelf_pad: 550,
  break_register: 400,
  break_pad: 350,
  break_shelf: 400,
};
function travelMs(from, to, speedMultiplier = 1) {
  if (from === to) return 0;
  const key = [from, to].sort().join("_")
    .replace("breakroom_pad", "break_pad")
    .replace("breakroom_register", "break_register")
    .replace("breakroom_shelf", "break_shelf")
    .replace("pad_register", "register_pad")
    .replace("pad_shelf", "shelf_pad")
    .replace("register_shelf", "register_shelf");
  const px = DIST[key];
  if (!px) throw new Error(`No distance for ${from}->${to}`);
  return px / (WALK_SPEED * speedMultiplier) * 1000;
}

// --- Customer model ---
const UNITS_PER_CUSTOMER = [2, 2, 2, 3, 3, 4]; // avg 2.67, like the pooling tuning
const SHOP_TIME_MS = [10000, 30000]; // walking + browsing before queueing

function makeRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/**
 * One shift. Employees: [{ register: level, stocking: level }], register-priority.
 * Shelf starts full; the pad holds the morning supply order.
 */
function simulateShift({ customers, employees, registers = 1, shelfCapacity = 160, padUnits = 180, seed = 1 }) {
  const random = makeRandom(seed);
  const pick = (array) => array[Math.floor(random() * array.length)];
  const range = ([min, max]) => min + random() * (max - min);

  // Customer arrival schedule: evenly spaced with jitter (CustomerPooling.js style).
  const interval = SHIFT_DURATION_MS / customers;
  const arrivals = Array.from({ length: customers }, (_, index) =>
    Math.max(0, (index + 0.5) * interval + (random() * 2 - 1) * interval * 0.35));

  let shelf = shelfCapacity;
  let pad = padUnits;
  const stats = {
    served: 0, patienceLeaves: 0, missingStock: 0, unitsSold: 0, restockTrips: 0,
    registerMs: 0, stockingMs: 0, idleMs: 0,
  };

  // Customers: { state: shopping|queued, readyAt, cart, patience }
  const shoppers = [];
  const queue = [];
  const staff = employees.map((levels) => ({
    speedRegister: getEmployeeJobSpeed({ register: levels.register, stock_shelves: levels.stocking }, "register"),
    speedStocking: getEmployeeJobSpeed({ register: levels.register, stock_shelves: levels.stocking }, "stock_shelves"),
    location: "breakroom",
    busyUntil: 0,
    task: null, // null | { kind: "register"|"stockLeg", ... }
    retryAt: 0,
  }));

  const STEP = 100;
  let arrivalIndex = 0;
  for (let now = 0; now < SHIFT_DURATION_MS * 1.3; now += STEP) {
    // New arrivals start shopping (after soft close at shift end, no new arrivals).
    while (arrivalIndex < arrivals.length && arrivals[arrivalIndex] <= now &&
      arrivals[arrivalIndex] <= SHIFT_DURATION_MS) {
      shoppers.push({ readyAt: now + range(SHOP_TIME_MS), wanted: pick(UNITS_PER_CUSTOMER) });
      arrivalIndex += 1;
    }
    // Shoppers finish browsing: take stock and queue, or leave if nothing was there.
    for (let index = shoppers.length - 1; index >= 0; index -= 1) {
      const shopper = shoppers[index];
      if (shopper.readyAt > now) continue;
      shoppers.splice(index, 1);
      const taken = Math.min(shopper.wanted, shelf);
      shelf -= taken;
      if (taken === 0) {
        stats.missingStock += 1; // left empty-handed: -1 reputation
      } else {
        queue.push({ cart: taken, patienceAt: now + BASE_PATIENCE_MS, frontSince: null });
      }
    }
    // Patience: a customer's timer resets when they reach a register (front N of the queue).
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const customer = queue[index];
      if (index < registers && customer.frontSince === null) {
        customer.frontSince = now;
        customer.patienceAt = now + BASE_PATIENCE_MS;
      }
      if (customer.patienceAt <= now) {
        queue.splice(index, 1);
        stats.patienceLeaves += 1; // left angry: -1 reputation
      }
    }
    // Employees.
    for (const employee of staff) {
      if (employee.busyUntil > now) {
        if (employee.task?.kind === "register") stats.registerMs += STEP;
        else if (employee.task) stats.stockingMs += STEP;
        continue;
      }
      // Finish whatever just completed.
      if (employee.task?.kind === "register") {
        const customer = employee.task.customer;
        const position = queue.indexOf(customer);
        if (position !== -1) {
          queue.splice(position, 1);
          stats.served += 1;
          stats.unitsSold += customer.cart;
          const next = queue[Math.min(registers - 1, queue.length - 1)];
          if (next && next.frontSince === null) { next.frontSince = now; next.patienceAt = now + BASE_PATIENCE_MS; }
        }
        employee.task = null;
      } else if (employee.task?.kind === "stockArrive") {
        const move = Math.min(CRATE_UNITS, pad, 160 - 0 + shelf >= 0 ? Math.max(0, shelfCapacity - shelf) : 0);
        const moved = Math.min(CRATE_UNITS, pad, Math.max(0, shelfCapacity - shelf));
        shelf += moved;
        pad -= moved;
        stats.restockTrips += 1;
        // Walk the crate back to the pad before taking a new task (matches the game).
        employee.task = { kind: "stockReturn" };
        employee.busyUntil = now + travelMs("shelf", "pad", employee.speedStocking);
        employee.location = "pad";
        continue;
      } else if (employee.task?.kind === "stockReturn") {
        employee.task = null;
      }
      if (employee.retryAt > now) { stats.idleMs += STEP; continue; }
      // Pick the next task: register first, then stocking (the default priority).
      const serving = staff.filter((other) => other !== employee && other.task?.kind === "register").length;
      const claimed = new Set(staff.map((other) => other.task?.customer).filter(Boolean));
      const nextCustomer = queue.find((candidate) => !claimed.has(candidate));
      if (serving < registers && nextCustomer && queue.indexOf(nextCustomer) < registers) {
        const walk = travelMs(employee.location, "register");
        employee.task = { kind: "register", customer: nextCustomer };
        employee.busyUntil = now + walk +
          Math.max(REGISTER_MS_PER_ITEM, nextCustomer.cart * REGISTER_MS_PER_ITEM) / employee.speedRegister;
        employee.location = "register";
      } else if (pad > 0 && shelf < shelfCapacity &&
        !staff.some((other) => other !== employee && other.task?.kind?.startsWith("stock"))) {
        const walk = travelMs(employee.location, "pad", employee.speedStocking) +
          travelMs("pad", "shelf", employee.speedStocking);
        employee.task = { kind: "stockArrive" };
        employee.busyUntil = now + walk;
        employee.location = "shelf";
      } else {
        employee.retryAt = now + JOB_RETRY_MS;
        stats.idleMs += STEP;
      }
    }
    if (arrivalIndex >= arrivals.length && shoppers.length === 0 && queue.length === 0) break;
  }
  stats.netReputation = stats.served - stats.patienceLeaves - stats.missingStock;
  stats.shelfLeft = shelf;
  stats.padLeft = pad;
  return stats;
}

function runScenario(label, options, trials = 100) {
  const totals = {};
  for (let trial = 0; trial < trials; trial += 1) {
    const result = simulateShift({ ...options, seed: trial * 7919 + 17 });
    for (const [key, value] of Object.entries(result)) totals[key] = (totals[key] ?? 0) + value;
  }
  const avg = (key) => totals[key] / trials;
  const busy = (avg("registerMs") + avg("stockingMs")) / SHIFT_DURATION_MS / options.employees.length * 100;
  console.log(
    label.padEnd(34) + " | " +
    String(Math.round(avg("served"))).padStart(6) + " | " +
    String(avg("patienceLeaves").toFixed(1)).padStart(8) + " | " +
    String(avg("missingStock").toFixed(1)).padStart(7) + " | " +
    String(Math.round(avg("netReputation"))).padStart(7) + " | " +
    String(Math.round(avg("unitsSold"))).padStart(5) + " | " +
    String(Math.round(busy)).padStart(5) + "%",
  );
}

console.log("STAFFING SIMULATION - player AFK, employee(s) run the store");
console.log(`Shift ${SHIFT_DURATION_MS / 1000}s, patience ${BASE_PATIENCE_MS / 1000}s, shelf 160 units, pad 180 units, ` +
  `${REGISTER_MS_PER_ITEM / 1000}s per item at the register.`);
console.log("");
console.log("scenario                           | served | patience | no-stock | net rep | sold | busy");

const L1 = { register: 1, stocking: 1 };
const L3 = { register: 3, stocking: 3 };
const L5 = { register: 5, stocking: 5 };

for (const customers of [15, 30, 40]) {
  runScenario(`1x L1/L1, ${customers} customers`, { customers, employees: [L1] });
}
console.log("--- scaling up: more staff vs more training (40 customers) ---");
runScenario("2x L1/L1, 40 customers", { customers: 40, employees: [L1, L1] });
runScenario("1x L3/L3, 40 customers", { customers: 40, employees: [L3] });
runScenario("1x L5/L5, 40 customers", { customers: 40, employees: [L5] });
runScenario("2x L3/L3, 40 customers", { customers: 40, employees: [L3, L3] });
console.log("--- heavier traffic (60 customers, late game) ---");
runScenario("2x L1/L1, 60 customers", { customers: 60, employees: [L1, L1] });
runScenario("2x L3/L3, 60 customers", { customers: 60, employees: [L3, L3] });
runScenario("2x L5/L5, 60 customers", { customers: 60, employees: [L5, L5] });
runScenario("3x L3/L3, 60 customers", { customers: 60, employees: [L3, L3, L3] });
console.log("--- with extra registers (the headcount lever) ---");
runScenario("2 regs, 2x L1/L1, 40 customers", { customers: 40, registers: 2, employees: [L1, L1] });
runScenario("2 regs, 2x L1/L1, 60 customers", { customers: 60, registers: 2, employees: [L1, L1] });
runScenario("2 regs, 2x L3/L3, 60 customers", { customers: 60, registers: 2, employees: [L3, L3] });
runScenario("3 regs, 3x L1/L1, 60 customers", { customers: 60, registers: 3, employees: [L1, L1, L1] });
runScenario("2 regs, 2x L5/L5, 60 customers", { customers: 60, registers: 2, employees: [L5, L5] });
runScenario("3 regs, 3x L3/L3, 80 customers", { customers: 80, registers: 3, employees: [L3, L3, L3] });
