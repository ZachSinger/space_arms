// ==========================================
// FILE: FixtureLayout.js
// ==========================================
// The starting layout and rules for fixture footprints, access cells, and validating that a
// proposed layout keeps the shop walkable. Fixture type data lives in data/Fixtures.json.
// See also: FixtureRegistry.js (placed fixture instances).
import fixtureTypes from "../../data/Fixtures.json" with { type: "json" };
import { roundMoney } from "./Money.js";
import { getSlotItemLimit } from "./ShelfSlotStocking.js";
import { createFloorReachability, FLOOR_NODE_STEP } from "../world/Navigation.js";
import { PLAYER_BODY_HEIGHT, PLAYER_BODY_WIDTH, PLAYER_CHARACTER_HEIGHT } from "./Player.js";
import {
  CHARACTER_ART_HEIGHT, CHARACTER_ART_WIDTH, CHARACTER_FEET_DROP,
  CUSTOMER_COLLISION_HEIGHT, CUSTOMER_COLLISION_WIDTH,
} from "./CharacterDimensions.js";
import {
  BACKROOM_GRID_Y, TILE_SIZE, getAuthoredGridSize, zoneAt,
} from "./RoomLayout.js";

// Shelf display slots per tile along each axis.
export const SHELF_VISUAL_SLOTS_PER_TILE = 2;

// Retained so fixture positions saved before the 8-pixel placement grid remain valid.
export const FIXTURE_POSITION_STEP = 1 / 32;
export const FIXTURE_SNAP_STEP = 1 / 8;
// Tiles of a floor square a fixture may cover and still count it as free floor for the
// register line, which is planned in whole squares.
const FLOOR_EDGE_ALLOWANCE = 1 / 8;
// Tiles a down-facing fixture may push its back into the wall behind it.
export const BACK_WALL_TUCK = 1 / 2;
// Tiles below the wall's bottom edge where a down-facing shelf's feet stop when pushed back.
export const SHELF_FEET_BELOW_WALL = 1 / 4;
// Tiles of floor kept clear in front of a fixture: the narrowest gap a walker fits through.
// Shelf art never reaches outside the shelf's own space, so facing shelves this close apart
// still never hide each other.
export const FIXTURE_FRONT_CLEARANCE = 1 / 2;
// Upright shelf backs can share projected artwork, but their floor bases need this depth.
const SHELF_BACK_TO_BACK_DEPTH = 1 / 4;
// Tiles of an upright shelf's feet that people bump into: half the player character's height.
export const SHELF_SOLID_HEIGHT = PLAYER_CHARACTER_HEIGHT / 2 / TILE_SIZE;
// px, the feet box every walker (customers, staff, the player) must fit through.
const WALKING_BODY_WIDTH = Math.max(PLAYER_BODY_WIDTH, CUSTOMER_COLLISION_WIDTH);
const WALKING_BODY_HEIGHT = Math.max(PLAYER_BODY_HEIGHT, CUSTOMER_COLLISION_HEIGHT);
// How far the first customer may overlap the front of the register art, in pixels.
export const REGISTER_FRONT_OVERLAP = 10;
// A player pressed against a fixture can stop a hair inside its front edge (physics rounding).
const FRONT_EDGE_TOLERANCE_PX = 0.5;
const REGISTER_QUEUE_SPACING = 52;
const MIN_REGISTER_QUEUE_SEPARATION = 32;

export function isFixturePosition(value) {
  return Number.isFinite(value) && Number.isInteger(value / FIXTURE_POSITION_STEP);
}

export function snapFixturePosition(value) {
  return Math.round(value / FIXTURE_SNAP_STEP) * FIXTURE_SNAP_STEP;
}

// Placed fixtures are instances ({ id, type, gx, gy }) owned by FixtureRegistry.
export const FIXTURE_TYPES = fixtureTypes;

// The bare shop: one trash can and one register. New games start from the Starting Template
// (data/StartingTemplate.json) instead; tests start from this layout (tests/support/fixed-start.js).
export const BASIC_FIXTURES = [
  { id: "trash_can_01", type: "trash_can", gx: 18, gy: 2 },
  { id: "register", type: "register_basic", gx: 13, gy: 3 },
];

// Saves made before fixture types existed (entries without a `type`) are migrated by id.
// Their original 3x2 shelf (fixture_demo_01) was retired; ShopSave turns it into a refund.
const LEGACY_FIXTURE_TYPES = {
  fixture_demo_01: "shelf_universal",
  register: "register_basic",
};

/**
 * Each shelf space holds one item kind, up to 20 box-size units.
 * @param {object} item
 */
export function getShelfSlotCapacity(item) {
  return getSlotItemLimit(item?.boxSize);
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
 * Floor area of the fixture's picture in tiles after rotation. The solid part may be smaller;
 * see fixtureBounds.
 * @param {object} placement
 * @returns {{ w: number, h: number }}
 */
export function fixtureFootprint(placement) {
  const spec = getFixtureType(placement.type);
  if (spec.facingFootprints) return { ...spec.facingFootprints[fixtureFacing(placement)] };
  return fixtureRotation(placement) % 2 === 0 ? { w: spec.w, h: spec.h } : { w: spec.h, h: spec.w };
}

/**
 * Tiles of see-through picture on each side of the visible fixture for its facing
 * (`artInsets` in Fixtures.json). That margin isn't solid, so the visible edge is the real edge.
 * @param {object} placement
 * @returns {{ left: number, top: number, right: number, bottom: number }}
 */
export function fixtureArtInset(placement) {
  const inset = getFixtureType(placement.type).artInsets?.[fixtureFacing(placement)];
  return { left: 0, top: 0, right: 0, bottom: 0, ...inset };
}

/**
 * The fixture's body box in tiles: its picture minus the transparent margin.
 * `gx`/`gy` place the picture's top-left corner.
 * @returns {{ left: number, top: number, right: number, bottom: number }}
 */
export function fixtureBounds(placement) {
  const { w, h } = fixtureFootprint(placement);
  const inset = fixtureArtInset(placement);
  return {
    left: placement.gx + inset.left, top: placement.gy + inset.top,
    right: placement.gx + w - inset.right, bottom: placement.gy + h - inset.bottom,
  };
}

/**
 * The part people actually bump into, in tiles. An upright shelf (facing up or down) is only
 * solid around its feet, up to half a person's height. Decorations use their catalog's
 * solid foot height. Anyone further up walks behind the art; placement and walking routes
 * still use the full body box (fixtureBounds).
 */
export function fixtureSolidBounds(placement) {
  const bounds = fixtureBounds(placement);
  const spec = getFixtureType(placement.type);
  if (spec.kind === "decoration") {
    return { ...bounds, top: Math.max(bounds.top, bounds.bottom - spec.solidHeight) };
  }
  const facing = fixtureFacing(placement);
  if (spec.kind !== "shelf" || (facing !== "up" && facing !== "down")) return bounds;
  return { ...bounds, top: Math.max(bounds.top, bounds.bottom - SHELF_SOLID_HEIGHT) };
}

export function fixtureAtWorldPoint(placement, worldX, worldY) {
  const { w, h } = fixtureFootprint(placement);
  return {
    ...placement,
    gx: snapFixturePosition(worldX / TILE_SIZE - w / 2),
    gy: snapFixturePosition(worldY / TILE_SIZE - h / 2),
  };
}

/**
 * The fixture's projection box in tiles, extending from the body box in its facing direction.
 * @param {object} placement
 */
export function fixtureFrontClearance(placement, behind = false) {
  const bounds = fixtureBounds(placement);
  switch (fixtureFacing(placement, behind)) {
    case "down": return { ...bounds, top: bounds.bottom, bottom: bounds.bottom + FIXTURE_FRONT_CLEARANCE };
    case "up": return { ...bounds, bottom: bounds.top, top: bounds.top - FIXTURE_FRONT_CLEARANCE };
    case "left": return { ...bounds, right: bounds.left, left: bounds.left - FIXTURE_FRONT_CLEARANCE };
    default: return { ...bounds, left: bounds.right, right: bounds.right + FIXTURE_FRONT_CLEARANCE };
  }
}

export function fixtureProjectionBoxes(placement) {
  return getFixtureType(placement.type).kind === "register"
    ? [fixtureFrontClearance(placement), fixtureFrontClearance(placement, true)]
    : [fixtureFrontClearance(placement)];
}

export function rectanglesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function fixturesOverlap(a, b) {
  const first = fixtureBounds(a);
  const second = fixtureBounds(b);
  return (rectanglesOverlap(first, second) && !shelfBacksFit(a, b, first, second)) ||
    fixtureProjectionBoxes(a).some((projection) => rectanglesOverlap(projection, second)) ||
    fixtureProjectionBoxes(b).some((projection) => rectanglesOverlap(first, projection));
}

function shelfBacksFit(a, b, first, second) {
  if (getFixtureType(a.type).kind !== "shelf" || getFixtureType(b.type).kind !== "shelf") return false;
  const down = fixtureFacing(a) === "down" ? first : fixtureFacing(b) === "down" ? second : null;
  const up = fixtureFacing(a) === "up" ? first : fixtureFacing(b) === "up" ? second : null;
  if (!down || !up || down.bottom < up.bottom) return false;
  // Unlike spun art, both upright pictures rise above their feet. Only outward-facing
  // backs share that height; fronts and all other fixture pairs keep their full body box.
  const base = (bounds) => ({ ...bounds, top: Math.max(bounds.top, bounds.bottom - SHELF_BACK_TO_BACK_DEPTH) });
  return !rectanglesOverlap(base(down), base(up));
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

function fixturePixelBounds(placement) {
  const { left, top, right, bottom } = fixtureBounds(placement);
  return { left: left * TILE_SIZE, top: top * TILE_SIZE, right: right * TILE_SIZE, bottom: bottom * TILE_SIZE };
}

// Shared paths clear centered staff bodies and the player's lower-body collision.
export function fixtureCells(placement) {
  return fixtureCoveredCells(placement);
}

/**
 * The line of cells a customer or the player stands on to use the fixture: the first clear
 * row in front, one square for each square of the fixture's width.
 * @param {object} placement
 * @param {boolean} [behind] - the line behind instead (the register needs both)
 * @returns {{ gx: number, gy: number }[]}
 */
export function fixtureAccessCells(placement, behind = false) {
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
 * Where someone using the fixture from this access cell stands (px): centered in the projection box
 * and lined up with the fixture, so a fixture between floor squares doesn't
 * leave shoppers standing back or off to one side.
 * @param {object} placement
 * @param {{ gx: number, gy: number }} cell - a front access cell or register back access cell
 */
export function fixtureStandingSpot(placement, cell) {
  const { left, top, right, bottom } = fixtureBounds(placement);
  const frontCells = fixtureAccessCells(placement);
  const frontIndex = frontCells.findIndex(({ gx, gy }) => gx === cell.gx && gy === cell.gy);
  const backCells = fixtureAccessCells(placement, true);
  const backIndex = backCells.findIndex(({ gx, gy }) => gx === cell.gx && gy === cell.gy);
  const behind = frontIndex < 0 && backIndex >= 0;
  const index = behind ? backIndex : frontIndex;
  const feetOffset = behind && getFixtureType(placement.type).kind === "register" ? PLAYER_BODY_HEIGHT / 2 : 0;
  const along = (from, to) => from + Math.min(index + 0.5, to - from - Math.min(0.5, (to - from) / 2));
  const x = (index >= 0 ? along(left, right) : cell.gx + 0.5) * TILE_SIZE;
  const y = (index >= 0 ? along(top, bottom) : cell.gy + 0.5) * TILE_SIZE + feetOffset;
  const out = FIXTURE_FRONT_CLEARANCE / 2;
  switch (fixtureFacing(placement, behind)) {
    case "down": return { x, y: (bottom + out) * TILE_SIZE + feetOffset };
    case "up": return { x, y: (top - out) * TILE_SIZE + feetOffset };
    case "left": return { x: (left - out) * TILE_SIZE, y };
    default: return { x: (right + out) * TILE_SIZE, y };
  }
}

/**
 * Distance (px) from a point in front of the fixture to its front edge; Infinity when the
 * point is beside or behind it.
 */
export function fixtureInteractionDistance(placement, { x, y }) {
  const bounds = fixtureBounds(placement);
  const left = bounds.left * TILE_SIZE;
  const top = bounds.top * TILE_SIZE;
  const right = bounds.right * TILE_SIZE;
  const bottom = bounds.bottom * TILE_SIZE;
  // Shared edges belong to the fixture on the right (or below), not both neighbors.
  const alongX = x >= left && x < right;
  const alongY = y >= top && y < bottom;
  // Walking into the front can leave the feet a rounding sliver inside the edge; that's touching.
  const gap = {
    down: alongX ? y - bottom : NaN,
    up: alongX ? top - y : NaN,
    left: alongY ? left - x : NaN,
    right: alongY ? x - right : NaN,
  }[fixtureFacing(placement)];
  return gap >= -FRONT_EDGE_TOLERANCE_PX ? Math.max(0, gap) : Infinity;
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
 * Reachability is checked at 8px precision with a walking feet box, so any gap a shopper fits
 * through counts. Every fixture uses its body box as its solid walking obstacle.
 * @param {object[]} placements
 * @param {object} options
 * @returns {{ valid: boolean, reason: string, blockedCells?: Set<string>, access?: Map, accessCells?: Map, queueCells?: object[], queuePoints?: object[] }}
 */
export function validateFixtureLayout(placements, {
  isWalkable, isWall = () => false, entrance, reservedCells = new Set(), doorwayCells = new Set(),
  occupiedRectangles = [], gridSize = getAuthoredGridSize(), queueSize = 6, requireSalesFloor = true,
  links = [], backroomBounds = null, reservedRectangles = [], doorwayClearanceRectangles = [],
  fixtureReservedCells = reservedCells,
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
    // Art drawn for one facing only (the hovercart charger) can't be turned.
    if (spec.fixedFacing && fixtureRotation(placement) !== 0) return invalid("The fixture layout is invalid.");
    ids.add(placement.id);
    const bounds = fixtureBounds(placement);
    const projections = fixtureProjectionBoxes(placement);
    const rectangles = [bounds, ...projections];
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
    const pixelRectangles = rectangles.map((rect) => ({
      left: rect.left * TILE_SIZE, right: rect.right * TILE_SIZE,
      top: rect.top * TILE_SIZE, bottom: rect.bottom * TILE_SIZE,
    }));
    const hitReserved = reservedRectangles.find((reserved) =>
      pixelRectangles.some((rect) => rectanglesOverlap(rect, reserved)));
    if (hitReserved?.reason) return invalid(hitReserved.reason);
    if (hitReserved || doorwayClearanceRectangles.some((door) => rectanglesOverlap(pixelRectangles[0], door))) {
      return invalid("Keep entrances and the loading area clear.");
    }
    for (const [index, projection] of projections.entries()) {
      const side = index === 0 ? "front" : "back";
      for (let gy = Math.floor(projection.top); gy < Math.ceil(projection.bottom); gy++) {
        for (let gx = Math.floor(projection.left); gx < Math.ceil(projection.right); gx++) {
          const key = cellKey({ gx, gy });
          if (fixtureReservedCells.has(key)) return invalid("Keep entrances and the loading area clear.");
          if (doorwayCells.has(key)) return invalid(`The ${side} of ${spec.name} can't face into a doorway.`);
          if (!isWalkable(gx, gy)) return invalid(`Keep the front${spec.kind === "register" ? " and back" : ""} of ${spec.name} accessible.`);
        }
      }
    }
    for (const cell of fixtureCoveredCells(placement)) {
      const key = cellKey(cell);
      const intoWall = facesDown && isWall(cell.gx, cell.gy);
      // A down-facing fixture's back may tuck partway into the wall behind it.
      // Shelves are measured by their feet instead, so every shelf against the wall lines up.
      const tucked = intoWall && (spec.kind === "shelf"
        ? cell.gy + 1 <= bounds.bottom - SHELF_FEET_BELOW_WALL
        : cell.gy + 1 <= bounds.top + BACK_WALL_TUCK);
      if (!tucked && !isWalkable(cell.gx, cell.gy)) {
        return invalid(intoWall && cell.gy < bounds.top + 1
          ? "Too far into the wall. Move it down a little."
          : "Place fixtures on unlocked floor, away from walls.");
      }
      if (!tucked && requireSalesFloor && !spec.anyRoom && !zoneAt(cell.gx, cell.gy)?.salesFloor) {
        return invalid(`The ${spec.name} must go on the sales floor.`);
      }
      if (fixtureReservedCells.has(key)) return invalid("Keep entrances and the loading area clear.");
      if (!tucked) blockedCells.add(key);
    }
    if (placed.some((other) => fixturesOverlap(placement, other))) {
      return invalid(placed.some((other) => rectanglesOverlap(bounds, fixtureBounds(other)))
        ? "Fixtures cannot overlap."
        : "Keep room to stand at fixtures.");
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
  // Each register runs its own checkout line.
  const registers = placements.filter((placement) => getFixtureType(placement.type).kind === "register");
  if (registers.length === 0) return invalid("The shop needs a register.");
  const registerIds = new Set(registers.map((placement) => placement.id));
  const requirements = placements.map((placement) => {
    const isRegister = registerIds.has(placement.id);
    const front = fixtureAccessCells(placement);
    return {
      id: placement.id, type: placement.type, placement, isRegister, front,
      back: isRegister ? fixtureAccessCells(placement, true) : [],
    };
  });
  const canWalk = (gx, gy) => isWalkable(gx, gy) && !blockedCells.has(`${gx},${gy}`);
  // Everyone walks on the same size of feet box (customers, staff, and the player).
  const reachableFloor = (solids) => {
    const floor = createFloorReachability({
      isWalkable, solids,
      body: { width: WALKING_BODY_WIDTH, height: WALKING_BODY_HEIGHT },
      gridSize,
    });
    floor.floodFromCell(entrance);
    for (let changed = true; changed;) {
      changed = false;
      for (const [a, b] of links) {
        for (const [from, to] of [[a, b], [b, a]]) {
          if (!floor.reachesCell(from) || floor.reachesCell(to)) continue;
          floor.floodFromCell(to);
          changed ||= floor.reachesCell(to);
        }
      }
    }
    return floor;
  };
  const floor = reachableFloor(placements.map(fixturePixelBounds));
  // Otherwise whatever is through the door gets the blame.
  if (links.some((pair) => pair.some((cell) => isWalkable(cell.gx, cell.gy) && !floor.reachesCell(cell)))) {
    return invalid("Keep a path open to the backroom door.");
  }
  const access = new Map();
  const accessCells = new Map();
  const backAccess = new Map();
  for (const { id, type, placement, isRegister, front, back } of requirements) {
    if ([...front, ...back].some((cell) => doorwayCells.has(cellKey(cell)))) {
      return invalid(`The ${isRegister ? "front and back" : "front"} of ${getFixtureType(type).name} can't face into a doorway.`);
    }
    const reachableCells = (cells, behind = false) => cells.filter((cell) =>
      !doorwayCells.has(cellKey(cell)) &&
      floor.reachesSpot(fixtureStandingSpot(placement, cell), accessBody(placement, behind)),
    );
    const usableFront = reachableCells(front);
    const usableBack = isRegister ? reachableCells(back, true) : [];
    if (usableFront.length === 0 || (isRegister && usableBack.length === 0)) {
      return invalid(`Keep the front${isRegister ? " and back" : ""} of ${getFixtureType(type).name} accessible.`);
    }
    access.set(id, usableFront[Math.floor(usableFront.length / 2)]);
    accessCells.set(id, usableFront);
    if (isRegister) backAccess.set(id, usableBack[Math.floor(usableBack.length / 2)]);
  }
  if (floor.hasCutOffFloor()) return invalid("This placement cuts off part of the shop.");

  // One checkout line per register. Earlier registers' lines reserve their floor so the
  // next register's line can't be planned through them.
  const queueFloorReserved = new Set(reservedCells);
  const toWorld = ({ gx, gy }) => ({ x: (gx + 0.5) * TILE_SIZE, y: (gy + 0.5) * TILE_SIZE });
  const planQueueFor = (register) => {
    const queueStart = access.get(register.id);
    const step = fixtureFacingStep(register);
    // Prefer a line in front; in tight rooms it can turn beside, but never behind, the counter.
    // It may pass in front of shelves because customers don't block each other.
    const queueFloor = (gx, gy) => canWalk(gx, gy) && !queueFloorReserved.has(`${gx},${gy}`);
    const canQueue = (gx, gy) => queueFloor(gx, gy) &&
      (gx - queueStart.gx) * step.dx + (gy - queueStart.gy) * step.dy >= 0;
    const isConnectedQueue = (cells) => cells.length === queueSize && cells.every((cell, index) => index === 0 ||
      Math.abs(cell.gx - cells[index - 1].gx) + Math.abs(cell.gy - cells[index - 1].gy) === 1);
    const bounds = fixtureBounds(register);
    const backEdge = step.dx ? (step.dx < 0 ? bounds.right : bounds.left) :
      (step.dy < 0 ? bounds.bottom : bounds.top);
    const isBesideOrInFront = (gx, gy) =>
      (step.dx ? (gx + 0.5 - backEdge) * step.dx : (gy + 0.5 - backEdge) * step.dy) >= 0;
    const registerBounds = fixturePixelBounds(register);
    const registerBody = {
      width: registerBounds.right - registerBounds.left, height: registerBounds.bottom - registerBounds.top,
      center: { x: (registerBounds.left + registerBounds.right) / 2, y: (registerBounds.top + registerBounds.bottom) / 2 },
    };
    const customerBody = accessBody(register, false);
    let queueReachability;
    let queuePoints;
    const acceptPoints = (points, clearRegister = false) => {
      if (points.length !== queueSize || points.some((point, index) =>
        queueFloorReserved.has(`${Math.floor(point.x / TILE_SIZE)},${Math.floor(point.y / TILE_SIZE)}`) ||
        points.slice(0, index).some((other) =>
          Math.hypot(point.x - other.x, point.y - other.y) < MIN_REGISTER_QUEUE_SEPARATION) ||
        (clearRegister && rectanglesOverlap({
          left: point.x + customerBody.left, right: point.x + customerBody.right,
          top: point.y + customerBody.top, bottom: point.y + customerBody.bottom,
        }, registerBounds)))) return false;
      const reach = getQueueReachability();
      if (points.some((point) => !reach.reachesSpot(point, customerBody))) return false;
      queuePoints = points;
      return true;
    };
    function getQueueReachability() {
      if (!queueReachability) {
        const solids = placements.map((placement) => {
          const solid = fixturePixelBounds(placement);
          if (placement === register) {
            if (step.dx < 0) solid.left += REGISTER_FRONT_OVERLAP;
            else if (step.dx > 0) solid.right -= REGISTER_FRONT_OVERLAP;
            else if (step.dy < 0) solid.top += REGISTER_FRONT_OVERLAP;
            else solid.bottom -= REGISTER_FRONT_OVERLAP;
          }
          return solid;
        });
        queueReachability = reachableFloor(solids);
      }
      return queueReachability;
    }
    const acceptCells = (cells) => acceptPoints(positionRegisterQueue(cells.map(toWorld), registerBody, step));
    let queueCells = planRegisterQueue(queueStart, step, entrance, canQueue, canWalk, queueSize, acceptCells);
    if (!isConnectedQueue(queueCells)) {
      const canQueueBeside = (gx, gy) => queueFloor(gx, gy) && isBesideOrInFront(gx, gy);
      const beside = planRegisterQueue(queueStart, step, entrance, canQueueBeside, canWalk, queueSize, acceptCells);
      if (isConnectedQueue(beside)) queueCells = beside;
    }
    if (!isConnectedQueue(queueCells)) {
      const spot = fixtureStandingSpot(register, queueStart);
      const start = { gx: Math.floor(spot.x / TILE_SIZE), gy: Math.floor(spot.y / TILE_SIZE) };
      const startKey = cellKey(start);
      if (isWalkable(start.gx, start.gy) && !queueFloorReserved.has(startKey)) {
        const canQueueFromSpot = (gx, gy) => `${gx},${gy}` === startKey ||
          (queueFloor(gx, gy) && isBesideOrInFront(gx, gy));
        const accept = (cells) => {
          const path = [spot, ...cells.slice(1).map(toWorld)];
          return acceptPoints(spreadRegisterQueue(path, queueSize), true);
        };
        const fromSpot = planRegisterQueue(start, step, entrance, canQueueFromSpot, canWalk, queueSize, accept);
        if (isConnectedQueue(fromSpot)) queueCells = fromSpot;
      }
    }
    if (!isConnectedQueue(queueCells)) {
      // Whole floor squares are too coarse when the counter sits between them: trace the line
      // over the real open floor instead.
      const traced = traceRegisterQueue({
        spot: fixtureStandingSpot(register, queueStart), step, backEdge: backEdge * TILE_SIZE,
        reach: getQueueReachability(), customerBody, registerBounds,
        reservedCells: queueFloorReserved, queueSize,
        doorSteps: stepsToEntrance(entrance, isWalkable), accept: (points) => acceptPoints(points, true),
      });
      if (traced) {
        queueCells = traced.map(({ x, y }) => ({ gx: Math.floor(x / TILE_SIZE), gy: Math.floor(y / TILE_SIZE) }));
      } else {
        return null;
      }
    }
    return { queueCells, queuePoints };
  };

  const queuePointsById = new Map();
  let firstQueue = null;
  for (const register of registers) {
    const queue = planQueueFor(register);
    if (!queue) {
      return invalid("Leave room in front of each register for its customer queue.");
    }
    queuePointsById.set(register.id, queue.queuePoints);
    firstQueue ??= queue;
    for (const cell of queue.queueCells) queueFloorReserved.add(cellKey(cell));
    for (const point of queue.queuePoints) {
      queueFloorReserved.add(`${Math.floor(point.x / TILE_SIZE)},${Math.floor(point.y / TILE_SIZE)}`);
    }
  }
  return {
    valid: true, reason: "Click to place. Contents stay on the fixture.",
    blockedCells, access, accessCells, backAccess, queuePointsById,
    queueCells: firstQueue.queueCells, queuePoints: firstQueue.queuePoints,
  };
}

const ORTHOGONAL_STEPS = [[0, 1], [0, -1], [1, 0], [-1, 0]];

function spreadRegisterQueue(path, count) {
  if (path.length === 0) return [];
  const placed = [path[0]];
  const segmentLength = (i) => Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
  let segment = 0;
  let along = 0;
  while (placed.length < count) {
    along += REGISTER_QUEUE_SPACING;
    while (segment < path.length - 1 && along > segmentLength(segment)) {
      along -= segmentLength(segment);
      segment += 1;
    }
    if (segment >= path.length - 1) break;
    const t = along / segmentLength(segment);
    const a = path[segment];
    const b = path[segment + 1];
    placed.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return placed;
}

/**
 * A line traced over open floor in small steps, for when whole floor squares can't fit one.
 * Starts at the counter, never goes behind it, and prefers a straight line, then one bending
 * toward the front door. Returns the accepted spots (front first) or null.
 */
function traceRegisterQueue({
  spot, step, backEdge, reach, customerBody, registerBounds, reservedCells, queueSize, doorSteps, accept,
}) {
  const node = FLOOR_NODE_STEP;
  const depth = Math.ceil((queueSize - 1) * REGISTER_QUEUE_SPACING / node);
  const canStand = (x, y) =>
    (step.dx ? (x - backEdge) * step.dx : (y - backEdge) * step.dy) >= 0 &&
    !reservedCells.has(`${Math.floor(x / TILE_SIZE)},${Math.floor(y / TILE_SIZE)}`) &&
    !rectanglesOverlap({
      left: x + customerBody.left, right: x + customerBody.right,
      top: y + customerBody.top, bottom: y + customerBody.bottom,
    }, registerBounds) &&
    reach.reachesSpot({ x, y }, customerBody);
  const sx = Math.round(spot.x / node);
  const sy = Math.round(spot.y / node);
  const starts = [[sx, sy], [sx + step.dx, sy + step.dy], [sx + 1, sy], [sx - 1, sy], [sx, sy + 1], [sx, sy - 1]];
  const start = starts.find(([nx, ny]) => canStand(nx * node, ny * node));
  if (!start) return null;
  // Out from the counter first, then sideways, then back.
  const moves = [[step.dx, step.dy], [step.dy, step.dx], [-step.dy, -step.dx], [-step.dx, -step.dy]];
  const parents = new Map([[`${start[0]},${start[1]}`, null]]);
  let layer = [start];
  for (let d = 0; d < depth && layer.length; d += 1) {
    const next = [];
    for (const [nx, ny] of layer) {
      for (const [mx, my] of moves) {
        const key = `${nx + mx},${ny + my}`;
        if (parents.has(key) || !canStand((nx + mx) * node, (ny + my) * node)) continue;
        parents.set(key, `${nx},${ny}`);
        next.push([nx + mx, ny + my]);
      }
    }
    layer = next;
  }
  const toDoor = ([nx, ny]) =>
    doorSteps.get(`${Math.floor(nx * node / TILE_SIZE)},${Math.floor(ny * node / TILE_SIZE)}`) ?? Infinity;
  const reachOut = ([nx, ny]) => Math.round(Math.hypot(nx * node - spot.x, ny * node - spot.y) / node);
  const ends = layer.sort((a, b) => (reachOut(b) - reachOut(a)) || (toDoor(a) - toDoor(b))).slice(0, 32);
  for (const end of ends) {
    const path = [];
    for (let key = `${end[0]},${end[1]}`; key; key = parents.get(key)) {
      const [nx, ny] = key.split(",").map(Number);
      path.unshift({ x: nx * node, y: ny * node });
    }
    const points = spreadRegisterQueue([spot, ...path], queueSize);
    if (accept(points)) return points;
  }
  return null;
}

export function positionRegisterQueue(points, bounds, { dx, dy }) {
  if (points.length === 0) return points;
  const reachX = bounds.width / 2 + CHARACTER_ART_WIDTH / 2 - REGISTER_FRONT_OVERLAP;
  const reachY = bounds.height / 2 + CHARACTER_ART_HEIGHT / 2 - REGISTER_FRONT_OVERLAP;
  const front = {
    x: bounds.center.x + dx * reachX,
    y: bounds.center.y + dy * reachY + CHARACTER_FEET_DROP,
  };
  const shift = (front.x - points[0].x) * dx + (front.y - points[0].y) * dy;
  if (shift >= 0) return points;
  let straight = true;
  const path = [front, ...points.slice(1).map((point, offset) => {
    const index = offset + 1;
    straight = straight && point.x === points[0].x + dx * index * TILE_SIZE &&
      point.y === points[0].y + dy * index * TILE_SIZE;
    if (!straight) return point;
    return dx !== 0 ? { x: point.x, y: front.y } : { x: front.x, y: point.y };
  })];
  const placed = spreadRegisterQueue(path, points.length);
  return placed.concat(points.slice(placed.length));
}

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
export function planRegisterQueue(start, step, entrance, canQueue, canWalk, queueSize, accept = () => true) {
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
  if (line.length === queueSize && accept(line)) return line;

  // If the preferred turn dead-ends, try the other connected turns before giving up.
  const search = (path, visited, hasTurned) => {
    if (path.length === queueSize) return accept(path) ? [...path] : null;
    const last = path.at(-1);
    const previous = path.at(-2);
    const heading = previous ? { dx: last.gx - previous.gx, dy: last.gy - previous.gy } : step;
    const options = ORTHOGONAL_STEPS
      .map(([dx, dy]) => ({ gx: last.gx + dx, gy: last.gy + dy, straight: dx === heading.dx && dy === heading.dy }))
      .filter((cell) => canQueue(cell.gx, cell.gy) && !visited.has(cellKey(cell)))
      .sort((a, b) => {
        const straight = Number(b.straight) - Number(a.straight);
        return (!hasTurned && straight) || (toDoor(a) - toDoor(b)) || straight;
      });
    for (const option of options) {
      const next = { gx: option.gx, gy: option.gy };
      const key = cellKey(next);
      visited.add(key);
      path.push(next);
      const found = search(path, visited, hasTurned || !option.straight);
      if (found) return found;
      path.pop();
      visited.delete(key);
    }
    return null;
  };
  return search([start], new Set([cellKey(start)]), false) ?? [];
}
