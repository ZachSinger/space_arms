import service from "../../data/RobotService.json" with { type: "json" };
import robotData from "../../data/RobotPrograms.json" with { type: "json" };

export const ROBOT_SERVICE_LEVEL = service.serviceLevel;
export const ROBOT_PARTS = robotData.parts;
export const ROBOT_STANDARD_DRAIN = robotData.settings.standardDrain;
export const MASTER_COMPUTER_UPGRADE_PRICES = Object.freeze([...service.terminal.upgradePrices]);
export const PREBUILT_ROBOTS = Object.freeze(service.terminal.robots.map((robot) =>
  Object.freeze({ ...robot, boards: Object.freeze([...robot.boards]) })));

const PART_GROUPS = Object.freeze([
  { id: "frames", label: "Frames" },
  { id: "cells", label: "Power cells" },
  { id: "boards", label: "Boards" },
]);

const entries = PART_GROUPS.flatMap(({ id, label }) => {
  const listed = service.parts[id];
  const source = ROBOT_PARTS[id];
  return Object.entries(listed).map(([partId, offer]) => {
    const part = source.find(({ id: sourceId }) => sourceId === partId);
    if (!part || id === "boards" && part.kind === "custom") {
      throw new Error(`Robot Service catalog references an unavailable ${label.toLowerCase()} part: ${partId}.`);
    }
    return Object.freeze({ ...part, category: id, categoryLabel: label, ...offer });
  });
});

export const ROBOT_PART_CATALOG = Object.freeze(entries);
export const ROBOT_PART_GROUPS = PART_GROUPS;

export function getRobotPart(partId) {
  return ROBOT_PART_CATALOG.find(({ id }) => id === partId) ?? null;
}

export function isRobotServiceUnlocked(shopLevel) {
  return shopLevel >= ROBOT_SERVICE_LEVEL;
}

export function isRobotPartUnlocked(partId, shopLevel) {
  const part = getRobotPart(partId);
  return Boolean(part && isRobotServiceUnlocked(shopLevel) && shopLevel >= part.level);
}
