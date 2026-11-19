export const MAX_CARRIED_CRATES = 3;
export const STACKED_CARRY_SPEED_MULTIPLIER = 0.75;
export const THREE_CRATE_CARRY_SPEED_MULTIPLIER = 0.5;
// Tallest stack of crates allowed on the floor.
export const FLOOR_STACK_MAX = 3;
// Holding the pick-up or put-down button this long (ms) counts as a hold, which moves a
// stack; anything shorter is a tap, which moves one crate.
export const HOLD_KEY_MS = 300;
// A crate counts as "in front" when it's no further to the side than this many times its
// distance ahead (2 is about 63 degrees either side of straight ahead).
export const FACING_CONE = 2;

const FACING_VECTORS = Object.freeze({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] });

/**
 * Whether a crate's base is squarely in front of someone's feet: across the way they face,
 * at least half the feet must line up with the base (facing up, half the feet's width must
 * sit within the crate's width), so a stack off to one side doesn't count.
 * @param {{ left: number, right: number, top: number, bottom: number }} feet
 * @param {{ left: number, right: number, top: number, bottom: number }} base
 * @param {"up"|"down"|"left"|"right"} facing - unknown values count as facing down
 */
export function isSquarelyInFront(feet, base, facing) {
  const sideways = facing === "left" || facing === "right";
  const overlap = sideways
    ? Math.min(feet.bottom, base.bottom) - Math.max(feet.top, base.top)
    : Math.min(feet.right, base.right) - Math.max(feet.left, base.left);
  const feetSize = sideways ? feet.bottom - feet.top : feet.right - feet.left;
  return overlap >= feetSize / 2;
}

/**
 * Whether a point lies in front of someone facing this way, within FACING_CONE.
 * @param {{ x: number, y: number }} from
 * @param {{ x: number, y: number }} to
 * @param {"up"|"down"|"left"|"right"} facing - unknown values count as facing down
 */
export function isInFacingCone(from, to, facing) {
  const [faceX, faceY] = FACING_VECTORS[facing] ?? FACING_VECTORS.down;
  const toX = to.x - from.x;
  const toY = to.y - from.y;
  const ahead = toX * faceX + toY * faceY;
  const sideways = Math.abs(toX * faceY - toY * faceX);
  return ahead > 0 && sideways <= ahead * FACING_CONE;
}
