import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chooseAction, conditionLabel, conditionProblems } from "../js/logic/RobotGambits.js";
import { hasEnoughPower, powerNeeded, robotProgram } from "../js/logic/RobotParts.js";
import { runShift } from "../scripts/robot-lab/sim.js";
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
});

test("a cell's drain rate scales the standard drain, and a robot with no charging command shuts down", () => {
  const robot = { name: "Forgetful", frame: "frame", cell: "big", boards: [{ board: "register" }] };
  const fast = runShift({ settings: { ...SETTINGS, shiftSeconds: 49 }, parts: PARTS, robots: [robot] });
  assert.ok(Math.abs(fast.robots[0].battery - (1 - (49 * 2) / 100)) < 1e-9);
  const sim = runShift({ settings: SETTINGS, parts: PARTS, robots: [robot] });
  assert.equal(sim.robots[0].outOfPower, true);
  assert.equal(sim.registers[0].staffedBy, null);
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
