// ==========================================
// FILE: CratePushing.js
// ==========================================
// Walking into a crate pushes it. A crate hit dead-on moves straight ahead; the further off
// to one side it is, the more it moves sideways, and one that only clips the edge of the
// player's path moves only sideways. Walking sideways into a crate pushes it sideways. A pushed crate pushes whatever crate it runs into, and
// every crate being pushed slows the player down. If a crate can't move (wall, fixture,
// loading pad crate, or too many crates in a row), whoever is pushing it can't move into it.

// Player speed multiplier by number of crates being pushed at once. Pushing more than
// MAX_PUSHED_CRATES at once isn't possible.
export const PUSH_SPEED_BY_CRATE_COUNT = [1, 0.6, 0.4, 0.25];
export const MAX_PUSHED_CRATES = PUSH_SPEED_BY_CRATE_COUNT.length - 1;
const CONTACT_SKIN = 2;
const EPSILON = 0.001;
// A crate knocked sideways out of the path moves at most this many times the mover's speed.
const MAX_SIDEWAYS_PUSH_SPEED = 2;
// How far off-center (0 = dead center, 1 = barely touching) a crate can be and still be
// pushed straight ahead.
const STRAIGHT_PUSH_ZONE = 0.4;

const overlaps = (a, b) =>
  a.left < b.left + b.width &&
  a.left + a.width > b.left &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;

const dot = (a, b) => a.x * b.x + a.y * b.y;

// Where a rectangle will be after moving at velocity for dt, plus a small margin so
// touching counts as contact.
function reach(rect, velocity, dt) {
  return {
    ...rect,
    left: rect.left + velocity.x * dt + Math.sign(velocity.x) * CONTACT_SKIN,
    top: rect.top + velocity.y * dt + Math.sign(velocity.y) * CONTACT_SKIN,
  };
}

const scale = (v, s) => ({ x: v.x * s, y: v.y * s });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });

// Which way a crate in the mover's path gets pushed. Dead center: straight ahead. The
// further off to one side it sits, the more the push turns toward that side, until a crate
// only clipping the edge of the path is pushed purely sideways, out of the way.
function pushDirection(from, to, direction) {
  const offset = {
    x: to.left + to.width / 2 - (from.left + from.width / 2),
    y: to.top + to.height / 2 - (from.top + from.height / 2),
  };
  if (dot(offset, direction) <= EPSILON) return null; // not in front of the mover
  const side = { x: -direction.y, y: direction.x };
  const halfSpan = (Math.abs(side.x) * (from.width + to.width) + Math.abs(side.y) * (from.height + to.height)) / 2;
  // Within the center zone the crate goes straight ahead; past it, the push turns sideways.
  const offCenter = Math.max(-1, Math.min(1, dot(offset, side) / halfSpan));
  const sideways = Math.sign(offCenter) *
    Math.max(0, (Math.abs(offCenter) - STRAIGHT_PUSH_ZONE) / (1 - STRAIGHT_PUSH_ZONE));
  const push = add(scale(direction, 1 - Math.abs(sideways)), scale(side, sideways));
  const length = Math.hypot(push.x, push.y);
  return length ? scale(push, 1 / length) : null;
}

/**
 * @param {object} options
 * @param {{left:number, top:number, width:number, height:number}} options.player
 * @param {{x:number, y:number}} options.velocity the player's intended velocity
 * @param {number} options.dt seconds
 * @param {{key:any, rect:object, locked:boolean}[]} options.crates
 * @param {(rect:object) => boolean} options.isBlocked true if a crate can't occupy rect
 * @returns {{playerVelocity:{x:number,y:number}, crateVelocities: Map<any,{x:number,y:number}>}}
 */
export function solveCratePush({ player, velocity, dt, crates, isBlocked }) {
  const run = (intended) => {
    const crateVelocities = new Map();
    const inChain = new Set();
    let budget = MAX_PUSHED_CRATES;

    const slideAgainstStatic = (rect, v) => {
      if (!isBlocked(reach(rect, v, dt))) return v;
      if (v.x && !isBlocked(reach(rect, { x: v.x, y: 0 }, dt))) return { x: v.x, y: 0 };
      if (v.y && !isBlocked(reach(rect, { x: 0, y: v.y }, dt))) return { x: 0, y: v.y };
      return { x: 0, y: 0 };
    };

    const resolve = (rect, v, mover) => {
      let out = mover ? slideAgainstStatic(rect, v) : { ...v };
      for (const crate of crates) {
        if (crate === mover || inChain.has(crate)) continue;
        // Already overlapping (e.g. a crate dropped on top of the player): let them separate.
        if (overlaps(rect, crate.rect)) continue;
        if (!overlaps(reach(rect, out, dt), crate.rect)) continue;
        const speed = Math.hypot(out.x, out.y);
        if (speed <= EPSILON) break;
        const heading = scale(out, 1 / speed);
        const direction = pushDirection(rect, crate.rect, heading);
        if (!direction) continue;

        // How much of the requested push the crate actually managed (1 = all of it).
        // The crate must keep pace with the mover going forward or the mover would walk into
        // it, so the push is sped up to match, capped for crates that only clip the edge
        // (those get flicked sideways out of the path instead, and the mover waits a moment).
        const forwardShare = dot(direction, heading);
        const pushSpeed = Math.min(speed / Math.max(forwardShare, EPSILON), speed * MAX_SIDEWAYS_PUSH_SPEED);
        let achieved = 0;
        if (!crate.locked && (crateVelocities.has(crate) || budget > 0)) {
          if (!crateVelocities.has(crate)) budget -= 1;
          inChain.add(crate);
          const pushed = resolve(crate.rect, scale(direction, pushSpeed), crate);
          inChain.delete(crate);
          crateVelocities.set(crate, pushed);
          achieved = Math.max(0, Math.min(1, dot(pushed, heading) / speed));
        }
        if (achieved < 1 - EPSILON) {
          // The mover only advances as far as the crate gave way, but can still slide
          // along the crate on the axis that doesn't run into it.
          const blocked = scale(heading, speed * (1 - achieved));
          out = scale(heading, speed * achieved);
          for (const axis of [{ x: blocked.x, y: 0 }, { x: 0, y: blocked.y }]) {
            if ((axis.x || axis.y) && !overlaps(reach(rect, add(out, axis), dt), crate.rect)) {
              out = add(out, axis);
            }
          }
        }
      }
      return out;
    };

    const playerVelocity = resolve(player, intended, null);
    return { playerVelocity, crateVelocities };
  };

  if (!velocity.x && !velocity.y) return { playerVelocity: { x: 0, y: 0 }, crateVelocities: new Map() };

  // First pass finds how many crates actually move, which sets how much the player slows.
  const moving = [...run(velocity).crateVelocities.values()].filter((v) => Math.hypot(v.x, v.y) > EPSILON);
  const factor = PUSH_SPEED_BY_CRATE_COUNT[Math.min(moving.length, MAX_PUSHED_CRATES)];
  const result = run({ x: velocity.x * factor, y: velocity.y * factor });
  const crateVelocities = new Map();
  for (const [crate, v] of result.crateVelocities) crateVelocities.set(crate.key, v);
  return { playerVelocity: result.playerVelocity, crateVelocities };
}
