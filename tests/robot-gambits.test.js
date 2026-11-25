import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chooseAction } from "../js/logic/RobotGambits.js";
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

test("a robot with no charging rule shuts down when its battery runs out", () => {
  const sim = runShift({
    settings: { shiftSeconds: 300, registers: 1, shelves: 2, stations: 1, customersPerMinute: 6, deliveryEverySeconds: 120, cratesPerDelivery: 2, backroomCapacity: 6, startingBackroomCrates: 1 },
    robots: [{ name: "Forgetful", speed: 1, batterySeconds: 100, slots: 1, program: [{ condition: "always", action: "work_register" }] }],
  });
  assert.equal(sim.robots[0].outOfPower, true);
  assert.equal(sim.registers[0].staffedBy, null);
});

test("the robot lab refuses programs with more rules than chip slots", () => {
  const problems = setupProblems({
    settings: { shiftSeconds: 60, registers: 1, shelves: 1, stations: 0, customersPerMinute: 1, deliveryEverySeconds: 60, cratesPerDelivery: 1, backroomCapacity: 1, startingBackroomCrates: 0 },
    robots: [{ name: "Tiny", speed: 1, batterySeconds: 10, slots: 1, program: [{ condition: "always", action: "wait" }, { condition: "nope", action: "wait" }] }],
  });
  assert.match(problems.join("\n"), /only 1 chip slots/);
  assert.match(problems.join("\n"), /unknown condition "nope"/);
});
