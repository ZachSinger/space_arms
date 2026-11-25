import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chooseAction, conditionLabel, conditionProblems, measureProblems } from "../js/logic/RobotGambits.js";
import { buildWarnings, hasEnoughPower, partsProblems, powerNeeded, robotProgram, robotSkills } from "../js/logic/RobotParts.js";
import { createSim, diagnoseRobot, runShift, step } from "../scripts/robot-lab/sim.js";
import { setupProblems } from "../scripts/robot-lab/server.mjs";

const world = (overrides = {}) => ({
  registers: [{ id: "r1", line: 0, staffedBy: null }],
  shelves: [{ id: "s1", fill: 0.8 }, { id: "s2", fill: 0.1 }],
  padCrates: 0,
  backroomCrates: 2,
  backroomCapacity: 10,
  messes: 0,
  stations: [{ id: "c1", usedBy: null }],
  ...overrides,
});
const robot = { id: "bot", battery: 0.9 };

test("a robot does the first rule whose condition is true and whose job can be done", () => {
  const program = [
    { condition: "battery_below_20", action: "charge" },
    { condition: "crate_on_pad", action: "unload_pad" },
    { condition: "shelf_below_25", action: "restock" },
    { condition: "always", action: "work_register" },
  ];
  const choice = chooseAction(program, world(), robot);
  assert.equal(choice.ruleIndex, 2);
  assert.equal(choice.target.id, "s2");
  assert.deepEqual(choice.checks.map((check) => check.result), ["condition false", "condition false", "chosen"]);
});

test("a robot skips rules that are off or whose job is impossible, and waits when nothing fits", () => {
  const program = [
    { condition: "always", action: "clean", on: true },
    { condition: "always", action: "restock", on: false },
    { condition: "customer_waiting", action: "work_register" },
  ];
  const choice = chooseAction(program, world({ registers: [{ id: "r1", line: 2, staffedBy: "other" }] }), robot);
  assert.equal(choice.ruleIndex, -1);
  assert.equal(choice.action, "wait");
  assert.deepEqual(choice.checks.map((check) => check.result), ["can't do it right now", "off", "can't do it right now"]);
});

test("the saved robot lab setup is valid and runs a shift without robots running flat", async () => {
  const setup = JSON.parse(await readFile(new URL("../data/RobotPrograms.json", import.meta.url), "utf8"));
  assert.deepEqual(setupProblems(setup), []);
  const sim = runShift(setup, 7);
  assert.ok(sim.stats.served > 0);
  assert.ok(sim.robots.every((entry) => !entry.outOfPower));
});

test("a prefab board does its built-in job, and is skipped when that job has nothing to do", () => {
  const program = [{ ability: "clean_1" }, { ability: "stock_1" }, { ability: "register_1" }];
  const busy = chooseAction(program, world({ shelves: [{ id: "s1", fill: 0 }] }), robot);
  assert.equal(busy.ruleIndex, 1);
  assert.equal(busy.action, "restock");
  assert.deepEqual(busy.checks.map((check) => check.result), ["nothing to do", "chosen"]);
  const quiet = chooseAction(program, world({ backroomCrates: 0 }), robot);
  assert.equal(quiet.action, "wait");
  assert.deepEqual(quiet.checks.map((check) => check.result), ["nothing to do", "nothing to do", "nothing to do"]);
});

const PARTS = {
  frames: [{ id: "frame", name: "Frame", power: 4, boardSlots: 2, speed: 1 }],
  cells: [
    { id: "small", name: "Small cell", capacity: 8, charge: 100, drainRate: 1, chargeRate: 5 },
    { id: "big", name: "Big cell", capacity: 20, charge: 100, drainRate: 2, chargeRate: 5 },
  ],
  boards: [
    { id: "register", name: "Register", kind: "prefab", power: 3, ability: "register_2" },
    { id: "custom", name: "Custom", kind: "custom", power: 2, commands: 2 },
  ],
  commandPower: { conditions: { battery_below_20: 1, always: 0 }, actions: { charge: 1, work_register: 2 } },
};
const SETTINGS = { shiftSeconds: 300, registers: 1, shelves: 2, stations: 1, customersPerMinute: 6, deliveryEverySeconds: 120, cratesPerDelivery: 2, backroomCapacity: 6, startingBackroomCrates: 1, standardDrain: 1 };

test("a robot's power need is its frame plus its boards, and custom boards add each command's cost", () => {
  const robot = { name: "Bot", frame: "frame", cell: "small", boards: [{ board: "custom", program: [{ condition: "battery_below_20", action: "charge" }] }, { board: "register" }] };
  assert.equal(powerNeeded(robot, PARTS), 4 + (2 + 1 + 1) + 3);
  assert.equal(hasEnoughPower(robot, PARTS), false);
  assert.equal(hasEnoughPower({ ...robot, cell: "big" }, PARTS), true);
  assert.deepEqual(robotProgram(robot, PARTS).map((rule) => [rule.slot, rule.action ?? rule.ability]), [[0, "charge"], [1, "register_2"]]);
});

test("a robot whose parts need more power than its cell's capacity never switches on", () => {
  const sim = runShift({ settings: SETTINGS, parts: PARTS, robots: [{ name: "Heavy", frame: "frame", cell: "small", boards: [{ board: "register" }, { board: "register" }] }] });
  assert.equal(sim.robots[0].noPower, true);
  assert.equal(sim.robots[0].busySeconds, 0);
  assert.equal(sim.stats.served, 0);
  assert.match(diagnoseRobot(sim.robots[0].build, PARTS)[0].fitted.error, /cannot switch on/);
});

test("a cell's drain rate scales the standard drain, and a robot with no charging command shuts down", () => {
  const robot = { name: "Forgetful", frame: "frame", cell: "big", boards: [{ board: "register" }] };
  const fast = runShift({ settings: { ...SETTINGS, shiftSeconds: 49 }, parts: PARTS, robots: [robot] });
  assert.ok(Math.abs(fast.robots[0].battery - (1 - (49 * 2) / 100)) < 1e-9);
  const sim = runShift({ settings: SETTINGS, parts: PARTS, robots: [robot] });
  assert.equal(sim.robots[0].outOfPower, true);
  assert.equal(sim.registers[0].staffedBy, null);
  assert.match(diagnoseRobot(robot, { ...PARTS, cells: PARTS.cells.map((cell) => ({ ...cell, charge: 1 })) })[0].fitted.error, /Ran out of charge/);
});

test("the robot lab refuses builds that don't fit their parts", () => {
  const problems = setupProblems({
    settings: SETTINGS,
    parts: PARTS,
    robots: [{ name: "Tiny", frame: "frame", cell: "small", boards: [
      { board: "custom", program: [{ condition: "always", action: "wait" }, { condition: "nope", action: "wait" }, { condition: "always", action: "wait" }] },
      { board: "register" },
      { board: "register" },
    ] }],
  }).join("\n");
  assert.match(problems, /only has 2 board slots/);
  assert.match(problems, /only 2 command spaces/);
  assert.match(problems, /unknown condition "nope"/);
});

test("conditions are built from data, so a new one works without code changes", () => {
  const custom = [{ id: "half_charge", measure: "my_charge", compare: "below", value: 50 }];
  assert.equal(conditionLabel(custom[0]), "My charge is below 50%");
  const program = [{ condition: "half_charge", action: "charge" }, { condition: "always", action: "wait" }];
  assert.equal(chooseAction(program, world(), { id: "bot", battery: 0.4 }, [...custom, { id: "always", measure: "always" }]).ruleIndex, 0);
  assert.equal(chooseAction(program, world(), { id: "bot", battery: 0.6 }, [...custom, { id: "always", measure: "always" }]).ruleIndex, 1);
  assert.throws(() => chooseAction(program, world(), robot, []));
  assert.ok(conditionProblems([{ id: "bad", measure: "nope", compare: "below", value: 1 }]).length > 0);
  assert.ok(conditionProblems([{ id: "bad", measure: "my_charge", compare: "below", value: -1 }]).length > 0);
  assert.deepEqual(conditionProblems(custom), []);
});

test("checks are built from data too, so a new thing to check works without code changes", () => {
  const measures = [{ id: "fullest_shelf", label: "The fullest shelf", fact: "shelf_fill", combine: "highest", unit: "% full" },
    { id: "spare_stock", label: "Crates stored minus messes", fact: "stored_crates", minus: "messes" }];
  const conditions = [{ id: "a_shelf_full", measure: "fullest_shelf", compare: "at_least", value: 80 }, { id: "spare", measure: "spare_stock", compare: "above", value: 1 }];
  assert.equal(conditionLabel(conditions[0], measures), "The fullest shelf is at least 80% full");
  const program = [{ condition: "a_shelf_full", action: "clean" }, { condition: "spare", action: "restock" }];
  assert.equal(chooseAction(program, world({ messes: 1 }), robot, conditions, measures).ruleIndex, 0);
  assert.equal(chooseAction(program, world({ shelves: [{ id: "s1", fill: 0.5 }] }), robot, conditions, measures).ruleIndex, 1);
  assert.equal(chooseAction(program, world({ shelves: [{ id: "s1", fill: 0.5 }], messes: 1 }), robot, conditions, measures).ruleIndex, -1);
  assert.deepEqual(measureProblems(measures), []);
  assert.ok(measureProblems([{ id: "x", label: "X", fact: "shelf_fill" }]).length > 0);
  assert.ok(conditionProblems(conditions, []).length > 0);
});

test("a check written in plain words before the game can work it out is saved, but never makes a condition true", () => {
  const measures = [{ id: "long_wait", label: "The longest any customer has waited", describe: "Seconds the longest-waiting customer has been in line" }];
  const conditions = [{ id: "waited", measure: "long_wait", compare: "above", value: 0 }];
  assert.deepEqual(measureProblems(measures), []);
  assert.deepEqual(conditionProblems(conditions, measures), []);
  assert.equal(chooseAction([{ condition: "waited", action: "wait" }], world(), robot, conditions, measures).checks[0].result, "condition false");
});

test("modifier boards share power and slots, and only the strongest bonus to each skill applies", () => {
  const parts = structuredClone(PARTS);
  parts.frames[0].boardSlots = 4;
  parts.boards.push(
    { id: "scan", name: "Scan", kind: "modifier", power: 2, modifiers: { scanning: 20 } },
    { id: "mixed", name: "Mixed", kind: "modifier", power: 5, modifiers: { scanning: 50, carry: 50 } },
    { id: "tie", name: "Tie", kind: "modifier", power: 2, modifiers: { carry: 50 } },
  );
  const robot = { name: "Bot", frame: "frame", cell: "big", boards: [{ board: "scan" }, { board: "mixed" }, { board: "tie" }] };
  const stats = Object.fromEntries(robotSkills(robot, parts).map((skill) => [skill.id, skill]));
  assert.equal(stats.scanning.value, 1.5);
  assert.equal(stats.carry.value, 3);
  assert.equal(stats.carry.source.slot, 1);
  assert.equal(powerNeeded(robot, parts), 13);
  assert.deepEqual(robotProgram(robot, parts), []);
  assert.match(buildWarnings(robot, parts).join("\n"), /Scan's Scanning \+20% does nothing/);
  assert.match(buildWarnings(robot, parts).join("\n"), /Tie's Carry \+50% does nothing/);
  parts.boards[2].modifiers = { carry: 20 };
  const roundedRobot = { ...robot, boards: [{ board: "scan" }] };
  const rounded = robotSkills(roundedRobot, parts).find((skill) => skill.id === "carry");
  assert.equal(rounded.value, 2);
  assert.match(buildWarnings(roundedRobot, parts).join("\n"), /still holds only 2/);
  assert.deepEqual(partsProblems(parts), []);
  parts.boards[2].modifiers = { invented: 20, carry: -10 };
  assert.equal(partsProblems(parts).length, 2);
});

test("diagnostics exercise all six skills through the live task engine, including batch carrying and trashcan trips", () => {
  const parts = structuredClone(PARTS);
  parts.cells[1].charge = 1000;
  parts.boards.push({ id: "all", name: "All skills", kind: "modifier", power: 5,
    modifiers: { stocking: 50, scanning: 50, counting: 50, carry: 50, handleWaste: 50, mopping: 50 } });
  const robot = { name: "Diagnostic", frame: "frame", cell: "big", boards: [{ board: "all" }] };
  const rows = diagnoseRobot(robot, parts, 1);
  for (const row of rows) {
    assert.equal(row.base.error, undefined, row.name);
    assert.equal(row.fitted.error, undefined, row.name);
    assert.ok(row.fitted.seconds < row.base.seconds, row.name);
    assert.ok(row.fitted.chargeUsed < row.base.chargeUsed, row.name);
  }
  assert.equal(rows[0].base.seconds, 16);
  assert.equal(rows[1].base.seconds, 16);
  assert.deepEqual([rows[2].base.trips, rows[2].fitted.trips], [3, 2]);
  assert.deepEqual([rows[4].base.trips, rows[4].fitted.trips], [3, 2]);
});

test("frame speed changes only walking, while scanning and counting speed up their own checkout phases", () => {
  const parts = structuredClone(PARTS);
  parts.cells[1].charge = 1000;
  const robot = { name: "Bot", frame: "frame", cell: "big", boards: [{ board: "register" }] };
  const trial = (bonuses, speed) => {
    const copy = structuredClone(parts);
    copy.frames[0].speed = speed;
    copy.boards.push({ id: "mods", name: "Mods", kind: "modifier", power: 1, modifiers: bonuses });
    const sim = createSim({ parts: copy, robots: [{ ...robot, boards: [...robot.boards, { board: "mods" }] }],
      settings: { ...SETTINGS, customersPerMinute: 0, cratesPerDelivery: 0 } });
    sim.registers[0].line.push({ items: 12, changeUnits: 2, arrived: 0 });
    step(sim);
    return sim.robots[0].task.phases;
  };
  const normal = trial({ scanning: 20 }, 1);
  const swift = trial({ scanning: 20 }, 2);
  assert.equal(normal[0].left, 1);
  assert.equal(swift[0].left, 0);
  assert.equal(normal[1].left, swift[1].left);
  assert.equal(normal[2].left, swift[2].left);
  const count = trial({ counting: 100 }, 1);
  assert.equal(count[1].left, 12);
  assert.equal(count[2].left, 1);
});

test("a skill boost too small to save a whole second per customer still adds up over a line of customers", () => {
  const parts = structuredClone(PARTS);
  parts.cells[1].charge = 100000;
  parts.boards.push({ id: "mods", name: "Mods", kind: "modifier", power: 1, modifiers: { scanning: 20, counting: 20 } });
  const secondsToServe = (boards) => {
    const sim = createSim({ parts, robots: [{ name: "Bot", frame: "frame", cell: "big", boards }],
      settings: { ...SETTINGS, customersPerMinute: 0, cratesPerDelivery: 0 } });
    for (let index = 0; index < 6; index += 1) sim.registers[0].line.push({ items: 2, changeUnits: 2, arrived: 1000 });
    while (sim.robots[0].completed.customers < 6) step(sim);
    return sim.time;
  };
  // Each customer takes 4 seconds unboosted and 3.33 boosted, which rounded up to 4 before.
  assert.ok(secondsToServe([{ board: "register" }, { board: "mods" }]) < secondsToServe([{ board: "register" }]) - 2);
});

test("batch jobs reserve only available resources and return their entire batch when charge runs out", () => {
  const parts = structuredClone(PARTS);
  parts.cells[1].charge = 1;
  const robot = { name: "Bot", frame: "frame", cell: "big", boards: [] };
  const setup = { parts, robots: [robot], settings: { ...SETTINGS, customersPerMinute: 0, cratesPerDelivery: 0 } };
  for (const action of ["unload_pad", "restock", "clean"]) {
    const sim = createSim(setup);
    sim.robots[0].program = [{ condition: "always", action, slot: 0, command: 0 }];
    sim.padCrates = 6;
    sim.backroomCrates = 2;
    sim.shelves[0].stock = 0;
    sim.garbage = 6;
    step(sim);
    assert.equal(sim.robots[0].outOfPower, true);
    assert.equal(sim.padCrates, 6);
    assert.equal(sim.backroomCrates, 2);
    assert.equal(sim.shelves[0].incoming, 0);
    assert.equal(sim.inboundCrates, 0);
    assert.equal(sim.garbageClaimed, 0);
    assert.equal(sim.garbage, 6);
  }
  parts.cells[1].charge = 1000;
  const sim = createSim(setup);
  sim.robots[0].program = [{ condition: "always", action: "unload_pad", slot: 0, command: 0 }];
  sim.padCrates = 6;
  sim.backroomCrates = sim.settings.backroomCapacity - 1;
  step(sim);
  assert.equal(sim.robots[0].task.crates, 1);
  assert.equal(sim.inboundCrates, 1);
});

test("a customer arriving while a robot walks to an empty register still gets scanned and counted", () => {
  const robot = { name: "Bot", frame: "frame", cell: "big", boards: [{ board: "register" }] };
  const sim = createSim({ parts: PARTS, robots: [robot], settings: { ...SETTINGS, customersPerMinute: 0, cratesPerDelivery: 0 } });
  step(sim);
  sim.registers[0].line.push({ items: 4, changeUnits: 2, arrived: 1 });
  step(sim);
  step(sim);
  assert.equal(sim.stats.served, 0);
  step(sim);
  assert.equal(sim.robots[0].task.phases[0].label, "Scanning items");
  assert.equal(sim.stats.served, 0);
  while (sim.time < 9) step(sim);
  assert.equal(sim.stats.served, 1);
});
