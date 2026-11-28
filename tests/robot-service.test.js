import assert from "node:assert/strict";
import test from "node:test";
import { RobotServiceSystem } from "../js/systems/RobotServiceSystem.js";
import { ROBOT_PART_CATALOG, ROBOT_PARTS, ROBOT_SERVICE_LEVEL, isRobotPartUnlocked } from "../js/logic/RobotServiceCatalog.js";
import { RobotService } from "../js/state/slices/RobotService.js";
import { LEDGER_CATEGORIES } from "../js/logic/DayLedger.js";

function harness({ level = ROBOT_SERVICE_LEVEL, money = 10000, canManage = true } = {}) {
  const messages = [];
  let saved = 0;
  const gameState = {
    reputation: { shopLevel: level },
    economy: {
      balance: money,
      canAfford(amount) { return this.balance >= amount; },
      spend(amount) { this.balance -= amount; },
    },
    robotService: new RobotService(),
    batch(callback) { callback(); },
  };
  const scene = {
    gameState,
    shift: { starting: false },
    saves: {
      loadFailed: false,
      canSaveOffShift: () => canManage,
      requestAutosave: () => { saved += 1; },
    },
    messages: { show: (message) => messages.push(message) },
  };
  return { system: new RobotServiceSystem(scene), gameState, messages, saved: () => saved };
}

function installMasterComputer(system, gameState, level = 1) {
  gameState.robotService.setMasterComputerLevel(level);
  system.scene.fixtures = {
    ofKind: (type) => type === "master_computer" ? [{}] : [],
  };
}

test("Robot Service unlocks at its configured level and its catalog excludes custom boards", () => {
  assert.equal(ROBOT_SERVICE_LEVEL, 5);
  assert.equal(isRobotPartUnlocked("basic_frame", ROBOT_SERVICE_LEVEL - 1), false);
  assert.equal(isRobotPartUnlocked("basic_frame", ROBOT_SERVICE_LEVEL), true);
  for (const id of ["worker_frame", "long_life_cell", "self_charge_1", "register_1", "stock_1"]) {
    assert.equal(isRobotPartUnlocked(id, 5), true, `${id} must be available for a working starter robot`);
  }
  assert.equal(ROBOT_PART_CATALOG.some(({ id }) => id.startsWith("custom_")), false);
  assert.ok(LEDGER_CATEGORIES.includes("robot_parts"));
});

test("the Master Computer purchase checks access, license, money, and loading-pad space", () => {
  const locked = harness({ level: ROBOT_SERVICE_LEVEL - 1 });
  assert.equal(locked.system.buyMasterComputer(), false);
  assert.match(locked.messages[0], /opens at Shop Level/);

  const ready = harness();
  const computerPrice = 2500;
  ready.gameState.catalog = { owns: () => false };
  ready.system.scene.supply = { firstFreePadSpot: () => ({ x: 1, y: 1 }) };
  ready.system.scene.fixtureSystem = {
    buy: () => {
      ready.gameState.economy.spend(computerPrice);
      return true;
    },
  };
  assert.equal(ready.system.buyMasterComputer(), false);
  assert.match(ready.messages.at(-1), /contract/);
  assert.equal(ready.gameState.robotService.masterComputerLevel, 0);

  ready.gameState.catalog.owns = () => true;
  ready.system.scene.supply.firstFreePadSpot = () => null;
  assert.equal(ready.system.buyMasterComputer(), false);
  assert.match(ready.messages.at(-1), /loading pad/);
  ready.system.scene.supply.firstFreePadSpot = () => ({ x: 1, y: 1 });
  assert.equal(ready.system.buyMasterComputer(), true);
  assert.equal(ready.gameState.economy.balance, 10000 - computerPrice);
  assert.equal(ready.gameState.robotService.masterComputerLevel, 1);
  assert.equal(ready.saved(), 0);
});

test("computer upgrades add one rack at a time and require the computer in the shop", () => {
  const { system, gameState, messages, saved } = harness();
  gameState.robotService.setMasterComputerLevel(1);
  system.scene.fixtures = { ofKind: () => [] };
  assert.equal(system.buyMasterComputerUpgrade(2), false);
  assert.match(messages.at(-1), /Place the Master Computer/);

  installMasterComputer(system, gameState);
  system.scene.fixtureViews = { orient: () => {} };
  assert.throws(() => system.buyMasterComputerUpgrade(3), /Invalid Master Computer upgrade level/);
  assert.throws(() => system.buyMasterComputerUpgrade(6), /Invalid Master Computer upgrade level/);
  assert.equal(system.buyMasterComputerUpgrade(2), true);
  assert.equal(gameState.robotService.masterComputerLevel, 2);
  assert.equal(gameState.economy.balance, 7000);
  assert.equal(saved(), 0);
});

test("buying a part checks unlock, affordability, and off-shift access", () => {
  const locked = harness({ level: ROBOT_SERVICE_LEVEL - 1 });
  assert.equal(locked.system.buyPart("basic_frame"), false);
  assert.match(locked.messages[0], /opens at Shop Level/);
  assert.equal(locked.gameState.robotService.partCount("basic_frame"), 0);

  const poor = harness({ money: 0 });
  assert.equal(poor.system.buyPart("basic_frame"), false);
  assert.match(poor.messages[0], /Not enough money/);

  const busy = harness({ canManage: false });
  assert.equal(busy.system.buyPart("basic_frame"), false);
  assert.match(busy.messages[0], /between shifts/);

  const ready = harness();
  const price = ROBOT_PART_CATALOG.find(({ id }) => id === "basic_frame").price;
  assert.equal(ready.system.buyPart("basic_frame"), true);
  assert.equal(ready.gameState.economy.balance, 10000 - price);
  assert.equal(ready.gameState.robotService.partCount("basic_frame"), 1);
  assert.equal(ready.saved(), 0);
});

test("a useful self-charging stock robot can be assembled at Shop Level 5", () => {
  const { system, gameState } = harness({ level: 5 });
  installMasterComputer(system, gameState);
  const inventory = gameState.robotService;
  for (const id of ["worker_frame", "long_life_cell", "self_charge_1", "stock_1"]) {
    assert.equal(isRobotPartUnlocked(id, 5), true);
    inventory.addPart(id);
  }
  const robot = system.assemble({
    name: "First Stocker",
    frame: "worker_frame",
    cell: "long_life_cell",
    boards: ["self_charge_1", "stock_1"],
  });
  assert.equal(robot.name, "First Stocker");
  assert.equal(robot.boards.length, 2);
});

test("charging stations require an unlocked, quiet store and a free loading pad", () => {
  const { system, gameState, messages, saved } = harness();
  gameState.catalog = { owns: () => true };
  system.scene.supply = { firstFreePadSpot: () => null };
  let ordered = "";
  system.scene.fixtureSystem = { buy: (type) => { ordered = type; return true; } };
  assert.equal(system.buyChargingStation(), false);
  assert.match(messages.at(-1), /loading pad/);
  system.scene.supply.firstFreePadSpot = () => ({ x: 1, y: 1 });
  assert.equal(system.buyChargingStation(), true);
  assert.equal(ordered, "robot_charger");
  assert.equal(saved(), 0);
  gameState.reputation.shopLevel = ROBOT_SERVICE_LEVEL - 1;
  assert.equal(system.buyChargingStation(), false);
});

test("assembly consumes owned parts for a powered robot; dismantling returns them", () => {
  const { system, gameState, saved } = harness();
  installMasterComputer(system, gameState);
  const service = gameState.robotService;
  for (const id of ["worker_frame", "basic_cell", "self_charge_1", "register_1"]) service.addPart(id);
  const robot = system.assemble({
    name: "Checkout Bot", frame: "worker_frame", cell: "basic_cell",
    boards: ["self_charge_1", "register_1", ""],
  });
  assert.equal(robot.id, "robot-1");
  assert.equal(robot.name, "Checkout Bot");
  assert.equal(robot.boards.length, 2);
  assert.equal(service.robots.length, 1);
  assert.equal(service.partCount("worker_frame"), 0);
  assert.equal(service.partCount("register_1"), 0);
  assert.equal(saved(), 0);

  assert.equal(system.dismantle(robot.id), true);
  assert.equal(service.robots.length, 0);
  assert.equal(service.partCount("worker_frame"), 1);
  assert.equal(service.partCount("register_1"), 1);
  assert.equal(saved(), 0);
});

test("assembly refuses builds with insufficient power, no logic board, or custom boards", () => {
  const { system, gameState, messages } = harness();
  installMasterComputer(system, gameState);
  for (const id of ["worker_frame", "basic_cell", "self_charge_1", "stock_3"]) gameState.robotService.addPart(id);
  assert.equal(system.assemble({
    name: "Too Much Power", frame: "worker_frame", cell: "basic_cell",
    boards: ["self_charge_1", "stock_3"],
  }), null);
  assert.match(messages.at(-1), /power/);

  for (const id of ["high_capacity_cell", "mod_register"]) gameState.robotService.addPart(id);
  assert.equal(system.assemble({
    name: "No Logic", frame: "worker_frame", cell: "high_capacity_cell", boards: ["mod_register"],
  }), null);
  assert.match(messages.at(-1), /at least one logic board/);

  gameState.robotService.addPart("custom_small");
  assert.equal(system.assemble({
    name: "Custom", frame: "worker_frame", cell: "high_capacity_cell",
    boards: ["custom_small"],
  }), null);
});

test("the Master Computer limits both purchased and assembled robots", () => {
  const { system, gameState, messages } = harness();
  installMasterComputer(system, gameState);
  const first = system.buyPrebuiltRobot("shop_robot", "Stocker");
  assert.equal(first.name, "Stocker");
  assert.equal(system.buyPrebuiltRobot("register_robot", "Cashier"), null);
  assert.match(messages.at(-1), /can't run any more robots/);

  for (const id of ["worker_frame", "basic_cell", "self_charge_1", "stock_1"]) gameState.robotService.addPart(id);
  assert.equal(system.assemble({
    name: "Second Robot", frame: "worker_frame", cell: "basic_cell", boards: ["self_charge_1", "stock_1"],
  }), null);
  assert.equal(gameState.robotService.robots.length, 1);
});

test("robot service state round-trips its inventory and assembled builds", () => {
  const state = new RobotService();
  for (const id of ["worker_frame", "basic_cell", "register_1"]) state.addPart(id);
  const built = state.addRobot({
    name: "Register Bot", frame: "worker_frame", cell: "basic_cell", boards: [{ board: "register_1" }],
  });
  const restored = RobotService.fromSave(state.toSave());
  assert.deepEqual(restored.toSave(), state.toSave());
  assert.equal(restored.robots[0].id, built.id);
  assert.equal(ROBOT_PARTS.frames.some(({ id }) => id === restored.robots[0].frame), true);
});

test("robot shift choices and charge persist, and can only be changed between shifts", () => {
  const { system, gameState } = harness();
  const service = gameState.robotService;
  const robot = service.addRobot({
    name: "Robot", frame: "worker_frame", cell: "basic_cell", boards: [{ board: "register_1" }],
  });
  service.setBattery(robot.id, 0.25);
  assert.equal(system.setOnShift(robot.id, false), true);
  const restored = RobotService.fromSave(service.toSave());
  assert.equal(restored.robots[0].onShift, false);
  assert.equal(restored.robots[0].battery, 0.25);
  system.scene.shift.starting = true;
  assert.equal(system.setOnShift(robot.id, true), false);
  assert.equal(robot.onShift, false);
});
