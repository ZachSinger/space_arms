import { Slice } from "../Slice.js";

function copyRobot(robot) {
  return {
    ...robot,
    boards: robot.boards.map((board) => ({ ...board })),
  };
}

export class RobotService extends Slice {
  constructor() {
    super();
    this.ownedParts = {};
    this.robots = [];
    this.nextRobotId = 1;
    this.masterComputerLevel = 0;
  }

  partCount(partId) {
    return this.ownedParts[partId] ?? 0;
  }

  addPart(partId) {
    this.ownedParts = { ...this.ownedParts, [partId]: this.partCount(partId) + 1 };
    this.changed();
  }

  consumeParts(partIds) {
    const required = partIds.reduce((counts, partId) => ({
      ...counts,
      [partId]: (counts[partId] ?? 0) + 1,
    }), {});
    if (Object.entries(required).some(([partId, count]) => this.partCount(partId) < count)) return false;
    const next = { ...this.ownedParts };
    for (const [partId, count] of Object.entries(required)) {
      next[partId] -= count;
      if (next[partId] === 0) delete next[partId];
    }
    this.ownedParts = next;
    this.changed();
    return true;
  }

  addRobot(robot) {
    const saved = { ...copyRobot(robot), id: `robot-${this.nextRobotId}` };
    this.nextRobotId += 1;
    this.robots = [...this.robots, saved];
    this.changed();
    return saved;
  }

  setMasterComputerLevel(level) {
    if (!Number.isInteger(level) || level < this.masterComputerLevel || level > 5) {
      throw new RangeError("Invalid Master Computer level.");
    }
    if (level === this.masterComputerLevel) return;
    this.masterComputerLevel = level;
    this.changed();
  }

  removeRobot(robotId) {
    const robot = this.robots.find(({ id }) => id === robotId);
    if (!robot) return null;
    this.robots = this.robots.filter(({ id }) => id !== robotId);
    this.changed();
    return copyRobot(robot);
  }

  setBattery(robotId, battery) {
    if (!Number.isFinite(battery) || battery < 0 || battery > 1) throw new RangeError("Invalid robot charge.");
    const robot = this.robots.find(({ id }) => id === robotId);
    if (!robot) throw new Error(`Unknown robot: ${robotId}.`);
    robot.battery = battery;
    this.changed();
  }

  setOnShift(robotId, onShift) {
    if (typeof onShift !== "boolean") throw new TypeError("Robot shift status must be true or false.");
    const robot = this.robots.find(({ id }) => id === robotId);
    if (!robot) throw new Error(`Unknown robot: ${robotId}.`);
    robot.onShift = onShift;
    this.changed();
  }

  adopt(next) {
    this.ownedParts = { ...next.ownedParts };
    this.robots = next.robots.map(copyRobot);
    this.nextRobotId = next.nextRobotId;
    this.masterComputerLevel = next.masterComputerLevel;
  }

  toSave() {
    return {
      robotService: {
        ownedParts: { ...this.ownedParts },
        robots: this.robots.map(copyRobot),
        nextRobotId: this.nextRobotId,
        masterComputerLevel: this.masterComputerLevel,
      },
    };
  }

  static fromSave(data) {
    const state = new RobotService();
    if (data.robotService) {
      state.ownedParts = { ...data.robotService.ownedParts };
      state.robots = data.robotService.robots.map(copyRobot);
      state.nextRobotId = data.robotService.nextRobotId;
      state.masterComputerLevel = data.robotService.masterComputerLevel ??
        Math.min(5, data.robotService.robots.length);
    }
    return state;
  }
}
