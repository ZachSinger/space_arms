// ==========================================
// FILE: FloorReachability.js
// ==========================================
// Where a walking body actually fits, at the same 8px spacing characters route on
// (Pathfinder.js findFreeWalkPath). Fixture layout checks use it so any gap a shopper's feet fit
// through counts as walkable, instead of rounding the floor to whole squares.
import { TILE_SIZE } from "./RoomLayout.js";

export const FLOOR_NODE_STEP = 8;

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
 * 8px steps from the starting points. Stricter than real routing (no diagonal steps), so
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
