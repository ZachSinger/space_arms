// ==========================================
// FILE: FixtureLayout.js
// ==========================================
// The fixture type catalog, the starting layout, and layout rules: fixture footprints,
// access cells, and validation that a proposed layout keeps the shop walkable.
// See also: FixtureRegistry.js (placed fixture instances).
import { getReachableGridCells } from "./Pathfinder.js";
import { TILE_SIZE, getTotalGridSize, zoneAt } from "./RoomLayout.js";

// Shelf display slots per tile along each axis.
export const SHELF_VISUAL_SLOTS_PER_TILE = 2;

// The fixture catalog: what each *type* of fixture is. Placed fixtures are instances
// ({ id, type, gx, gy }) owned by FixtureRegistry. Prices are in credits.
export const FIXTURE_TYPES = {
  shelf_starter_2x1: { id: "shelf_starter_2x1", name: "COMPACT SHELF", kind: "shelf", w: 2, h: 1,
    texture: "shelf_starter_2x1", stackDepth: 10,
    price: 300, licenseId: "lic_fixture_basics" },
  shelf_universal: { id: "shelf_universal", name: "SHELF", kind: "shelf", w: 3, h: 2,
    texture: "shelf_universal_01", stackDepth: 10,
    price: 300, licenseId: "lic_fixture_basics" },
  locker_single: { id: "locker_single", name: "LOCKER", kind: "storage", w: 1, h: 2,
    texture: "locker_single", capacity: 20, price: 180, licenseId: "lic_fixture_basics" },
  register_basic: { id: "register_basic", name: "REGISTER", kind: "register", w: 2, h: 2,
    texture: "register_01", price: 500, licenseId: "lic_fixture_basics" },
};

// A new game's layout. These instance ids predate fixture types, so saves made before
// types existed (entries without a `type`) are migrated through this list.
export const STARTING_FIXTURES = [
  { id: "fixture_demo_01", type: "shelf_starter_2x1", gx: 7, gy: 2 },
  { id: "storage_demo_01", type: "locker_single", gx: 1, gy: 1 },
  { id: "storage_demo_02", type: "locker_single", gx: 2, gy: 1 },
  { id: "storage_demo_03", type: "locker_single", gx: 3, gy: 1 },
  { id: "register", type: "register_basic", gx: 12, gy: 2 },
];

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

/**
 * Fill in `type` for entries saved before fixture types existed.
 * @param {object} entry
 */
export function migrateFixtureEntry(entry) {
  if (!entry || typeof entry !== "object" || entry.type !== undefined) return entry;
  const legacy = STARTING_FIXTURES.find((fixture) => fixture.id === entry.id);
  if (!legacy) return entry;
  // Old saves used this id for the original 3x2 shelf; keep its larger grid intact.
  const type = legacy.id === "fixture_demo_01" ? "shelf_universal" : legacy.type;
  return { ...entry, type };
}

export function fixtureCells(placement) {
  const spec = getFixtureType(placement.type);
  const cells = [];
  for (let y = 0; y < spec.h; y += 1) {
    for (let x = 0; x < spec.w; x += 1) {
      cells.push({ gx: placement.gx + x, gy: placement.gy + y });
    }
  }
  return cells;
}

/**
 * The row of cells a customer or the player stands on to use the fixture.
 * @param {object} placement
 * @param {boolean} [behind] - the row behind instead (the register needs both)
 * @returns {{ gx: number, gy: number }[]}
 */
export function fixtureAccessCells(placement, behind = false) {
  const spec = getFixtureType(placement.type);
  return Array.from({ length: spec.w }, (_, x) => ({
    gx: placement.gx + x,
    gy: behind ? placement.gy - 1 : placement.gy + spec.h,
  }));
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
  isWalkable, entrance, reservedCells = new Set(), occupiedRectangles = [],
  gridSize = getTotalGridSize(), queueSize = 6, requireSalesFloor = true,
}) {
  const invalid = (reason) => ({ valid: false, reason });
  if (!Array.isArray(placements)) return invalid("The fixture layout is invalid.");
  const ids = new Set();
  const blockedCells = new Set();
  for (const placement of placements) {
    const spec = getFixtureType(placement?.type);
    if (!spec || typeof placement.id !== "string" || ids.has(placement.id) ||
      !Number.isInteger(placement.gx) || !Number.isInteger(placement.gy)) {
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
    if (occupiedRectangles.some((rect) =>
      left < rect.right && left + spec.w * TILE_SIZE > rect.left &&
      top < rect.bottom && top + spec.h * TILE_SIZE > rect.top,
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
  const otherAccessCells = new Set();
  for (const placement of placements) {
    const isRegister = placement === registers[0];
    const front = fixtureAccessCells(placement);
    const required = isRegister ? [...front, ...fixtureAccessCells(placement, true)] : front;
    if (required.some((cell) => !reachable.has(cellKey(cell)))) {
      return invalid(`Keep the front${isRegister ? " and back" : ""} of ${getFixtureType(placement.type).name} accessible.`);
    }
    access.set(placement.id, front[Math.floor(front.length / 2)]);
    if (!isRegister) front.forEach((cell) => otherAccessCells.add(cellKey(cell)));
  }
  for (let gy = 0; gy < gridSize.gridH; gy += 1) {
    for (let gx = 0; gx < gridSize.gridW; gx += 1) {
      if (canWalk(gx, gy) && !reachable.has(`${gx},${gy}`)) {
        return invalid("This placement cuts off part of the shop.");
      }
    }
  }
  const queueStart = access.get(registers[0].id);
  const queueCells = getReachableGridCells(queueStart, (gx, gy) =>
    gy >= queueStart.gy && canWalk(gx, gy) &&
    !reservedCells.has(`${gx},${gy}`) && !otherAccessCells.has(`${gx},${gy}`),
  ).slice(0, queueSize);
  if (queueCells.length < queueSize) return invalid("Leave room in front of the register for the customer queue.");
  return { valid: true, reason: "Click to place. Contents stay on the fixture.", blockedCells, access, queueCells };
}
