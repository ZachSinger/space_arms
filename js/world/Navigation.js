// ==========================================
// FILE: Navigation.js
// ==========================================
// Pixel-scale A* guides character movement around actual collision boundaries. Grid BFS
// helpers remain for fixture-layout reachability checks, where all moves cost the same.
import { loadTuning } from "../core/Tuning.js";
import navigationTuning from "../../data/tuning/navigation.json" with { type: "json" };
import { TILE_SIZE } from "../logic/RoomLayout.js";

export const NAVIGATION_TUNING = loadTuning("navigation", navigationTuning);

// Orthogonal moves first, so slice(0, 4) gives 4-directional flood fill.
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const PIXEL_DIRECTIONS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(item) {
    let index = this.items.length;
    this.items.push(item);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].priority <= item.priority) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        const child = right < this.items.length &&
          this.items[right].priority < this.items[left].priority ? right : left;
        if (this.items[child].priority >= last.priority) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
    }
    return first;
  }

  get length() {
    return this.items.length;
  }
}

function octileDistance(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

/**
 * Route between world positions on a fine navigation grid, then remove waypoints that can
 * be safely skipped. `isSegmentClear` must include both body clearance and room walkability.
 * @param {{x: number, y: number}} start
 * @param {{x: number, y: number}} goal
 * @param {{
 *   isWalkable: (x: number, y: number) => boolean,
 *   isSegmentClear: (from: {x: number, y: number}, to: {x: number, y: number}) => boolean,
 *   step?: number,
 *   connectorRadius?: number,
 *   maxNodes?: number,
 * }} options
 * @returns {{x: number, y: number}[] | null} smoothed waypoints, or null if unreachable
 */
export function findFreeWalkPath(start, goal, {
  isWalkable,
  isSegmentClear,
  step = NAVIGATION_TUNING.walkStepPx,
  connectorRadius = NAVIGATION_TUNING.connectorRadiusCells,
  maxNodes = NAVIGATION_TUNING.maxPathNodes,
}) {
  if (isSegmentClear(start, goal)) return [];

  const findConnector = (point, requireClearSegment = true) => {
    const centerX = Math.round(point.x / step);
    const centerY = Math.round(point.y / step);
    for (let radius = 0; radius <= connectorRadius; radius += 1) {
      let closest = null;
      let closestDistance = Infinity;
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = (centerX + dx) * step;
          const y = (centerY + dy) * step;
          const candidate = { x, y };
          if (!isWalkable(x, y) || (requireClearSegment && !isSegmentClear(point, candidate))) {
            continue;
          }
          const distance = Math.hypot(x - point.x, y - point.y);
          if (distance < closestDistance) {
            closest = { x: centerX + dx, y: centerY + dy };
            closestDistance = distance;
          }
        }
      }
      if (closest) return closest;
    }
    return null;
  };

  // Real bodies are slightly smaller than the planning clearance, so a nudged character can
  // stand inside a fixture's margin. Every segment out of it then fails; step to the nearest
  // open node instead of reporting the character as trapped.
  const startNode = findConnector(start) ?? findConnector(start, false);
  const goalNode = findConnector(goal);
  if (!startNode || !goalNode) return null;
  if (startNode.x === goalNode.x && startNode.y === goalNode.y) {
    return isSegmentClear(start, goal)
      ? []
      : [{ x: startNode.x * step, y: startNode.y * step }];
  }

  const keyOf = (x, y) => `${x},${y}`;
  const startKey = keyOf(startNode.x, startNode.y);
  const goalKey = keyOf(goalNode.x, goalNode.y);
  const frontier = new MinHeap();
  const cameFrom = new Map();
  const costs = new Map([[startKey, 0]]);
  const closed = new Set();
  frontier.push({
    x: startNode.x, y: startNode.y, key: startKey,
    priority: octileDistance(startNode.x, startNode.y, goalNode.x, goalNode.y),
  });

  let visited = 0;
  while (frontier.length > 0 && visited < maxNodes) {
    const current = frontier.pop();
    if (closed.has(current.key)) continue;
    closed.add(current.key);
    if (current.key === goalKey) break;
    visited += 1;

    const currentWorld = { x: current.x * step, y: current.y * step };
    for (const [dx, dy, multiplier] of PIXEL_DIRECTIONS) {
      const x = current.x + dx;
      const y = current.y + dy;
      const key = keyOf(x, y);
      if (closed.has(key)) continue;
      const nextWorld = { x: x * step, y: y * step };
      if (!isWalkable(nextWorld.x, nextWorld.y) ||
          !isSegmentClear(currentWorld, nextWorld)) continue;

      const nextCost = costs.get(current.key) + step * multiplier;
      if (nextCost >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, nextCost);
      cameFrom.set(key, current.key);
      frontier.push({
        x, y, key,
        priority: nextCost + step * octileDistance(x, y, goalNode.x, goalNode.y),
      });
    }
  }
  if (!closed.has(goalKey)) return null;

  const nodes = [];
  let key = goalKey;
  while (key !== startKey) {
    const [x, y] = key.split(",").map(Number);
    nodes.push({ x: x * step, y: y * step });
    key = cameFrom.get(key);
    if (!key) return null;
  }
  nodes.reverse();

  const route = [start, { x: startNode.x * step, y: startNode.y * step }, ...nodes, goal];
  const smoothed = [];
  let index = 0;
  while (index < route.length - 1) {
    let next = route.length - 1;
    while (next > index + 1 && !isSegmentClear(route[index], route[next])) next -= 1;
    smoothed.push(route[next]);
    index = next;
  }
  const last = smoothed[smoothed.length - 1];
  if (last && last.x === goal.x && last.y === goal.y) {
    smoothed.pop();
  }
  return smoothed;
}

/**
 * Flood-fill (4-directional) every walkable cell connected to start.
 * @param {{gx: number, gy: number}} start
 * @param {(gx: number, gy: number) => boolean} isWalkable
 * @param {number} maxCells
 */
export function getReachableGridCells(start, isWalkable, maxCells = NAVIGATION_TUNING.maxReachableGridCells) {
  if (!isWalkable(start.gx, start.gy)) return [];
  const cells = [start];
  const visited = new Set([`${start.gx},${start.gy}`]);
  for (let index = 0; index < cells.length && cells.length < maxCells; index += 1) {
    const current = cells[index];
    for (const [dx, dy] of DIRECTIONS.slice(0, 4)) {
      const gx = current.gx + dx;
      const gy = current.gy + dy;
      const key = `${gx},${gy}`;
      if (visited.has(key) || !isWalkable(gx, gy)) continue;
      visited.add(key);
      cells.push({ gx, gy });
    }
  }
  return cells;
}

/**
 * Shortest path between grid cells. The start cell is never checked for walkability:
 * the agent is trusted to already be standing somewhere valid.
 * @param {{gx: number, gy: number}} start
 * @param {{gx: number, gy: number}} goal
 * @param {(gx: number, gy: number) => boolean} isWalkable
 * @param {number} maxSteps - safety cap on BFS iterations
 * @returns {{gx: number, gy: number}[] | null} waypoints excluding start, including goal;
 *   null if unreachable
 */
export function findGridPath(start, goal, isWalkable, maxSteps = NAVIGATION_TUNING.maxGridPathSteps) {
  const goalKey = `${goal.gx},${goal.gy}`;
  if (!isWalkable(goal.gx, goal.gy)) return null;
  if (`${start.gx},${start.gy}` === goalKey) return [];

  const cameFrom = new Map();
  const visited = new Set([`${start.gx},${start.gy}`]);
  const queue = [start];
  let steps = 0;

  while (queue.length > 0) {
    steps += 1;
    if (steps > maxSteps) return null; // safety valve against runaway searches

    const current = queue.shift();
    const currentKey = `${current.gx},${current.gy}`;
    if (currentKey === goalKey) {
      return reconstructPath(cameFrom, current);
    }

    for (const [dx, dy] of DIRECTIONS) {
      const nx = current.gx + dx;
      const ny = current.gy + dy;
      const key = `${nx},${ny}`;
      if (visited.has(key) || !isWalkable(nx, ny)) continue;

      // Diagonals need both orthogonal neighbors clear, or paths clip through solid corners.
      if (dx !== 0 && dy !== 0) {
        const orthogonalsClear =
          isWalkable(current.gx + dx, current.gy) && isWalkable(current.gx, current.gy + dy);
        if (!orthogonalsClear) continue;
      }

      visited.add(key);
      cameFrom.set(key, currentKey);
      queue.push({ gx: nx, gy: ny });
    }
  }

  return null; // no path found
}

function reconstructPath(cameFrom, goalNode) {
  const path = [goalNode];
  let key = `${goalNode.gx},${goalNode.gy}`;

  while (cameFrom.has(key)) {
    key = cameFrom.get(key);
    const [gx, gy] = key.split(",").map(Number);
    path.unshift({ gx, gy });
  }

  path.shift(); // drop the start cell -- the caller is already standing there
  return path;
}

function segmentIntersectsRectangle(from, to, rectangle) {
  const epsilon = 0.001;
  const left = rectangle.left + epsilon;
  const right = rectangle.right - epsilon;
  const top = rectangle.top + epsilon;
  const bottom = rectangle.bottom - epsilon;
  let minimum = 0;
  let maximum = 1;
  const clip = (origin, delta, low, high) => {
    if (Math.abs(delta) < epsilon) return origin > low && origin < high;
    const first = (low - origin) / delta;
    const last = (high - origin) / delta;
    minimum = Math.max(minimum, Math.min(first, last));
    maximum = Math.min(maximum, Math.max(first, last));
    return minimum < maximum;
  };
  return clip(from.x, to.x - from.x, left, right) &&
    clip(from.y, to.y - from.y, top, bottom);
}

/**
 * Routes characters around the shop and between areas through their paired portals.
 * @param {{
 *   room: { isWalkable: (gx: number, gy: number) => boolean, wallGroup: { getChildren: () => object[] } },
 *   areas: { crossing: (fromY: number, toY: number) => { near: {x:number,y:number}, far: {x:number,y:number} } | null },
 *   obstacleGroup: { getChildren: () => object[] },
 *   fixtures: { registers: () => object[] },
 *   getStoreDoorBlocker: () => object | null,
 *   getRegisterFacing: (register: object) => string,
 *   registerFrontOverlap: number,
 *   defaultBodySize: { width: number, height: number },
 * }} dependencies
 */
export class Navigation {
  constructor({
    room, areas, obstacleGroup, fixtures, getStoreDoorBlocker,
    getRegisterFacing, registerFrontOverlap, defaultBodySize,
  }) {
    this.room = room;
    this.areas = areas;
    this.obstacleGroup = obstacleGroup;
    this.fixtures = fixtures;
    this.getStoreDoorBlocker = getStoreDoorBlocker;
    this.getRegisterFacing = getRegisterFacing;
    this.registerFrontOverlap = registerFrontOverlap;
    this.defaultBodySize = defaultBodySize;
    this.store = Object.freeze({
      findPath: (...args) => this.findPath(...args),
    });
  }

  getNavigationObstacles(bodySize = this.defaultBodySize) {
    const halfW = bodySize.width / 2;
    const halfH = bodySize.height / 2;
    const solids = [...this.obstacleGroup.getChildren(), ...this.room.wallGroup.getChildren()];
    const storeDoorBlocker = this.getStoreDoorBlocker();
    const obstacles = solids.flatMap((solid) => {
      if (!solid.body || (solid === storeDoorBlocker
        ? !bodySize.avoidStoreDoor
        : solid.body.enable === false)) return [];
      const { body } = solid;
      return [{
        left: body.x - halfW,
        right: body.x + body.width + halfW,
        top: body.y - halfH,
        bottom: body.y + body.height + halfH,
      }];
    });
    for (const register of this.fixtures.registers()) {
      const registerBody = register.sprite?.body;
      if (!registerBody) continue;
      const bounds = {
        left: registerBody.x - halfW,
        right: registerBody.x + registerBody.width + halfW,
        top: registerBody.y - halfH,
        bottom: registerBody.y + registerBody.height + halfH,
      };
      switch (this.getRegisterFacing(register)) {
        case "down": bounds.bottom -= this.registerFrontOverlap; break;
        case "up": bounds.top += this.registerFrontOverlap; break;
        case "left": bounds.left += this.registerFrontOverlap; break;
        case "right": bounds.right -= this.registerFrontOverlap; break;
      }
      obstacles.push(bounds);
    }
    return obstacles;
  }

  isNavigationSegmentClear(from, to, obstacles) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.ceil(distance / NAVIGATION_TUNING.walkStepPx);
    for (let index = 0; index <= steps; index += 1) {
      const ratio = steps ? index / steps : 0;
      const x = from.x + (to.x - from.x) * ratio;
      const y = from.y + (to.y - from.y) * ratio;
      if (!this.room.isWalkable(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE))) return false;
    }
    return obstacles.every((rectangle) => !segmentIntersectsRectangle(from, to, rectangle));
  }

  isStraightWalkClear(fromX, fromY, toX, toY, bodySize) {
    const obstacles = this.getNavigationObstacles(bodySize);
    return this.isNavigationSegmentClear({ x: fromX, y: fromY }, { x: toX, y: toY }, obstacles);
  }

  findPath(fromX, fromY, toX, toY, bodySize) {
    const crossing = this.areas?.crossing(fromY, toY);
    if (crossing) {
      const { near, far } = crossing;
      const toDoor = this.findAreaPath(fromX, fromY, near.x, near.y, bodySize);
      const fromDoor = toDoor && this.findAreaPath(far.x, far.y, toX, toY, bodySize);
      if (!fromDoor) return null;
      return [...toDoor, { x: near.x, y: near.y, teleportTo: { x: far.x, y: far.y } }, ...fromDoor];
    }
    return this.findAreaPath(fromX, fromY, toX, toY, bodySize);
  }

  findAreaPath(fromX, fromY, toX, toY, bodySize) {
    const obstacles = this.getNavigationObstacles(bodySize);
    return findFreeWalkPath(
      { x: fromX, y: fromY },
      { x: toX, y: toY },
      {
        isWalkable: (x, y) =>
          this.room.isWalkable(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)) &&
          obstacles.every((rectangle) =>
            x <= rectangle.left || x >= rectangle.right || y <= rectangle.top || y >= rectangle.bottom),
        isSegmentClear: (from, to) => this.isNavigationSegmentClear(from, to, obstacles),
      },
    );
  }
}

export const FLOOR_NODE_STEP = NAVIGATION_TUNING.walkStepPx;

// Reused between checks; the placement overlay runs thousands of them while scanning.
let buffers = null;

function nextBuffers(size) {
  if (!buffers || buffers.size !== size || buffers.generation >= 0xfffffff0) {
    buffers = {
      size,
      generation: 0,
      blocked: new Uint32Array(size),
      checked: new Uint32Array(size),
      open: new Uint8Array(size),
      visited: new Uint32Array(size),
      queue: new Int32Array(size),
    };
  }
  buffers.generation += 1;
  return buffers;
}

function rectanglesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Body-center positions a body of the given size can stand on and walk between, moving in
 * walk-step-sized increments from the starting points. Stricter than real routing (no diagonal steps), so
 * anything it reaches characters can reach too.
 * @param {{
 *   isWalkable: (gx: number, gy: number) => boolean,
 *   solids: Array<{ left: number, right: number, top: number, bottom: number }>, // px
 *   body: { width: number, height: number }, // px
 *   gridSize: { gridW: number, gridH: number },
 * }} options
 */
export function createFloorReachability({ isWalkable, solids, body, gridSize }) {
  const step = FLOOR_NODE_STEP;
  const halfW = body.width / 2;
  const halfH = body.height / 2;
  const columns = gridSize.gridW * TILE_SIZE / step + 1;
  const rows = gridSize.gridH * TILE_SIZE / step + 1;
  const state = nextBuffers(columns * rows);
  const { generation, blocked, checked, open, visited, queue } = state;

  const tileWalkable = new Int8Array(gridSize.gridW * gridSize.gridH).fill(-1);
  const isTileWalkable = (gx, gy) => {
    if (gx < 0 || gy < 0 || gx >= gridSize.gridW || gy >= gridSize.gridH) return false;
    const index = gy * gridSize.gridW + gx;
    if (tileWalkable[index] < 0) tileWalkable[index] = isWalkable(gx, gy) ? 1 : 0;
    return tileWalkable[index] === 1;
  };
  const onFloor = (rect) => {
    const x1 = Math.floor((rect.right - 0.001) / TILE_SIZE);
    const y1 = Math.floor((rect.bottom - 0.001) / TILE_SIZE);
    for (let gy = Math.floor(rect.top / TILE_SIZE); gy <= y1; gy += 1) {
      for (let gx = Math.floor(rect.left / TILE_SIZE); gx <= x1; gx += 1) {
        if (!isTileWalkable(gx, gy)) return false;
      }
    }
    return true;
  };
  const isClear = (rect) => onFloor(rect) && !solids.some((solid) => rectanglesOverlap(rect, solid));

  // Nodes whose body would overlap a solid (touching is fine, as in real movement).
  for (const solid of solids) {
    const x0 = Math.max(0, Math.floor((solid.left - halfW) / step) + 1);
    const x1 = Math.min(columns - 1, Math.ceil((solid.right + halfW) / step) - 1);
    const y0 = Math.max(0, Math.floor((solid.top - halfH) / step) + 1);
    const y1 = Math.min(rows - 1, Math.ceil((solid.bottom + halfH) / step) - 1);
    for (let ny = y0; ny <= y1; ny += 1) {
      for (let nx = x0; nx <= x1; nx += 1) blocked[ny * columns + nx] = generation;
    }
  }

  const bodyAt = (x, y) => ({ left: x - halfW, right: x + halfW, top: y - halfH, bottom: y + halfH });
  const isOpenNode = (nx, ny) => {
    if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) return false;
    const index = ny * columns + nx;
    if (checked[index] !== generation) {
      checked[index] = generation;
      open[index] = blocked[index] !== generation && onFloor(bodyAt(nx * step, ny * step)) ? 1 : 0;
    }
    return open[index] === 1;
  };
  const isReachedNode = (nx, ny) =>
    nx >= 0 && ny >= 0 && nx < columns && ny < rows && visited[ny * columns + nx] === generation;

  let queueLength = 0;
  const flood = (nx, ny) => {
    if (!isOpenNode(nx, ny) || isReachedNode(nx, ny)) return;
    let head = queueLength;
    visited[ny * columns + nx] = generation;
    queue[queueLength++] = ny * columns + nx;
    while (head < queueLength) {
      const index = queue[head++];
      const cx = index % columns;
      const cy = (index - cx) / columns;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = cx + dx;
        const y = cy + dy;
        if (!isOpenNode(x, y) || isReachedNode(x, y)) continue;
        visited[y * columns + x] = generation;
        queue[queueLength++] = y * columns + x;
      }
    }
  };
  const cellNodes = ({ gx, gy }) => {
    const nodes = [];
    const per = TILE_SIZE / step;
    // Center first: it is where characters aim for in a square.
    nodes.push([gx * per + per / 2, gy * per + per / 2]);
    for (let ny = gy * per; ny <= (gy + 1) * per; ny += 1) {
      for (let nx = gx * per; nx <= (gx + 1) * per; nx += 1) nodes.push([nx, ny]);
    }
    return nodes;
  };

  return {
    /** Spread out from somewhere open in a floor square. */
    floodFromCell(cell) {
      const start = cellNodes(cell).find(([nx, ny]) => isOpenNode(nx, ny));
      if (start) flood(start[0], start[1]);
    },

    /** Whether a body can stand somewhere in this floor square and has been reached. */
    reachesCell(cell) {
      return cellNodes(cell).some(([nx, ny]) => isReachedNode(nx, ny));
    },

    /**
     * Whether a body at `spot` (px) with edges `bodyRect` (px, relative to the spot) stands
     * clear and can step straight onto reached floor.
     */
    reachesSpot(spot, bodyRect) {
      const rect = {
        left: spot.x + bodyRect.left, right: spot.x + bodyRect.right,
        top: spot.y + bodyRect.top, bottom: spot.y + bodyRect.bottom,
      };
      if (!isClear(rect)) return false;
      const cx = Math.round((rect.left + rect.right) / 2 / step);
      const cy = Math.round((rect.top + rect.bottom) / 2 / step);
      for (let ny = cy - 2; ny <= cy + 2; ny += 1) {
        for (let nx = cx - 2; nx <= cx + 2; nx += 1) {
          if (!isReachedNode(nx, ny)) continue;
          const node = bodyAt(nx * step, ny * step);
          if (isClear({
            left: Math.min(rect.left, node.left), right: Math.max(rect.right, node.right),
            top: Math.min(rect.top, node.top), bottom: Math.max(rect.bottom, node.bottom),
          })) return true;
        }
      }
      return false;
    },

    /**
     * True when a walkable floor square holds an unreached pocket roomy enough to walk
     * around in (a few steps each way), not just a sliver behind a fixture.
     */
    hasCutOffFloor() {
      const per = TILE_SIZE / step;
      const strandedOpen = (nx, ny) => isOpenNode(nx, ny) && !isReachedNode(nx, ny);
      for (let gy = 0; gy < gridSize.gridH; gy += 1) {
        for (let gx = 0; gx < gridSize.gridW; gx += 1) {
          if (!isTileWalkable(gx, gy)) continue;
          for (let ny = gy * per; ny < (gy + 1) * per; ny += 1) {
            for (let nx = gx * per; nx < (gx + 1) * per; nx += 1) {
              if (!strandedOpen(nx, ny)) continue;
              let roomy = true;
              for (let oy = 0; oy < 3 && roomy; oy += 1) {
                for (let ox = 0; ox < 3 && roomy; ox += 1) roomy = strandedOpen(nx + ox, ny + oy);
              }
              if (roomy) return true;
            }
          }
        }
      }
      return false;
    },
  };
}
