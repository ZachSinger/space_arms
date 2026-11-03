import { getReachableGridCells } from "./Pathfinder.js";
import { TILE_SIZE, getTotalGridSize } from "./RoomLayout.js";

export const FIXTURE_SPECS = [
  { id: "fixture_demo_01", name: "SHELF", kind: "shelf", gx: 7, gy: 2, w: 3, h: 2,
    texture: "shelf_universal_01", displayGrid: { w: 4, h: 2 }, stackDepth: 12 },
  ...[1, 2, 3].map((number) => ({
    id: `storage_demo_0${number}`, name: `LOCKER ${number}`, kind: "storage",
    gx: number, gy: 1, w: 1, h: 2, texture: "locker_single", capacity: 20,
  })),
  { id: "register", name: "REGISTER", kind: "register", gx: 12, gy: 2, w: 2, h: 2,
    texture: "register_01" },
];

export function getFixtureSpec(id) {
  return FIXTURE_SPECS.find((spec) => spec.id === id);
}

export function fixtureCells(placement) {
  const spec = getFixtureSpec(placement.id);
  const cells = [];
  for (let y = 0; y < spec.h; y += 1) {
    for (let x = 0; x < spec.w; x += 1) {
      cells.push({ gx: placement.gx + x, gy: placement.gy + y });
    }
  }
  return cells;
}

export function fixtureAccessCells(placement, behind = false) {
  const spec = getFixtureSpec(placement.id);
  return Array.from({ length: spec.w }, (_, x) => ({
    gx: placement.gx + x,
    gy: behind ? placement.gy - 1 : placement.gy + spec.h,
  }));
}

export function cellKey({ gx, gy }) {
  return `${gx},${gy}`;
}

export function validateFixtureLayout(placements, {
  isWalkable, entrance, reservedCells = new Set(), occupiedRectangles = [],
  gridSize = getTotalGridSize(), queueSize = 6,
}) {
  const invalid = (reason) => ({ valid: false, reason });
  if (!Array.isArray(placements) || placements.length !== FIXTURE_SPECS.length) {
    return invalid("The layout must contain all existing fixtures.");
  }
  const ids = new Set();
  const blockedCells = new Set();
  for (const placement of placements) {
    const spec = getFixtureSpec(placement?.id);
    if (!spec || ids.has(spec.id) || !Number.isInteger(placement.gx) || !Number.isInteger(placement.gy)) {
      return invalid("The fixture layout is invalid.");
    }
    ids.add(spec.id);
    for (const cell of fixtureCells(placement)) {
      const key = cellKey(cell);
      if (!isWalkable(cell.gx, cell.gy)) return invalid("Place fixtures on unlocked floor, away from walls.");
      if (reservedCells.has(key)) return invalid("Keep entrances and the loading area clear.");
      if (blockedCells.has(key)) return invalid("Fixtures cannot overlap.");
      blockedCells.add(key);
    }
    const left = placement.gx * TILE_SIZE;
    const top = placement.gy * TILE_SIZE;
    if (occupiedRectangles.some((rect) =>
      left < rect.right && left + spec.w * TILE_SIZE > rect.left &&
      top < rect.bottom && top + spec.h * TILE_SIZE > rect.top,
    )) {
      return invalid("Move the player or crate out of the way first.");
    }
  }
  const canWalk = (gx, gy) => isWalkable(gx, gy) && !blockedCells.has(`${gx},${gy}`);
  const reachable = new Set(getReachableGridCells(entrance, canWalk).map(cellKey));
  const access = new Map();
  const otherAccessCells = new Set();
  for (const placement of placements) {
    const front = fixtureAccessCells(placement);
    const required = placement.id === "register"
      ? [...front, ...fixtureAccessCells(placement, true)] : front;
    if (required.some((cell) => !reachable.has(cellKey(cell)))) {
      return invalid(`Keep the front${placement.id === "register" ? " and back" : ""} of ${getFixtureSpec(placement.id).name} accessible.`);
    }
    access.set(placement.id, front[Math.floor(front.length / 2)]);
    if (placement.id !== "register") front.forEach((cell) => otherAccessCells.add(cellKey(cell)));
  }
  for (let gy = 0; gy < gridSize.gridH; gy += 1) {
    for (let gx = 0; gx < gridSize.gridW; gx += 1) {
      if (canWalk(gx, gy) && !reachable.has(`${gx},${gy}`)) {
        return invalid("This placement cuts off part of the shop.");
      }
    }
  }
  const queueStart = access.get("register");
  const queueCells = getReachableGridCells(queueStart, (gx, gy) =>
    gy >= queueStart.gy && canWalk(gx, gy) &&
    !reservedCells.has(`${gx},${gy}`) && !otherAccessCells.has(`${gx},${gy}`),
  ).slice(0, queueSize);
  if (queueCells.length < queueSize) return invalid("Leave room in front of the register for the customer queue.");
  return { valid: true, reason: "Click to place. Contents stay on the fixture.", blockedCells, access, queueCells };
}
