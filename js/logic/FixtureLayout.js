// ==========================================
// FILE: FixtureLayout.js
// ==========================================
// The starting layout and rules for fixture footprints, access cells, and validating that a
// proposed layout keeps the shop walkable. Fixture type data lives in data/Fixtures.json.
// See also: FixtureRegistry.js (placed fixture instances).
import fixtureTypes from "../../data/Fixtures.json" with { type: "json" };
import { roundMoney } from "./Money.js";
import { getSlotItemLimit } from "./ShelfSlotStocking.js";
import { getReachableGridCells } from "./Pathfinder.js";
import { PLAYER_BODY_HEIGHT, PLAYER_BODY_WIDTH, PLAYER_CHARACTER_HEIGHT, PLAYER_CHARACTER_WIDTH } from "./Player.js";
import { CUSTOMER_COLLISION_HEIGHT, CUSTOMER_COLLISION_WIDTH } from "./CharacterDimensions.js";
import {
  BACKROOM_GRID_Y, TILE_SIZE, getAuthoredGridSize, zoneAt,
} from "./RoomLayout.js";

// Shelf display slots per tile along each axis.
export const SHELF_VISUAL_SLOTS_PER_TILE = 2;

// Retained so fixture positions saved before the 8-pixel placement grid remain valid.
export const FIXTURE_POSITION_STEP = 1 / 32;
export const FIXTURE_SNAP_STEP = 1 / 8;
// Tiles of a floor square a fixture may cover and still leave it walkable. Customers walk
// square centers, and their collision box clears a square's edge by this much.
const FLOOR_EDGE_ALLOWANCE = 1 / 8;
// Tiles a down-facing fixture may push its back into the wall behind it.
export const BACK_WALL_TUCK = 1 / 2;
// Connect actual standing points to the tile-center paths without treating a whole tile as solid.
const ACCESS_ROUTE_STEP = 4;
const ACCESS_ROUTE_RADIUS = TILE_SIZE * 2;

export function isFixturePosition(value) {
  return Number.isFinite(value) && Number.isInteger(value / FIXTURE_POSITION_STEP);
}

export function snapFixturePosition(value) {
  return Math.round(value / FIXTURE_SNAP_STEP) * FIXTURE_SNAP_STEP;
}

// Placed fixtures are instances ({ id, type, gx, gy }) owned by FixtureRegistry.
export const FIXTURE_TYPES = fixtureTypes;

// A new game's layout: no shelves, so the player buys their first one from the Fixtures tab.
export const STARTING_FIXTURES = [
  { id: "storage_demo_01", type: "locker_single", gx: 1, gy: BACKROOM_GRID_Y + 1 },
  { id: "storage_demo_02", type: "locker_single", gx: 1.5625, gy: BACKROOM_GRID_Y + 1 },
  { id: "trash_can_01", type: "trash_can", gx: 18, gy: 2 },
  { id: "register", type: "register_basic", gx: 13, gy: 3 },
];

// Saves made before fixture types existed (entries without a `type`) are migrated by id.
// Their original 3x2 shelf (fixture_demo_01) was retired; ShopSave turns it into a refund.
const LEGACY_FIXTURE_TYPES = {
  fixture_demo_01: "shelf_universal",
  storage_demo_01: "locker_single",
  storage_demo_02: "locker_single",
  storage_demo_03: "locker_single",
  register: "register_basic",
};

/**
 * Hands-on spaces hold 20 box-size units; legacy slots cap stackSize by stackDepth.
 * @param {number} stackDepth
 * @param {object} item
 * @param {boolean} handsOn
 */
export function getShelfSlotCapacity(stackDepth, item, handsOn = false) {
  if (handsOn) return getSlotItemLimit(item?.boxSize);
  if (!item?.stackSize) return 0;
  return Math.min(item.stackSize, stackDepth);
}

export function getShelfItemFootprint(item, rotated = false, handsOn = false) {
  if (handsOn) return { w: 1, h: 1 };
  return rotated ? { w: item.dimensions.h, h: item.dimensions.w } : { ...item.dimensions };
}

export function getShelfDisplayGrid(fixtureType) {
  return {
    // Shelves whose art shows a different number of sections or tiers say so with
    // `shelfColumns` / `shelfRows`.
    w: fixtureType.shelfColumns ?? fixtureType.w * SHELF_VISUAL_SLOTS_PER_TILE,
    h: fixtureType.shelfRows ?? fixtureType.h * SHELF_VISUAL_SLOTS_PER_TILE,
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
  if (spec.facingFootprints) return { ...spec.facingFootprints[fixtureFacing(placement)] };
  return fixtureRotation(placement) % 2 === 0 ? { w: spec.w, h: spec.h } : { w: spec.h, h: spec.w };
}

/**
 * The fixture's edges in tiles (fractions allowed).
 * @returns {{ left: number, top: number, right: number, bottom: number }}
 */
export function fixtureBounds(placement) {
  const { w, h } = fixtureFootprint(placement);
  return { left: placement.gx, top: placement.gy, right: placement.gx + w, bottom: placement.gy + h };
}

export function fixtureAtWorldPoint(placement, worldX, worldY) {
  const { w, h } = fixtureFootprint(placement);
  return {
    ...placement,
    gx: snapFixturePosition(worldX / TILE_SIZE - w / 2),
    gy: snapFixturePosition(worldY / TILE_SIZE - h / 2),
  };
}

export function fixtureFrontClearance(placement) {
  const isShelf = getFixtureType(placement.type).kind === "shelf";
  if (!isShelf && placement.type !== "locker_single") return null;
  const bounds = fixtureBounds(placement);
  // Shelves keep their existing half-tile standing distance within a full-tile aisle.
  const height = isShelf ? 1 : PLAYER_CHARACTER_HEIGHT / TILE_SIZE;
  const width = isShelf ? 1 : PLAYER_CHARACTER_WIDTH / TILE_SIZE;
  switch (fixtureFacing(placement)) {
    case "down": return { ...bounds, top: bounds.bottom, bottom: bounds.bottom + height };
    case "up": return { ...bounds, bottom: bounds.top, top: bounds.top - height };
    case "left": return { ...bounds, right: bounds.left, left: bounds.left - width };
    default: return { ...bounds, left: bounds.right, right: bounds.right + width };
  }
}

export function rectanglesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function fixturesOverlap(a, b) {
  const first = fixtureBounds(a);
  const second = fixtureBounds(b);
  const firstFront = fixtureFrontClearance(a);
  const secondFront = fixtureFrontClearance(b);
  return rectanglesOverlap(first, second) ||
    Boolean(firstFront && rectanglesOverlap(firstFront, second)) ||
    Boolean(secondFront && rectanglesOverlap(first, secondFront));
}

// The range of floor squares the fixture covers by more than a sliver.
function coveredCellRange(placement) {
  const { left, top, right, bottom } = fixtureBounds(placement);
  return {
    x0: Math.floor(left + FLOOR_EDGE_ALLOWANCE),
    x1: Math.ceil(right - FLOOR_EDGE_ALLOWANCE),
    y0: Math.floor(top + FLOOR_EDGE_ALLOWANCE),
    y1: Math.ceil(bottom - FLOOR_EDGE_ALLOWANCE),
  };
}

/**
 * Floor squares covered by more than the permitted edge overlap.
 * @param {object} placement
 * @returns {{ gx: number, gy: number }[]}
 */
function fixtureCoveredCells(placement) {
  const { x0, x1, y0, y1 } = coveredCellRange(placement);
  const cells = [];
  for (let gy = y0; gy < y1; gy += 1) {
    for (let gx = x0; gx < x1; gx += 1) cells.push({ gx, gy });
  }
  return cells;
}

function accessBody(placement, behind) {
  const isRegister = getFixtureType(placement.type).kind === "register";
  if (isRegister && behind) {
    return {
      left: -PLAYER_BODY_WIDTH / 2,
      right: PLAYER_BODY_WIDTH / 2,
      top: -PLAYER_BODY_HEIGHT,
      bottom: 0,
    };
  }
  if (isRegister || getFixtureType(placement.type).kind === "shelf") {
    return {
      left: -CUSTOMER_COLLISION_WIDTH / 2,
      right: CUSTOMER_COLLISION_WIDTH / 2,
      top: -CUSTOMER_COLLISION_HEIGHT / 2,
      bottom: CUSTOMER_COLLISION_HEIGHT / 2,
    };
  }
  return {
    left: -PLAYER_BODY_WIDTH / 2,
    right: PLAYER_BODY_WIDTH / 2,
    top: -PLAYER_BODY_HEIGHT / 2,
    bottom: PLAYER_BODY_HEIGHT / 2,
  };
}

function accessPositionIsClear(x, y, body, solidBounds, isWalkable) {
  const bounds = {
    left: x + body.left,
    right: x + body.right,
    top: y + body.top,
    bottom: y + body.bottom,
  };
  const x0 = Math.floor(bounds.left / TILE_SIZE);
  const x1 = Math.floor((bounds.right - 0.001) / TILE_SIZE);
  const y0 = Math.floor(bounds.top / TILE_SIZE);
  const y1 = Math.floor((bounds.bottom - 0.001) / TILE_SIZE);
  for (let gy = y0; gy <= y1; gy += 1) {
    for (let gx = x0; gx <= x1; gx += 1) {
      if (!isWalkable(gx, gy)) return false;
    }
  }
  return !solidBounds.some((solid) => rectanglesOverlap(bounds, solid));
}

function accessRoutesConnectToReachableCell(points, body, ignoredPlacement, placements, reachable, isWalkable) {
  const solidBounds = placements
    .filter((other) => other !== ignoredPlacement)
    .map((other) => {
      const bounds = fixtureBounds(other);
      return {
        left: bounds.left * TILE_SIZE,
        right: bounds.right * TILE_SIZE,
        top: bounds.top * TILE_SIZE,
        bottom: bounds.bottom * TILE_SIZE,
      };
    });
  const isClear = (x, y) => accessPositionIsClear(x, y, body, solidBounds, isWalkable);
  const segmentIsClear = (from, to) => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.ceil(distance / ACCESS_ROUTE_STEP);
    for (let index = 0; index <= steps; index += 1) {
      const ratio = steps ? index / steps : 0;
      if (!isClear(from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio)) return false;
    }
    return true;
  };
  const nearestGridCenter = (x, y) => {
    const gx = Math.floor(x / TILE_SIZE);
    const gy = Math.floor(y / TILE_SIZE);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const cell = { gx: gx + offsetX, gy: gy + offsetY };
        const center = { x: (cell.gx + 0.5) * TILE_SIZE, y: (cell.gy + 0.5) * TILE_SIZE };
        if (Math.hypot(center.x - x, center.y - y) > TILE_SIZE * Math.SQRT1_2) continue;
        if (reachable.has(cellKey(cell)) && segmentIsClear({ x, y }, center)) return true;
      }
    }
    return false;
  };
  const key = ({ x, y }) => `${x},${y}`;
  const queue = [];
  const visited = new Set();
  for (const point of points) {
    if (!isClear(point.x, point.y)) continue;
    if (nearestGridCenter(point.x, point.y)) return true;
    const start = {
      x: Math.round(point.x / ACCESS_ROUTE_STEP) * ACCESS_ROUTE_STEP,
      y: Math.round(point.y / ACCESS_ROUTE_STEP) * ACCESS_ROUTE_STEP,
    };
    if (!segmentIsClear(point, start)) continue;
    const startKey = key(start);
    if (visited.has(startKey)) continue;
    visited.add(startKey);
    queue.push({ ...start, distance: 0 });
  }
  if (queue.length === 0) return false;
  const directions = [[ACCESS_ROUTE_STEP, 0], [-ACCESS_ROUTE_STEP, 0], [0, ACCESS_ROUTE_STEP], [0, -ACCESS_ROUTE_STEP]];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (nearestGridCenter(current.x, current.y)) return true;
    if (current.distance + ACCESS_ROUTE_STEP > ACCESS_ROUTE_RADIUS) continue;
    for (const [dx, dy] of directions) {
      const next = { x: current.x + dx, y: current.y + dy };
      const nextKey = key(next);
      if (visited.has(nextKey) || !isClear(next.x, next.y)) continue;
      visited.add(nextKey);
      queue.push({ ...next, distance: current.distance + ACCESS_ROUTE_STEP });
    }
  }
  return false;
}

// Shared paths clear centered staff bodies and the player's lower-body collision.
export function fixtureCells(placement) {
  if (placement.type !== "locker_single") return fixtureCoveredCells(placement);
  const bounds = fixtureBounds(placement);
  const cells = [];
  for (let gy = Math.floor(bounds.top); gy < Math.ceil(bounds.bottom); gy++) {
    for (let gx = Math.floor(bounds.left); gx < Math.ceil(bounds.right); gx++) {
      const x = gx + 0.5;
      const y = gy + 0.5;
      if (rectanglesOverlap(bounds, {
        left: x - PLAYER_BODY_WIDTH / TILE_SIZE / 2, right: x + PLAYER_BODY_WIDTH / TILE_SIZE / 2,
        top: y - PLAYER_BODY_HEIGHT / TILE_SIZE / 2, bottom: y + PLAYER_BODY_HEIGHT / TILE_SIZE,
      })) cells.push({ gx, gy });
    }
  }
  return cells;
}

/**
 * The line of cells a customer or the player stands on to use the fixture: the first clear
 * row in front, one square for each square of the fixture's width.
 * @param {object} placement
 * @param {boolean} [behind] - the line behind instead (the register needs both)
 * @returns {{ gx: number, gy: number }[]}
 */
export function fixtureAccessCells(placement, behind = false) {
  if (placement.type === "locker_single") {
    const spot = fixtureStandingSpot(placement, null);
    const cell = { gx: Math.floor(spot.x / TILE_SIZE), gy: Math.floor(spot.y / TILE_SIZE) };
    const step = fixtureFacingStep(placement);
    const blocked = new Set(fixtureCells(placement).map(cellKey));
    while (blocked.has(cellKey(cell))) {
      cell.gx += step.dx;
      cell.gy += step.dy;
    }
    return [cell];
  }
  const { left, top, right, bottom } = fixtureBounds(placement);
  const { x0, x1, y0, y1 } = coveredCellRange(placement);
  // Squares whose centers lie along the fixture's edge.
  const along = (from, to) => {
    const first = Math.ceil(from - 0.5);
    const cells = Array.from({ length: Math.ceil(to - 0.5) - first }, (_, index) => first + index);
    return cells.length ? cells : [Math.floor((from + to) / 2)];
  };
  switch (fixtureFacing(placement, behind)) {
    case "down": return along(left, right).map((gx) => ({ gx, gy: y1 }));
    case "up": return along(left, right).map((gx) => ({ gx, gy: y0 - 1 }));
    case "left": return along(top, bottom).map((gy) => ({ gx: x0 - 1, gy }));
    default: return along(top, bottom).map((gy) => ({ gx: x1, gy }));
  }
}

/**
 * Where someone using the fixture from this access cell stands (px): half a tile out from
 * the front edge and lined up with the fixture, so a fixture between floor squares doesn't
 * leave shoppers standing back or off to one side.
 * @param {object} placement
 * @param {{ gx: number, gy: number }} cell - a front access cell or register back access cell
 */
export function fixtureStandingSpot(placement, cell) {
  const { left, top, right, bottom } = fixtureBounds(placement);
  if (placement.type === "locker_single") {
    const x = (left + right) * TILE_SIZE / 2;
    const y = (top + bottom) * TILE_SIZE / 2;
    switch (fixtureFacing(placement)) {
      case "down": return { x, y: bottom * TILE_SIZE + PLAYER_CHARACTER_HEIGHT / 2 };
      case "up": return { x, y: top * TILE_SIZE - PLAYER_CHARACTER_HEIGHT / 2 };
      case "left": return { x: left * TILE_SIZE - PLAYER_CHARACTER_WIDTH / 2, y };
      default: return { x: right * TILE_SIZE + PLAYER_CHARACTER_WIDTH / 2, y };
    }
  }
  const frontCells = fixtureAccessCells(placement);
  const frontIndex = frontCells.findIndex(({ gx, gy }) => gx === cell.gx && gy === cell.gy);
  const backCells = fixtureAccessCells(placement, true);
  const backIndex = backCells.findIndex(({ gx, gy }) => gx === cell.gx && gy === cell.gy);
  const behind = frontIndex < 0 && backIndex >= 0;
  const index = behind ? backIndex : frontIndex;
  const x = (index >= 0 ? left + index + 0.5 : cell.gx + 0.5) * TILE_SIZE;
  const y = (index >= 0 ? top + index + 0.5 : cell.gy + 0.5) * TILE_SIZE;
  switch (fixtureFacing(placement, behind)) {
    case "down": return { x, y: (bottom + 0.5) * TILE_SIZE };
    case "up": return { x, y: (top - 0.5) * TILE_SIZE };
    case "left": return { x: (left - 0.5) * TILE_SIZE, y };
    default: return { x: (right + 0.5) * TILE_SIZE, y };
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
 * entrance, no cut-off floor, and room for the register queue. `links` are pairs of cells
 * joined by a door (the shop and the backroom), so walking reaches one from the other.
 * @param {object[]} placements
 * @param {object} options
 * @returns {{ valid: boolean, reason: string, blockedCells?: Set<string>, access?: Map, accessCells?: Map, queueCells?: object[] }}
 */
export function validateFixtureLayout(placements, {
  isWalkable, isWall = () => false, entrance, reservedCells = new Set(), doorwayCells = new Set(),
  occupiedRectangles = [], gridSize = getAuthoredGridSize(), queueSize = 6, requireSalesFloor = true,
  links = [], backroomBounds = null, reservedRectangles = [],
  connectivityCache = null,
}) {
  const invalid = (reason) => ({ valid: false, reason });
  if (!Array.isArray(placements)) return invalid("The fixture layout is invalid.");
  const ids = new Set();
  const blockedCells = new Set();
  const placed = [];
  for (const placement of placements) {
    const spec = getFixtureType(placement?.type);
    if (!spec || typeof placement.id !== "string" || ids.has(placement.id) ||
      !isFixturePosition(placement.gx) || !isFixturePosition(placement.gy) ||
      !isValidFixtureRotation(placement.rotation)) {
      return invalid("The fixture layout is invalid.");
    }
    ids.add(placement.id);
    const bounds = fixtureBounds(placement);
    const front = fixtureFrontClearance(placement);
    const rectangles = front ? [bounds, front] : [bounds];
    const facesDown = fixtureFacing(placement) === "down";
    // Like the wall-cell check below, a down-facing fixture may tuck into the top wall.
    const backroomTop = backroomBounds && backroomBounds.top - (facesDown ? BACK_WALL_TUCK * TILE_SIZE : 0);
    if (backroomBounds && placement.gy >= BACKROOM_GRID_Y &&
      rectangles.some((rect) => rect.left * TILE_SIZE < backroomBounds.left ||
        rect.right * TILE_SIZE > backroomBounds.right || rect.top * TILE_SIZE < backroomTop ||
        rect.bottom * TILE_SIZE > backroomBounds.bottom)) {
      return invalid(facesDown && bounds.top * TILE_SIZE < backroomTop && bounds.left * TILE_SIZE >= backroomBounds.left &&
        bounds.right * TILE_SIZE <= backroomBounds.right
        ? "Too far into the wall. Move it down a little."
        : "Keep the fixture and its standing space inside the backroom.");
    }
    if (rectangles.some((rect) => reservedRectangles.some((reserved) => rectanglesOverlap({
      left: rect.left * TILE_SIZE, right: rect.right * TILE_SIZE,
      top: rect.top * TILE_SIZE, bottom: rect.bottom * TILE_SIZE,
    }, reserved)))) {
      return invalid("Keep entrances and the loading area clear.");
    }
    if (spec.kind === "shelf") {
      for (let gy = Math.floor(front.top); gy < Math.ceil(front.bottom); gy++) {
        for (let gx = Math.floor(front.left); gx < Math.ceil(front.right); gx++) {
          const key = cellKey({ gx, gy });
          if (reservedCells.has(key)) return invalid("Keep entrances and the loading area clear.");
          if (doorwayCells.has(key)) return invalid(`The front of ${spec.name} can't face into a doorway.`);
          if (!isWalkable(gx, gy)) return invalid(`Keep the front of ${spec.name} accessible.`);
        }
      }
    }
    for (const cell of fixtureCoveredCells(placement)) {
      const key = cellKey(cell);
      const intoWall = facesDown && isWall(cell.gx, cell.gy);
      // A down-facing fixture's back may tuck partway into the wall behind it.
      const tucked = intoWall && cell.gy + 1 <= bounds.top + BACK_WALL_TUCK;
      if (!tucked && !isWalkable(cell.gx, cell.gy)) {
        return invalid(intoWall && cell.gy < bounds.top + 1
          ? "Too far into the wall. Move it down a little."
          : "Place fixtures on unlocked floor, away from walls.");
      }
      if (!tucked && requireSalesFloor && spec.kind !== "storage" && !zoneAt(cell.gx, cell.gy)?.salesFloor) {
        return invalid(`The ${spec.name} must go on the sales floor. Only storage goes in the back.`);
      }
      if (reservedCells.has(key)) return invalid("Keep entrances and the loading area clear.");
      if (!tucked && placement.type !== "locker_single") blockedCells.add(key);
    }
    if (placement.type === "locker_single") {
      for (const cell of fixtureCells(placement)) blockedCells.add(cellKey(cell));
    }
    if (placed.some((other) => fixturesOverlap(placement, other))) {
      return invalid(placed.some((other) => rectanglesOverlap(bounds, fixtureBounds(other)))
        ? "Fixtures cannot overlap."
        : "Keep room to stand in front of shelves and lockers.");
    }
    placed.push(placement);
    const left = bounds.left * TILE_SIZE;
    const top = bounds.top * TILE_SIZE;
    const right = bounds.right * TILE_SIZE;
    const bottom = bounds.bottom * TILE_SIZE;
    if (occupiedRectangles.some((rect) =>
      left < rect.right && right > rect.left && top < rect.bottom && bottom > rect.top,
    )) {
      return invalid("Move the player or crate out of the way first.");
    }
  }
  // Customers only support one checkout line for now.
  const registers = placements.filter((placement) => getFixtureType(placement.type).kind === "register");
  if (registers.length !== 1) return invalid("The shop needs exactly one register.");
  const requirements = placements.map((placement) => {
    const isRegister = placement === registers[0];
    const front = fixtureAccessCells(placement);
    return {
      id: placement.id, type: placement.type, placement, isRegister, front,
      back: isRegister ? fixtureAccessCells(placement, true) : [],
    };
  });
  const step = fixtureFacingStep(registers[0]);
  // The caller scopes this cache to a fixed room/layout snapshot. Fractional moves often
  // share the same blocked floor cells, but access can also depend on exact fixture edges.
  const cacheKey = connectivityCache && JSON.stringify([
    [...blockedCells].sort(),
    requirements.map(({ id, type, placement, front, back }) => [
      id, type, placement.gx, placement.gy, fixtureRotation(placement), front, back,
    ]),
    step,
  ]);
  if (connectivityCache?.has(cacheKey)) return connectivityCache.get(cacheKey);
  const remember = (result) => {
    connectivityCache?.set(cacheKey, result);
    return result;
  };
  const canWalk = (gx, gy) => isWalkable(gx, gy) && !blockedCells.has(`${gx},${gy}`);
  const reachable = new Set(getReachableGridCells(entrance, canWalk).map(cellKey));
  for (const [a, b] of links) {
    for (const [from, to] of [[a, b], [b, a]]) {
      if (!reachable.has(cellKey(from)) || reachable.has(cellKey(to)) || !canWalk(to.gx, to.gy)) continue;
      for (const cell of getReachableGridCells(to, canWalk)) reachable.add(cellKey(cell));
    }
  }
  const access = new Map();
  const accessCells = new Map();
  for (const { id, type, placement, isRegister, front, back } of requirements) {
    if ([...front, ...back].some((cell) => doorwayCells.has(cellKey(cell)))) {
      return remember(invalid(`The ${isRegister ? "front and back" : "front"} of ${getFixtureType(type).name} can't face into a doorway.`));
    }
    const bodyFor = (behind) => accessBody(placement, behind);
    const reachableCells = (cells, behind = false) => cells.filter((cell) =>
      accessRoutesConnectToReachableCell(
        doorwayCells.has(cellKey(cell)) ? [] : [fixtureStandingSpot(placement, cell)],
        bodyFor(behind),
        placement,
        placements,
        reachable,
        isWalkable,
      ),
    );
    const usableFront = reachableCells(front);
    const usableBack = isRegister ? reachableCells(back, true) : [];
    if (usableFront.length === 0 || (isRegister && usableBack.length === 0)) {
      return remember(invalid(`Keep the front${isRegister ? " and back" : ""} of ${getFixtureType(type).name} accessible.`));
    }
    access.set(id, usableFront[Math.floor(usableFront.length / 2)]);
    accessCells.set(id, usableFront);
  }
  for (let gy = 0; gy < gridSize.gridH; gy += 1) {
    for (let gx = 0; gx < gridSize.gridW; gx += 1) {
      if (canWalk(gx, gy) && !reachable.has(`${gx},${gy}`)) {
        const samples = [];
        for (let y = (gy + 0.125) * TILE_SIZE; y < (gy + 0.875) * TILE_SIZE; y += ACCESS_ROUTE_STEP * 2) {
          for (let x = (gx + 0.125) * TILE_SIZE; x < (gx + 0.875) * TILE_SIZE; x += ACCESS_ROUTE_STEP * 2) {
            samples.push({ x, y });
          }
        }
        if (!accessRoutesConnectToReachableCell(
          samples,
          accessBody(registers[0], true),
          null,
          placements,
          reachable,
          isWalkable,
        )) return remember(invalid("This placement cuts off part of the shop."));
      }
    }
  }
  const queueStart = access.get(registers[0].id);
  // The line only forms on the register's front side, never curling around beside or behind it.
  // It may pass in front of shelves (a checkout aisle lined with impulse buys); customers don't
  // bump into each other, so shoppers can still reach those shelves.
  const canQueue = (gx, gy) =>
    (gx - queueStart.gx) * step.dx + (gy - queueStart.gy) * step.dy >= 0 && canWalk(gx, gy) &&
    !reservedCells.has(`${gx},${gy}`);
  const queueCells = planRegisterQueue(queueStart, step, entrance, canQueue, canWalk, queueSize);
  if (queueCells.length < queueSize) return remember(invalid("Leave room in front of the register for the customer queue."));
  return remember({
    valid: true, reason: "Click to place. Contents stay on the fixture.",
    blockedCells, access, accessCells, queueCells,
  });
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
