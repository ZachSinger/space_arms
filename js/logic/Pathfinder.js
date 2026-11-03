// ==========================================
// FILE: Pathfinder.js
// ==========================================
// Simple grid-based BFS pathfinder (8-directional, with corner-cutting prevented) over an
// arbitrary walkability predicate. Operates purely on abstract integer grid cells ({gx, gy});
// callers own converting to/from world pixel coordinates. All moves cost the same, so BFS
// (not weighted A*) is enough to guarantee a shortest path.
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

// Returns an array of {gx, gy} waypoints from (exclusive of) start to (inclusive of) goal,
// or null if no path exists. isWalkable(gx, gy) is only ever queried for cells other than
// the start cell itself (the agent is trusted to already be standing somewhere valid).
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

      // Prevent cutting across a diagonal when both orthogonal neighbors are blocked --
      // otherwise a path could appear to clip through a solid corner (e.g. the shelf's).
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
