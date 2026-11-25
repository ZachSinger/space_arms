// ==========================================
// FILE: scripts/robot-lab/sim.js
// ==========================================
// A developer tool, not part of the game: a tiny pretend store for trying out robot programs.
// Time moves in 1-second steps. Customers take items off shelves and queue at registers,
// deliveries land on the loading pad, and robots pick jobs with js/logic/RobotGambits.js.
import { chooseAction } from "../../js/logic/RobotGambits.js";
import { findCell, findFrame, hasEnoughPower, robotProgram } from "../../js/logic/RobotParts.js";

export const SIM_RULES = Object.freeze({
  shelfCapacity: 20,
  itemsPerCrate: 10,
  itemPrice: 50,
  maxLine: 6,
  patienceSeconds: 60,
  messChance: 0.15,
  padCapacity: 8,
  // A waiting robot uses this share of the standard drain.
  waitingDrain: 0.25,
  // Seconds each job takes for a robot with speed 1. Faster robots divide these.
  seconds: { work_register: 4, restock: 8, unload_pad: 5, clean: 6, wait: 1 },
});

function randomFrom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Copies a robot's build onto its running copy in the pretend store: speed from the frame,
 * charge from the power cell, and the commands from its boards. Battery level is kept.
 */
export function applyBuild(live, robot, parts) {
  const frame = findFrame(parts, robot.frame);
  const cell = findCell(parts, robot.cell);
  Object.assign(live, {
    name: robot.name,
    build: robot,
    speed: frame?.speed ?? 1,
    cell,
    program: robotProgram(robot, parts),
    noPower: !hasEnoughPower(robot, parts),
  });
  return live;
}

export function createSim(setup, seed = 1) {
  const { settings } = setup;
  return {
    settings,
    random: randomFrom(seed),
    time: 0,
    registers: Array.from({ length: settings.registers }, (_unused, index) => ({ id: `Register ${index + 1}`, line: [], staffedBy: null })),
    shelves: Array.from({ length: settings.shelves }, (_unused, index) => ({ id: `Shelf ${index + 1}`, stock: SIM_RULES.shelfCapacity / 2, incoming: 0 })),
    stations: Array.from({ length: settings.stations }, (_unused, index) => ({ id: `Charging station ${index + 1}`, usedBy: null })),
    padCrates: 0,
    backroomCrates: settings.startingBackroomCrates,
    inboundCrates: 0,
    messes: 0,
    messesClaimed: 0,
    robots: setup.robots.map((robot, index) => applyBuild({
      id: `robot${index + 1}`,
      battery: 1,
      task: null,
      lastAction: null,
      choice: null,
      outOfPower: false,
      busySeconds: 0,
    }, robot, setup.parts)),
    stats: { sales: 0, served: 0, leftEmptyShelf: 0, leftLongLine: 0, leftTooSlow: 0, customers: 0 },
    log: [],
  };
}

/** The store as robots see it (see RobotGambits.js). Crates and messes already claimed don't count. */
export function worldOf(sim) {
  return {
    registers: sim.registers.map((register) => ({ id: register.id, line: register.line.length, staffedBy: register.staffedBy })),
    shelves: sim.shelves.map((shelf) => ({ id: shelf.id, fill: (shelf.stock + shelf.incoming) / SIM_RULES.shelfCapacity })),
    padCrates: sim.padCrates,
    backroomCrates: sim.backroomCrates,
    backroomCapacity: sim.settings.backroomCapacity - sim.inboundCrates,
    messes: sim.messes - sim.messesClaimed,
    stations: sim.stations.map((station) => ({ id: station.id, usedBy: station.usedBy })),
  };
}

function note(sim, text) {
  sim.log.push({ time: sim.time, text });
  if (sim.log.length > 300) sim.log.shift();
}

function describe(task) {
  switch (task.action) {
    case "work_register": return `works ${task.register.id}`;
    case "restock": return `restocks ${task.shelf.id}`;
    case "unload_pad": return "carries a crate into the backroom";
    case "clean": return "cleans a mess";
    case "charge": return `charges at ${task.station.id}`;
    default: return "waits";
  }
}

function startTask(sim, robot) {
  const choice = chooseAction(robot.program, worldOf(sim), robot);
  robot.choice = choice;
  const action = choice.action;
  const task = { action, seconds: SIM_RULES.seconds[action] / robot.speed };
  if (action === "work_register") {
    task.register = sim.registers.find((register) => register.id === choice.target.id);
    task.register.staffedBy = robot.id;
    if (!task.register.line.length) task.seconds = 1;
  } else if (action === "restock") {
    task.shelf = sim.shelves.find((shelf) => shelf.id === choice.target.id);
    sim.backroomCrates -= 1;
    task.shelf.incoming += SIM_RULES.itemsPerCrate;
  } else if (action === "unload_pad") {
    sim.padCrates -= 1;
    sim.inboundCrates += 1;
  } else if (action === "clean") {
    sim.messesClaimed += 1;
  } else if (action === "charge") {
    task.station = sim.stations.find((station) => station.id === choice.target.id);
    task.station.usedBy = robot.id;
    task.seconds = Infinity;
  }
  robot.task = task;
  if (action !== robot.lastAction) {
    const why = choice.ruleIndex < 0 ? "no rule fit" : `rule ${choice.ruleIndex + 1}`;
    note(sim, `${robot.name} ${describe(task)} (${why})`);
  }
}

function finishTask(sim, robot) {
  const task = robot.task;
  if (task.action === "work_register") {
    const customer = task.register.line.shift();
    if (customer) {
      sim.stats.sales += customer.items * SIM_RULES.itemPrice;
      sim.stats.served += 1;
    }
    task.register.staffedBy = null;
  } else if (task.action === "restock") {
    task.shelf.incoming -= SIM_RULES.itemsPerCrate;
    task.shelf.stock = Math.min(SIM_RULES.shelfCapacity, task.shelf.stock + SIM_RULES.itemsPerCrate);
  } else if (task.action === "unload_pad") {
    sim.inboundCrates -= 1;
    sim.backroomCrates += 1;
  } else if (task.action === "clean") {
    sim.messesClaimed -= 1;
    sim.messes -= 1;
  } else if (task.action === "charge") {
    task.station.usedBy = null;
  }
  robot.lastAction = task.action;
  robot.task = null;
}

/** Drops a half-done job when a robot runs flat, putting back anything it had claimed. */
function abandonTask(sim, robot) {
  const task = robot.task;
  if (!task) return;
  if (task.action === "work_register") task.register.staffedBy = null;
  else if (task.action === "restock") {
    task.shelf.incoming -= SIM_RULES.itemsPerCrate;
    sim.backroomCrates += 1;
  } else if (task.action === "unload_pad") {
    sim.inboundCrates -= 1;
    sim.padCrates += 1;
  } else if (task.action === "clean") sim.messesClaimed -= 1;
  else if (task.action === "charge") task.station.usedBy = null;
  robot.task = null;
}

function customerArrives(sim) {
  if (sim.random() >= sim.settings.customersPerMinute / 60) return;
  sim.stats.customers += 1;
  const shelf = sim.shelves[Math.floor(sim.random() * sim.shelves.length)];
  const items = Math.min(1 + Math.floor(sim.random() * 3), shelf.stock);
  if (items === 0) {
    sim.stats.leftEmptyShelf += 1;
    return;
  }
  const register = sim.registers.reduce((best, entry) => (entry.line.length < best.line.length ? entry : best));
  if (register.line.length >= SIM_RULES.maxLine) {
    sim.stats.leftLongLine += 1;
    return;
  }
  shelf.stock -= items;
  register.line.push({ items, arrived: sim.time });
  if (sim.random() < SIM_RULES.messChance) sim.messes += 1;
}

/** Moves the pretend store forward one second. */
export function step(sim) {
  if (sim.time >= sim.settings.shiftSeconds) return sim;
  if (sim.time % sim.settings.deliveryEverySeconds === 0) {
    sim.padCrates = Math.min(SIM_RULES.padCapacity, sim.padCrates + sim.settings.cratesPerDelivery);
  }
  customerArrives(sim);
  for (const register of sim.registers) {
    // The customer at the front is being served (or waiting for a robot), so only those behind give up.
    const leaving = register.line.filter((customer, index) => index > 0 && sim.time - customer.arrived > SIM_RULES.patienceSeconds);
    sim.stats.leftTooSlow += leaving.length;
    register.line = register.line.filter((customer) => !leaving.includes(customer));
  }
  for (const robot of sim.robots) {
    if (robot.outOfPower || robot.noPower) {
      if (robot.task) abandonTask(sim, robot);
      continue;
    }
    if (!robot.task) startTask(sim, robot);
    const task = robot.task;
    if (task.action === "charge") {
      robot.battery = Math.min(1, robot.battery + robot.cell.chargeRate / robot.cell.charge);
      if (robot.battery >= 1) finishTask(sim, robot);
      continue;
    }
    const share = task.action === "wait" ? SIM_RULES.waitingDrain : 1;
    robot.battery = Math.max(0, robot.battery - (share * sim.settings.standardDrain * robot.cell.drainRate) / robot.cell.charge);
    if (task.action !== "wait") robot.busySeconds += 1;
    if (robot.battery <= 0) {
      abandonTask(sim, robot);
      robot.outOfPower = true;
      note(sim, `${robot.name} ran out of battery and shut down.`);
      continue;
    }
    task.seconds -= 1;
    if (task.seconds <= 0) finishTask(sim, robot);
  }
  sim.time += 1;
  return sim;
}

export function runShift(setup, seed = 1) {
  const sim = createSim(setup, seed);
  while (sim.time < sim.settings.shiftSeconds) step(sim);
  return sim;
}
