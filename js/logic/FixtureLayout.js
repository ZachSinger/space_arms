// ==========================================
// FILE: FixtureLayout.js
// ==========================================
// The starting layout and rules for fixture footprints, access cells, and validating that a
// proposed layout keeps the shop walkable. Fixture type data lives in data/Fixtures.json.
// See also: FixtureRegistry.js (placed fixture instances).
import fixtureTypes from "../../data/Fixtures.json" with { type: "json" };
import { roundMoney } from "./Money.js";
import { getReachableGridCells } from "./Pathfinder.js";
import {
  TILE_SIZE, getTotalGridSize, zoneAt,
} from "./RoomLayout.js";

// Shelf display slots per tile along each axis.
export const SHELF_VISUAL_SLOTS_PER_TILE = 2;

// Placed fixtures are instances ({ id, type, gx, gy }) owned by FixtureRegistry.
export const FIXTURE_TYPES = fixtureTypes;

// A new game's layout: no shelves, so the player buys their first one from the Fixtures tab.
export const STARTING_FIXTURES = [
  { id: "storage_demo_01", type: "locker_single", gx: 1, gy: 1 },
  { id: "storage_demo_02", type: "locker_single", gx: 2, gy: 1 },
  { id: "register", type: "register_basic", gx: 12, gy: 2 },
];

// Saves made before fixture types existed (entries without a `type`) are migrated by id.
// Old saves used fixture_demo_01 for the original 3x2 shelf.
const LEGACY_FIXTURE_TYPES = {
  fixture_demo_01: "shelf_universal",
  storage_demo_01: "locker_single",
  storage_demo_02: "locker_single",
  storage_demo_03: "locker_single",
  register: "register_basic",
};

/**
 * Units of an item that fit in one shelf slot: its stackSize, capped by the shelf's stackDepth.
 * @param {number} stackDepth
 * @param {object} item
 */
export function getShelfSlotCapacity(stackDepth, item) {
  if (!item?.stackSize) return 0;
  return Math.min(item.stackSize, stackDepth);
}

export function getShelfDisplayGrid(fixtureType) {
  return {
    w: fixtureType.w * SHELF_VISUAL_SLOTS_PER_TILE,
    h: fixtureType.h * SHELF_VISUAL_SLOTS_PER_TILE,
  };
}

export function getFixtureType(typeId) {
  return Object.hasOwn(FIXTURE_TYPES, typeId) ? FIXTURE_TYPES[typeId] : undefined;
}

export function getFixtureResaleValue(typeId) {
  const fixture = getFixtureType(typeId);
  if (!fixture) throw new RangeError(`Unknown fixture type: ${typeId}`);
  return roundMoney(fixture.price * 0.5);
}

/**
 * Fill in `type` for entries saved before fixture types existed.
 * @param {object} entry
 */
export function migrateFixtureEntry(entry) {
  if (!entry || typeof entry !== "object" || entry.type !== undefined) return entry;
  if (!Object.hasOwn(LEGACY_FIXTURE_TYPES, entry.id)) return entry;
  return { ...entry, type: LEGACY_FIXTURE_TYPES[entry.id] };
}

// Quarter turns clockwise. Unturned fixtures face down; each turn moves the front one side
// clockwise: down, left, up, right.
export const FIXTURE_FACINGS = Object.freeze(["down", "left", "up", "right"]);
const FACING_STEPS = Object.freeze({
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  up: { dx: 0, dy: -1 },
  right: { dx: 1, dy: 0 },
});

export function isValidFixtureRotation(rotation) {
  return rotation === undefined || (Number.isInteger(rotation) && rotation >= 0 && rotation < 4);
}

export function fixtureRotation(placement) {
  return placement.rotation ?? 0;
}

/**
 * The side customers and the player use: "down", "left", "up", or "right".
 * @param {object} placement
 * @param {boolean} [behind] - the opposite side instead
 */
export function fixtureFacing(placement, behind = false) {
  return FIXTURE_FACINGS[(fixtureRotation(placement) + (behind ? 2 : 0)) % 4];
}

/**
 * Floor footprint in tiles after rotation.
 * @param {object} placement
 * @returns {{ w: number, h: number }}
 */
export function fixtureFootprint(placement) {
  const spec = getFixtureType(placement.type);
  return fixtureRotation(placement) % 2 === 0 ? { w: spec.w, h: spec.h } : { w: spec.h, h: spec.w };
}

export function fixtureCells(placement) {
  const { w, h } = fixtureFootprint(placement);
  const cells = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      cells.push({ gx: placement.gx + x, gy: placement.gy + y });
    }
  }
  return cells;
}

/**
 * The line of cells a customer or the player stands on to use the fixture.
 * @param {object} placement
 * @param {boolean} [behind] - the line behind instead (the register needs both)
 * @returns {{ gx: number, gy: number }[]}
 */
export function fixtureAccessCells(placement, behind = false) {
  const { w, h } = fixtureFootprint(placement);
  const { gx, gy } = placement;
  switch (fixtureFacing(placement, behind)) {
    case "down": return Array.from({ length: w }, (_, x) => ({ gx: gx + x, gy: gy + h }));
    case "up": return Array.from({ length: w }, (_, x) => ({ gx: gx + x, gy: gy - 1 }));
    case "left": return Array.from({ length: h }, (_, y) => ({ gx: gx - 1, gy: gy + y }));
    default: return Array.from({ length: h }, (_, y) => ({ gx: gx + w, gy: gy + y }));
  }
}

/**
 * Distance (px) from a point in front of the fixture to its front edge; Infinity when the
 * point is beside or behind it.
 */
export function fixtureInteractionDistance(placement, { x, y }) {
  const { w, h } = fixtureFootprint(placement);
  const left = placement.gx * TILE_SIZE;
  const top = placement.gy * TILE_SIZE;
  const right = left + w * TILE_SIZE;
  const bottom = top + h * TILE_SIZE;
  // Shared edges belong to the fixture on the right (or below), not both neighbors.
  const alongX = x >= left && x < right;
  const alongY = y >= top && y < bottom;
  switch (fixtureFacing(placement)) {
    case "down": return alongX && y >= bottom ? y - bottom : Infinity;
    case "up": return alongX && y <= top ? top - y : Infinity;
    case "left": return alongY && x <= left ? left - x : Infinity;
    default: return alongY && x >= right ? x - right : Infinity;
  }
}

/**
 * One cell step in the direction the fixture faces (or away from it when behind).
 * @returns {{ dx: number, dy: number }}
 */
export function fixtureFacingStep(placement, behind = false) {
  return FACING_STEPS[fixtureFacing(placement, behind)];
}

export function cellKey({ gx, gy }) {
  return `${gx},${gy}`;
}

/**
 * Check a whole fixture layout: no overlaps, legal zones, every fixture reachable from the
 * entrance, no cut-off floor, and room for the register queue.
 * @param {object[]} placements
 * @param {object} options
 * @returns {{ valid: boolean, reason: string, blockedCells?: Set<string>, access?: Map, queueCells?: object[] }}
 */
export function validateFixtureLayout(placements, {
  isWalkable, entrance, reservedCells = new Set(), doorwayCells = new Set(), occupiedRectangles = [],
  gridSize = getTotalGridSize(), queueSize = 6, requireSalesFloor = true,
}) {
  const invalid = (reason) => ({ valid: false, reason });
  if (!Array.isArray(placements)) return invalid("The fixture layout is invalid.");
  const ids = new Set();
  const blockedCells = new Set();
  for (const placement of placements) {
    const spec = getFixtureType(placement?.type);
    if (!spec || typeof placement.id !== "string" || ids.has(placement.id) ||
      !Number.isInteger(placement.gx) || !Number.isInteger(placement.gy) ||
      !isValidFixtureRotation(placement.rotation)) {
      return invalid("The fixture layout is invalid.");
    }
    ids.add(placement.id);
    for (const cell of fixtureCells(placement)) {
      const key = cellKey(cell);
      if (!isWalkable(cell.gx, cell.gy)) return invalid("Place fixtures on unlocked floor, away from walls.");
      if (requireSalesFloor && spec.kind !== "storage" && !zoneAt(cell.gx, cell.gy)?.salesFloor) {
        return invalid(`The ${spec.name} must go on the sales floor. Only storage goes in the back.`);
      }
      if (reservedCells.has(key)) return invalid("Keep entrances and the loading area clear.");
      if (blockedCells.has(key)) return invalid("Fixtures cannot overlap.");
      blockedCells.add(key);
    }
    const left = placement.gx * TILE_SIZE;
    const top = placement.gy * TILE_SIZE;
    const footprint = fixtureFootprint(placement);
    if (occupiedRectangles.some((rect) =>
      left < rect.right && left + footprint.w * TILE_SIZE > rect.left &&
      top < rect.bottom && top + footprint.h * TILE_SIZE > rect.top,
    )) {
      return invalid("Move the player or crate out of the way first.");
    }
  }
  // Customers only support one checkout line for now.
  const registers = placements.filter((placement) => getFixtureType(placement.type).kind === "register");
  if (registers.length !== 1) return invalid("The shop needs exactly one register.");
  const canWalk = (gx, gy) => isWalkable(gx, gy) && !blockedCells.has(`${gx},${gy}`);
  const reachable = new Set(getReachableGridCells(entrance, canWalk).map(cellKey));
  const access = new Map();
  for (const placement of placements) {
    const isRegister = placement === registers[0];
    const front = fixtureAccessCells(placement);
    const required = isRegister ? [...front, ...fixtureAccessCells(placement, true)] : front;
    if (required.some((cell) => doorwayCells.has(cellKey(cell)))) {
      return invalid(`The ${isRegister ? "front and back" : "front"} of ${getFixtureType(placement.type).name} can't face into a doorway.`);
    }
    if (required.some((cell) => !reachable.has(cellKey(cell)))) {
      return invalid(`Keep the front${isRegister ? " and back" : ""} of ${getFixtureType(placement.type).name} accessible.`);
    }
    access.set(placement.id, front[Math.floor(front.length / 2)]);
  }
  for (let gy = 0; gy < gridSize.gridH; gy += 1) {
    for (let gx = 0; gx < gridSize.gridW; gx += 1) {
      if (canWalk(gx, gy) && !reachable.has(`${gx},${gy}`)) {
        return invalid("This placement cuts off part of the shop.");
      }
    }
  }
  const queueStart = access.get(registers[0].id);
  // The line only forms on the register's front side, never curling around beside or behind it.
  // It may pass in front of shelves (a checkout aisle lined with impulse buys); customers don't
  // bump into each other, so shoppers can still reach those shelves.
  const step = fixtureFacingStep(registers[0]);
  const canQueue = (gx, gy) =>
    (gx - queueStart.gx) * step.dx + (gy - queueStart.gy) * step.dy >= 0 && canWalk(gx, gy) &&
    !reservedCells.has(`${gx},${gy}`);
  const queueCells = planRegisterQueue(queueStart, step, entrance, canQueue, canWalk, queueSize);
  if (queueCells.length < queueSize) return invalid("Leave room in front of the register for the customer queue.");
  return { valid: true, reason: "Click to place. Contents stay on the fixture.", blockedCells, access, queueCells };
}

const ORTHOGONAL_STEPS = [[0, 1], [0, -1], [1, 0], [-1, 0]];

// Steps from each walkable cell to the entrance, walking orthogonally.
function stepsToEntrance(entrance, canWalk) {
  const distances = new Map([[cellKey(entrance), 0]]);
  const cells = [entrance];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    for (const [dx, dy] of ORTHOGONAL_STEPS) {
      const next = { gx: cell.gx + dx, gy: cell.gy + dy };
      const key = cellKey(next);
      if (distances.has(key) || !canWalk(next.gx, next.gy)) continue;
      distances.set(key, distances.get(cellKey(cell)) + 1);
      cells.push(next);
    }
  }
  return distances;
}

/**
 * A single-file line: the first customer at the counter, the next straight behind them, and
 * each later customer one step behind the last, bending toward the front door when the
 * line can't go straight. Each spot touches the one before it.
 * @returns {{ gx: number, gy: number }[]} front of the line first
 */
export function planRegisterQueue(start, step, entrance, canQueue, canWalk, queueSize) {
  if (!canQueue(start.gx, start.gy)) return [];
  const doorSteps = stepsToEntrance(entrance, canWalk);
  const toDoor = (cell) => doorSteps.get(cellKey(cell)) ?? Infinity;
  const line = [start];
  const used = new Set([cellKey(start)]);
  let turned = false;
  while (line.length < queueSize) {
    const last = line.at(-1);
    const previous = line.at(-2);
    const heading = previous ? { dx: last.gx - previous.gx, dy: last.gy - previous.gy } : step;
    const options = ORTHOGONAL_STEPS
      .map(([dx, dy]) => ({ gx: last.gx + dx, gy: last.gy + dy, straight: dx === heading.dx && dy === heading.dy }))
      .filter((cell) => canQueue(cell.gx, cell.gy) && !used.has(cellKey(cell)));
    if (options.length === 0) break;
    // The line runs straight out from the counter until something blocks it, then turns.
    const straight = options.find((cell) => cell.straight);
    let next;
    if (!turned && straight) {
      next = straight;
    } else {
      turned = true;
      // Head toward the door, keeping straight on ties so the line bends as little as possible.
      next = options.reduce((best, cell) => {
        const difference = toDoor(cell) - toDoor(best);
        if (difference < 0 || (difference === 0 && cell.straight)) return cell;
        return best;
      });
      // Already at the door: keep the line going straight rather than doubling back.
      if (toDoor(next) >= toDoor(last) && straight) next = straight;
    }
    line.push({ gx: next.gx, gy: next.gy });
    used.add(cellKey(next));
  }
  // A dead end (the line boxed in) still fills the remaining spots from the nearest open floor.
  if (line.length < queueSize) {
    for (const cell of getReachableGridCells(start, canQueue)) {
      if (line.length >= queueSize) break;
      if (!used.has(cellKey(cell))) {
        line.push(cell);
        used.add(cellKey(cell));
      }
    }
  }
  return line;
}
