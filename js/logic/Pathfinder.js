// ==========================================
// FILE: Pathfinder.js
// ==========================================
// Pixel-scale A* guides character movement around actual collision boundaries. Grid BFS
// helpers remain for fixture-layout reachability checks, where all moves cost the same.

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
  step = 8,
  connectorRadius = 16,
  maxNodes = 50000,
}) {
  if (isSegmentClear(start, goal)) return [];

  const findConnector = (point) => {
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
          if (!isWalkable(x, y) || !isSegmentClear(point, candidate)) continue;
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

  const startNode = findConnector(start);
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

  const route = [start, ...nodes, goal];
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
export function getReachableGridCells(start, isWalkable, maxCells = 4000) {
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
export function findGridPath(start, goal, isWalkable, maxSteps = 4000) {
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
