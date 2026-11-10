// ==========================================
// FILE: PadNavigation.js
// ==========================================
// Pure geometry for the controller menu cursor: which on-screen target lies next in a
// direction, and which is closest to a point. Rects are {left, top, right, bottom}.
// See also: UINavigator.js (applies this to the DOM).

const center = (rect) => ({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });

/**
 * The best target in a direction: mostly ahead, preferring ones lined up with the start.
 * @template T
 * @param {{left: number, top: number, right: number, bottom: number}} from
 * @param {{rect: object, item: T}[]} candidates
 * @param {"up"|"down"|"left"|"right"} direction
 * @returns {T|null}
 */
export function pickNeighbor(from, candidates, direction) {
  const start = center(from);
  const horizontal = direction === "left" || direction === "right";
  let best = null;
  let bestScore = Infinity;
  for (const { rect, item } of candidates) {
    const point = center(rect);
    const ahead = { right: point.x - start.x, left: start.x - point.x, down: point.y - start.y, up: start.y - point.y }[direction];
    if (ahead <= 1) continue;
    // Gap between the two rects across the direction of travel; 0 when they line up.
    const crossGap = horizontal
      ? Math.max(0, rect.top - from.bottom, from.top - rect.bottom)
      : Math.max(0, rect.left - from.right, from.left - rect.right);
    const crossOffset = horizontal ? Math.abs(point.y - start.y) : Math.abs(point.x - start.x);
    const score = ahead + crossGap * 3 + crossOffset * 0.25;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

/**
 * @template T
 * @param {{x: number, y: number}} point
 * @param {{rect: object, item: T}[]} candidates
 * @returns {T|null}
 */
export function pickNearest(point, candidates) {
  let best = null;
  let bestDistance = Infinity;
  for (const { rect, item } of candidates) {
    const { x, y } = center(rect);
    const distance = Math.hypot(x - point.x, y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item;
    }
  }
  return best;
}
