import { buildProblems, hasEnoughPower, powerNeeded } from "../logic/RobotParts.js";
import {
  getRobotPart,
  isRobotPartUnlocked,
  isRobotServiceUnlocked,
  ROBOT_SERVICE_LEVEL,
  ROBOT_PARTS,
  MASTER_COMPUTER_UPGRADE_PRICES,
  PREBUILT_ROBOTS,
} from "../logic/RobotServiceCatalog.js";
import { getFixtureType } from "../logic/FixtureLayout.js";

export const ROBOT_CHARGER_TYPE = "robot_charger";
export const MASTER_COMPUTER_TYPE = "master_computer";

export class RobotServiceSystem {
  constructor(scene) {
    this.scene = scene;
  }

  canManage() {
    const { scene } = this;
    return !scene.shift.starting && !scene.saves.loadFailed && scene.saves.canSaveOffShift();
  }

  masterComputerPlaced() {
    return this.scene.fixtures.ofKind(MASTER_COMPUTER_TYPE).length > 0;
  }

  buyMasterComputer() {
    const { scene } = this;
    const { gameState } = scene;
    const computer = getFixtureType(MASTER_COMPUTER_TYPE);
    if (!isRobotServiceUnlocked(gameState.reputation.shopLevel)) {
      scene.messages.show(`Robot Service opens at Shop Level ${ROBOT_SERVICE_LEVEL}.`);
      return false;
    }
    if (!this.canManage()) {
      scene.messages.show("The Master Computer can only be bought between shifts.");
      return false;
    }
    if (gameState.robotService.masterComputerLevel > 0) {
      scene.messages.show("You already own a Master Computer.");
      return false;
    }
    if (!gameState.catalog.owns(computer.licenseId)) {
      scene.messages.show("Sign the Basic Fixture Supply contract before buying the Master Computer.");
      return false;
    }
    if (!gameState.economy.canAfford(computer.price)) {
      scene.messages.show(`Not enough money. The Master Computer costs ${computer.price}.`);
      return false;
    }
    if (!scene.supply.firstFreePadSpot()) {
      scene.messages.show("Clear a space on the loading pad before buying the Master Computer.");
      return false;
    }
    let purchased = false;
    gameState.batch(() => {
      purchased = scene.fixtureSystem.buy(MASTER_COMPUTER_TYPE);
      if (purchased) gameState.robotService.setMasterComputerLevel(1);
    });
    if (!purchased) {
      scene.messages.show("The Master Computer could not be ordered. Check your money and the loading pad.");
      return false;
    }
    scene.messages.show("Master Computer ordered. Place it from the loading pad to use the Master Terminal.", "#10b981");
    scene.saves.requestAutosave();
    return true;
  }

  buyMasterComputerUpgrade(level) {
    const { scene } = this;
    const { gameState } = scene;
    const currentLevel = gameState.robotService.masterComputerLevel;
    if (!Number.isInteger(level) || level !== currentLevel + 1 || level < 2 || level > 5) {
      throw new RangeError(`Invalid Master Computer upgrade level: ${level}.`);
    }
    if (!isRobotServiceUnlocked(gameState.reputation.shopLevel)) {
      scene.messages.show(`Robot Service opens at Shop Level ${ROBOT_SERVICE_LEVEL}.`);
      return false;
    }
    if (!this.canManage()) {
      scene.messages.show("Master Computer upgrades can only be bought between shifts.");
      return false;
    }
    if (!this.masterComputerPlaced()) {
      scene.messages.show("Place the Master Computer in your shop before upgrading it.");
      return false;
    }
    const price = MASTER_COMPUTER_UPGRADE_PRICES[level - 2];
    if (!gameState.economy.canAfford(price)) {
      scene.messages.show(`Not enough money. Computer Upgrade ${level - 1} costs ${price}.`);
      return false;
    }
    gameState.batch(() => {
      gameState.economy.spend(price, { category: "robot_parts", label: `Computer Upgrade ${level - 1}` });
      gameState.robotService.setMasterComputerLevel(level);
    });
    this.scene.fixtureViews.orient(this.scene.fixtures.ofKind(MASTER_COMPUTER_TYPE)[0]);
    scene.messages.show(`Computer Upgrade ${level - 1} installed. Your Master Computer can run ${level} robot${level === 1 ? "" : "s"}.`, "#10b981");
    scene.saves.requestAutosave();
    return true;
  }

  buyPrebuiltRobot(presetId, name) {
    const { scene } = this;
    const { gameState } = scene;
    const preset = PREBUILT_ROBOTS.find(({ id }) => id === presetId);
    if (!preset) throw new Error(`Unknown prebuilt robot: ${presetId}.`);
    if (!isRobotServiceUnlocked(gameState.reputation.shopLevel)) {
      scene.messages.show(`Robot Service opens at Shop Level ${ROBOT_SERVICE_LEVEL}.`);
      return null;
    }
    if (!this.canManage()) {
      scene.messages.show("Robots can only be bought between shifts.");
      return null;
    }
    if (!this.masterComputerPlaced()) {
      scene.messages.show("Place the Master Computer in your shop before buying robots.");
      return null;
    }
    const { robotService } = gameState;
    if (robotService.robots.length >= robotService.masterComputerLevel) {
      scene.messages.show("Your Master Computer can't run any more robots. Upgrade it to add another rack.");
      return null;
    }
    const robotName = String(name ?? "").trim();
    if (!robotName || robotName.length > 30) {
      scene.messages.show("Give the robot a name of 1 to 30 characters.");
      return null;
    }
    if (!gameState.economy.canAfford(preset.price)) {
      scene.messages.show(`Not enough money. ${preset.name} costs ${preset.price}.`);
      return null;
    }
    const build = { frame: preset.frame, cell: preset.cell, boards: preset.boards.map((board) => ({ board })) };
    const problems = buildProblems(build, ROBOT_PARTS);
    if (problems.length || !hasEnoughPower(build, ROBOT_PARTS)) {
      throw new Error(`Invalid prebuilt robot catalog entry: ${preset.id}.`);
    }
    let robot;
    gameState.batch(() => {
      gameState.economy.spend(preset.price, { category: "robot_parts", label: preset.name });
      robot = robotService.addRobot({ ...build, name: robotName, battery: 1 });
    });
    scene.messages.show(`${robot.name} bought.`, "#10b981");
    scene.saves.requestAutosave();
    return robot;
  }

  buyPart(partId) {
    const { scene } = this;
    const { gameState } = scene;
    const part = getRobotPart(partId);
    if (!part) throw new Error(`Unknown Robot Service part: ${partId}.`);
    if (!isRobotServiceUnlocked(gameState.reputation.shopLevel)) {
      scene.messages.show(`Robot Service opens at Shop Level ${ROBOT_SERVICE_LEVEL}.`);
      return false;
    }
    if (!isRobotPartUnlocked(partId, gameState.reputation.shopLevel)) {
      scene.messages.show(`${part.name} unlocks at Shop Level ${part.level}.`);
      return false;
    }
    if (!this.canManage()) {
      scene.messages.show("Robot parts can only be bought between shifts.");
      return false;
    }
    if (!gameState.economy.canAfford(part.price)) {
      scene.messages.show(`Not enough money. ${part.name} costs ${part.price}.`);
      return false;
    }
    gameState.batch(() => {
      gameState.economy.spend(part.price, { category: "robot_parts", label: part.name });
      gameState.robotService.addPart(partId);
    });
    scene.messages.show(`${part.name} bought.`, "#10b981");
    scene.saves.requestAutosave();
    return true;
  }

  buyChargingStation() {
    const { scene } = this;
    const { gameState } = scene;
    const station = getFixtureType(ROBOT_CHARGER_TYPE);
    if (!isRobotServiceUnlocked(gameState.reputation.shopLevel)) {
      scene.messages.show(`Robot Service opens at Shop Level ${ROBOT_SERVICE_LEVEL}.`);
      return false;
    }
    if (!this.canManage()) {
      scene.messages.show("Charging stations can only be bought between shifts.");
      return false;
    }
    if (!gameState.catalog.owns(station.licenseId)) {
      scene.messages.show("Sign the Basic Fixture Supply contract before buying a charging station.");
      return false;
    }
    if (!gameState.economy.canAfford(station.price)) {
      scene.messages.show(`Not enough money. A robot charging station costs ${station.price}.`);
      return false;
    }
    if (!scene.supply.firstFreePadSpot()) {
      scene.messages.show("Clear a space on the loading pad before buying a charging station.");
      return false;
    }
    if (!scene.fixtureSystem.buy(ROBOT_CHARGER_TYPE)) {
      scene.messages.show("The charging station could not be ordered. Check your money and the loading pad.");
      return false;
    }
    scene.messages.show("Charging station delivered to the loading pad. Place it in the backroom.", "#10b981");
    scene.saves.requestAutosave();
    return true;
  }

  recharge(robotId) {
    const { scene } = this;
    if (!this.canManage()) {
      scene.messages.show("Robots can only be recharged this way between shifts.");
      return false;
    }
    if (!scene.fixtures.ofKind("robot_charger").length) {
      scene.messages.show("Place a robot charging station in the backroom first.");
      return false;
    }
    const robot = scene.gameState.robotService.robots.find(({ id }) => id === robotId);
    if (!robot) throw new Error(`Unknown robot: ${robotId}.`);
    scene.gameState.robotService.setBattery(robot.id, 1);
    scene.messages.show(`${robot.name} recharged.`, "#10b981");
    scene.saves.requestAutosave();
    return true;
  }

  setOnShift(robotId, onShift) {
    const { scene } = this;
    if (!this.canManage()) {
      scene.messages.show("Robots can only be set On Shift or Off Shift between shifts.");
      return false;
    }
    const robot = scene.gameState.robotService.robots.find(({ id }) => id === robotId);
    if (!robot) throw new Error(`Unknown robot: ${robotId}.`);
    scene.gameState.robotService.setOnShift(robotId, onShift);
    scene.messages.show(`${robot.name} is ${onShift ? "On Shift" : "Off Shift"}.`);
    scene.saves.requestAutosave();
    return true;
  }

  assemble(build) {
    const { scene } = this;
    const { gameState } = scene;
    if (!this.canManage()) {
      scene.messages.show("Robots can only be assembled between shifts.");
      return null;
    }
    if (!isRobotServiceUnlocked(gameState.reputation.shopLevel)) {
      scene.messages.show("Robot Service is not unlocked yet.");
      return null;
    }
    if (!this.masterComputerPlaced()) {
      scene.messages.show("Place the Master Computer in your shop before assembling robots.");
      return null;
    }
    if (gameState.robotService.robots.length >= gameState.robotService.masterComputerLevel) {
      scene.messages.show("Your Master Computer can't run any more robots. Upgrade it to add another rack.");
      return null;
    }
    const robot = {
      name: String(build.name ?? "").trim(),
      frame: build.frame,
      cell: build.cell,
      boards: (build.boards ?? []).filter(Boolean).map((board) => ({ board })),
    };
    if (!robot.name) {
      scene.messages.show("Give the robot a name before assembling it.");
      return null;
    }
    const problems = buildProblems(robot, ROBOT_PARTS);
    if (robot.boards.some(({ board }) => getRobotPart(board)?.category !== "boards")) {
      problems.push("Only available prefab logic and modifier boards can be fitted.");
    }
    if (!robot.boards.some(({ board }) => ROBOT_PARTS.boards.find((part) => part.id === board)?.kind === "prefab")) {
      problems.push("Fit at least one logic board so the robot knows what work to do.");
    }
    if (!hasEnoughPower(robot, ROBOT_PARTS)) {
      const cell = ROBOT_PARTS.cells.find(({ id }) => id === robot.cell);
      problems.push(`Needs ${powerNeeded(robot, ROBOT_PARTS)} power, but this cell supports only ${cell?.capacity ?? 0}.`);
    }
    if (problems.length) {
      scene.messages.show(problems.join("\n"));
      return null;
    }
    const partIds = [robot.frame, robot.cell, ...robot.boards.map(({ board }) => board)];
    const inventory = gameState.robotService;
    const required = partIds.reduce((counts, id) => ({ ...counts, [id]: (counts[id] ?? 0) + 1 }), {});
    if (Object.entries(required).some(([id, count]) => inventory.partCount(id) < count)) {
      scene.messages.show("The selected build uses parts you don't own anymore. Check your parts list.");
      return null;
    }
    let assembled;
    gameState.batch(() => {
      if (!inventory.consumeParts(partIds)) throw new Error("Robot part inventory changed during assembly.");
      assembled = inventory.addRobot(robot);
    });
    scene.messages.show(`${assembled.name} assembled.`, "#10b981");
    scene.saves.requestAutosave();
    return assembled;
  }

  dismantle(robotId) {
    const { scene } = this;
    if (!this.canManage()) {
      scene.messages.show("Robots can only be dismantled between shifts.");
      return false;
    }
    const { robotService } = scene.gameState;
    const robot = robotService.robots.find(({ id }) => id === robotId);
    if (!robot) return false;
    scene.gameState.batch(() => {
      const removed = robotService.removeRobot(robotId);
      if (!removed) throw new Error(`Robot ${robotId} disappeared during dismantling.`);
      for (const partId of [removed.frame, removed.cell, ...removed.boards.map(({ board }) => board)]) {
        robotService.addPart(partId);
      }
    });
    scene.messages.show(`${robot.name} dismantled. Its parts are back in your inventory.`);
    scene.saves.requestAutosave();
    return true;
  }
}
