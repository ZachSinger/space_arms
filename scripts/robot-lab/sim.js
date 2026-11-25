// ==========================================
// FILE: scripts/robot-lab/sim.js
// ==========================================
// A developer tool, not part of the game: a tiny pretend store for trying out robot programs.
// Time moves in 1-second steps. Customers take items off shelves and queue at registers,
// deliveries land on the loading pad, and robots pick jobs with js/logic/RobotGambits.js.
import { chooseAction } from "../../js/logic/RobotGambits.js";
import { buildProblems, findCell, findFrame, hasEnoughPower, partConditions, partMeasures, robotProgram, robotSkills } from "../../js/logic/RobotParts.js";

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
  // Kept for older tool consumers. Actual tasks split walking from skill-dependent work.
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
    skills: Object.fromEntries(robotSkills(robot, parts).map((skill) => [skill.id, skill.value])),
    cell,
    program: robotProgram(robot, parts),
    conditions: partConditions(parts),
    measures: partMeasures(parts),
    noPower: !hasEnoughPower(robot, parts) || buildProblems(robot, parts).length > 0,
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
    garbage: 0,
    garbageClaimed: 0,
    robots: setup.robots.map((robot, index) => applyBuild({
      id: `robot${index + 1}`,
      battery: 1,
      task: null,
      lastAction: null,
      choice: null,
      outOfPower: false,
      busySeconds: 0,
      location: "waiting",
      completed: { customers: 0, stocked: 0, crates: 0, mopped: 0, garbage: 0, crateTrips: 0, trashTrips: 0 },
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
    messes: sim.messes - sim.messesClaimed + sim.garbage - sim.garbageClaimed,
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
    case "unload_pad": return `carries ${task.crates} crates into the backroom`;
    case "clean": return task.garbage ? `takes ${task.garbage} pieces of garbage to the trashcan` : "mops a dirty spot";
    case "charge": return `charges at ${task.station.id}`;
    default: return "waits";
  }
}

function startTask(sim, robot) {
  const choice = chooseAction(robot.program, worldOf(sim), robot, robot.conditions, robot.measures);
  robot.choice = choice;
  const action = choice.action;
  const task = { action, phases: [], phase: 0 };
  const phase = (label, seconds) => task.phases.push({ label, left: seconds });
  const walk = (seconds) => phase("Walking", seconds / robot.speed);
  if (action === "work_register") {
    task.register = sim.registers.find((register) => register.id === choice.target.id);
    task.register.staffedBy = robot.id;
    task.destination = task.register.id;
    if (robot.location !== task.destination) walk(2);
    const customer = task.register.line[0];
    task.customer = customer;
    if (customer) {
      phase("Scanning items", customer.items / robot.skills.scanning);
      phase("Counting change", (customer.changeUnits ?? 2) / robot.skills.counting);
    } else phase("Waiting at register", 1);
  } else if (action === "restock") {
    task.shelf = sim.shelves.find((shelf) => shelf.id === choice.target.id);
    task.crates = Math.min(robot.skills.carry, sim.backroomCrates, Math.ceil((SIM_RULES.shelfCapacity - task.shelf.stock - task.shelf.incoming) / SIM_RULES.itemsPerCrate));
    task.units = Math.min(task.crates * SIM_RULES.itemsPerCrate, SIM_RULES.shelfCapacity - task.shelf.stock - task.shelf.incoming);
    sim.backroomCrates -= task.crates;
    task.shelf.incoming += task.units;
    task.destination = task.shelf.id;
    walk(6);
    phase("Putting units on shelf", task.units / robot.skills.stocking);
  } else if (action === "unload_pad") {
    task.crates = Math.min(robot.skills.carry, sim.padCrates, sim.settings.backroomCapacity - sim.backroomCrates - sim.inboundCrates);
    sim.padCrates -= task.crates;
    sim.inboundCrates += task.crates;
    task.destination = "backroom";
    walk(4);
    phase("Loading and unloading crates", task.crates);
  } else if (action === "clean") {
    if (sim.garbage > sim.garbageClaimed) {
      task.garbage = Math.min(robot.skills.handleWaste, sim.garbage - sim.garbageClaimed);
      sim.garbageClaimed += task.garbage;
      walk(2);
      phase("Picking up garbage", task.garbage * 0.5);
      walk(2);
      phase("Emptying into trashcan", task.garbage * 0.5);
      task.destination = "trashcan";
    } else {
      sim.messesClaimed += 1;
      walk(2);
      phase("Mopping", 1 / robot.skills.mopping);
      task.destination = "floor";
    }
  } else if (action === "charge") {
    task.station = sim.stations.find((station) => station.id === choice.target.id);
    task.station.usedBy = robot.id;
    task.destination = task.station.id;
    if (robot.location !== task.destination) walk(3);
  } else phase("Waiting", 1);
  robot.task = task;
  if (action !== robot.lastAction) {
    const entry = robot.program[choice.ruleIndex];
    const why = !entry ? "nothing fit" : entry.ability ? entry.boardName : `slot ${entry.slot + 1}, command ${entry.command + 1}`;
    note(sim, `${robot.name} ${describe(task)} (${why})`);
  }
}

function finishTask(sim, robot) {
  const task = robot.task;
  if (task.action === "work_register") {
    const customer = task.customer && task.register.line[0] === task.customer ? task.register.line.shift() : null;
    if (customer) {
      sim.stats.sales += customer.items * SIM_RULES.itemPrice;
      sim.stats.served += 1;
      robot.completed.customers += 1;
    }
    task.register.staffedBy = null;
  } else if (task.action === "restock") {
    task.shelf.incoming -= task.units;
    task.shelf.stock = Math.min(SIM_RULES.shelfCapacity, task.shelf.stock + task.units);
    robot.completed.stocked += task.units;
    robot.completed.crateTrips += 1;
  } else if (task.action === "unload_pad") {
    sim.inboundCrates -= task.crates;
    sim.backroomCrates += task.crates;
    robot.completed.crates += task.crates;
    robot.completed.crateTrips += 1;
  } else if (task.action === "clean") {
    if (task.garbage) {
      sim.garbageClaimed -= task.garbage;
      sim.garbage -= task.garbage;
      robot.completed.garbage += task.garbage;
      robot.completed.trashTrips += 1;
    } else {
      sim.messesClaimed -= 1;
      sim.messes -= 1;
      robot.completed.mopped += 1;
    }
  } else if (task.action === "charge") {
    task.station.usedBy = null;
  }
  robot.lastAction = task.action;
  robot.location = task.destination ?? robot.location;
  robot.task = null;
}

/** Drops a half-done job when a robot runs flat, putting back anything it had claimed. */
function abandonTask(sim, robot) {
  const task = robot.task;
  if (!task) return;
  if (task.action === "work_register") task.register.staffedBy = null;
  else if (task.action === "restock") {
    task.shelf.incoming -= task.units;
    sim.backroomCrates += task.crates;
  } else if (task.action === "unload_pad") {
    sim.inboundCrates -= task.crates;
    sim.padCrates += task.crates;
  } else if (task.action === "clean") {
    if (task.garbage) sim.garbageClaimed -= task.garbage;
    else sim.messesClaimed -= 1;
  }
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
  if (sim.random() < SIM_RULES.messChance) {
    if (sim.random() < 0.5) sim.garbage += 1;
    else sim.messes += 1;
  }
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
    if (task.action === "charge" && task.phase >= task.phases.length) {
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
    // Time left over after finishing a job carries into the next one, so skill boosts
    // that shave part of a second still add up instead of being lost to the 1-second step.
    let remaining = 1;
    let current = task;
    for (let jobs = 0; jobs < 10; jobs += 1) {
      while (remaining > 1e-9 && current.phase < current.phases.length) {
        const phase = current.phases[current.phase];
        const elapsed = Math.min(remaining, phase.left);
        phase.left -= elapsed;
        remaining -= elapsed;
        if (phase.left <= 1e-9) current.phase += 1;
      }
      if (current.phase < current.phases.length || current.action === "charge") break;
      finishTask(sim, robot);
      if (remaining <= 1e-9) break;
      startTask(sim, robot);
      current = robot.task;
      if (current.action === "charge" || current.action === "wait") break;
    }
  }
  sim.time += 1;
  return sim;
}

export function runShift(setup, seed = 1) {
  const sim = createSim(setup, seed);
  while (sim.time < sim.settings.shiftSeconds) step(sim);
  return sim;
}

/** Controlled trials run through the same task engine as the store, overriding logic to test skills directly. */
export function diagnoseRobot(robot, parts, standardDrain = 1) {
  const cases = [
    { name: "Scan 12 items and count 2 pieces of change", action: "work_register", metric: "customers", goal: 1,
      prepare: (sim) => sim.registers[0].line.push({ items: 12, changeUnits: 2, arrived: 0 }) },
    { name: "Put 20 units on a shelf", action: "restock", metric: "stocked", goal: 20,
      prepare: (sim) => { sim.shelves[0].stock = 0; sim.backroomCrates = 2; } },
    { name: "Carry 6 delivery crates", action: "unload_pad", metric: "crates", goal: 6,
      prepare: (sim) => { sim.padCrates = 6; }, trips: "crateTrips" },
    { name: "Mop 6 dirty spots", action: "clean", metric: "mopped", goal: 6,
      prepare: (sim) => { sim.messes = 6; } },
    { name: "Take 6 pieces of garbage to the trashcan", action: "clean", metric: "garbage", goal: 6,
      prepare: (sim) => { sim.garbage = 6; }, trips: "trashTrips" },
    { name: "Scanning only: 12 items", action: "work_register", metric: "customers", goal: 1,
      prepare: (sim) => sim.registers[0].line.push({ items: 12, changeUnits: 0, arrived: 0 }) },
    { name: "Counting only: 12 pieces of change", action: "work_register", metric: "customers", goal: 1,
      prepare: (sim) => sim.registers[0].line.push({ items: 0, changeUnits: 12, arrived: 0 }) },
  ];
  const trial = (test, baseline) => {
    const sim = createSim({ parts, robots: [robot], settings: {
      shiftSeconds: 600, registers: 1, shelves: 1, stations: 1, customersPerMinute: 0,
      deliveryEverySeconds: 1000, cratesPerDelivery: 0, backroomCapacity: 12, startingBackroomCrates: 0, standardDrain,
    } });
    const live = sim.robots[0];
    if (live.noPower) return { error: "This build cannot switch on. Check its power requirement and board slots." };
    if (baseline) live.skills = Object.fromEntries(robotSkills(robot, parts).map((skill) => [skill.id, skill.base]));
    live.program = [{ condition: "diagnostic", action: test.action, slot: 0, command: 0 }];
    live.conditions = [{ id: "diagnostic", measure: "always" }];
    test.prepare(sim);
    while (live.completed[test.metric] < test.goal && sim.time < 600 && !live.outOfPower) step(sim);
    if (live.completed[test.metric] < test.goal) return { error: live.outOfPower ? "Ran out of charge before finishing." : "Did not finish within 600 seconds." };
    return { seconds: sim.time, chargeUsed: (1 - live.battery) * live.cell.charge,
      trips: test.trips ? live.completed[test.trips] : null };
  };
  return cases.map((test) => ({ name: test.name, base: trial(test, true), fitted: trial(test, false) }));
}
