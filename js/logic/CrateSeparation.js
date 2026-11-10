// ==========================================
// FILE: CrateSeparation.js
// ==========================================
// Arcade physics can't separate crates once they sink deep into each other (fast throws,
// dashes), leaving them stacked. This pulls overlapping crates apart along the shallower axis.

// Overlap (px) Arcade's own collision leaves behind; only deeper overlaps are corrected.
const OVERLAP_TOLERANCE = 0.5;

const overlapAmount = (a, b) => ({
  x: Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left),
  y: Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top),
});

const centerOf = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

/**
 * Moves for crates sunk into each other. Locked crates never move; each candidate move is
 * checked with isBlocked (walls, fixtures, bounds) so a crate is never pushed into scenery.
 * @param {{ key: any, rect: { left: number, top: number, width: number, height: number }, locked?: boolean }[]} crates
 * @param {(key: any, rect: object) => boolean} isBlocked
 * @returns {Map<any, { x: number, y: number }>} key -> offset to apply
 */
export function separateOverlappingCrates(crates, isBlocked = () => false) {
  const offsets = new Map();
  const rects = new Map(crates.map((crate) => [crate.key, { ...crate.rect }]));
  const shift = (crate, dx, dy) => {
    const rect = rects.get(crate.key);
    rect.left += dx;
    rect.top += dy;
    const offset = offsets.get(crate.key) ?? { x: 0, y: 0 };
    offsets.set(crate.key, { x: offset.x + dx, y: offset.y + dy });
  };
  const canShift = (crate, dx, dy) => {
    if (crate.locked) return false;
    const rect = rects.get(crate.key);
    return !isBlocked(crate.key, { ...rect, left: rect.left + dx, top: rect.top + dy });
  };

  for (let i = 0; i < crates.length; i++) {
    for (let j = i + 1; j < crates.length; j++) {
      const a = crates[i];
      const b = crates[j];
      const overlap = overlapAmount(rects.get(a.key), rects.get(b.key));
      if (overlap.x <= OVERLAP_TOLERANCE || overlap.y <= OVERLAP_TOLERANCE) continue;

      const centerA = centerOf(rects.get(a.key));
      const centerB = centerOf(rects.get(b.key));
      const axes = overlap.x < overlap.y ? ["x", "y"] : ["y", "x"];
      for (const axis of axes) {
        // Push b away from a; identical centers fall back to pushing b right/down.
        const sign = centerB[axis] >= centerA[axis] ? 1 : -1;
        const push = overlap[axis] * sign;
        const vector = (amount) => (axis === "x" ? [amount, 0] : [0, amount]);
        const options = [
          [push / 2, push / 2],
          [0, push],
          [push, 0],
        ];
        const fit = options.find(([moveA, moveB]) =>
          (moveA === 0 || canShift(a, ...vector(-moveA))) &&
          (moveB === 0 || canShift(b, ...vector(moveB))));
        if (!fit) continue;
        if (fit[0]) shift(a, ...vector(-fit[0]));
        if (fit[1]) shift(b, ...vector(fit[1]));
        break;
      }
    }
  }
  return offsets;
}
