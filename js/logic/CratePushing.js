// ==========================================
// FILE: CratePushing.js
// ==========================================
// Walking into a crate pushes it: dead-on moves it straight, off-center turns it sideways.
// Pushed crates push others and each slows the player; a crate that can't move blocks.

// Player speed multiplier by number of crates being pushed at once (index = count).
export const PUSH_SPEED_BY_CRATE_COUNT = [1, 0.6, 0.4, 0.25];
export const MAX_PUSHED_CRATES = PUSH_SPEED_BY_CRATE_COUNT.length - 1;
// px; reach() extends motion by this so touching counts as contact.
const CONTACT_SKIN = 2;
const EPSILON = 0.001;
// A crate knocked sideways moves at most this many times the mover's speed.
const MAX_SIDEWAYS_PUSH_SPEED = 2;
// How far off-center (0 = dead center, 1 = barely touching) a crate is still pushed straight.
const STRAIGHT_PUSH_ZONE = 0.4;

const overlaps = (a, b) =>
  a.left < b.left + b.width &&
  a.left + a.width > b.left &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;

const dot = (a, b) => a.x * b.x + a.y * b.y;

function reach(rect, velocity, dt) {
  return {
    ...rect,
    left: rect.left + velocity.x * dt + Math.sign(velocity.x) * CONTACT_SKIN,
    top: rect.top + velocity.y * dt + Math.sign(velocity.y) * CONTACT_SKIN,
  };
}

const scale = (v, s) => ({ x: v.x * s, y: v.y * s });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });

/**
 * Unit push direction for a crate in the mover's path; turns sideways as it sits off-center.
 * @param {object} from - mover rect
 * @param {object} to - crate rect
 * @param {{x: number, y: number}} direction - mover's unit heading
 */
function pushDirection(from, to, direction) {
  const offset = {
    x: to.left + to.width / 2 - (from.left + from.width / 2),
    y: to.top + to.height / 2 - (from.top + from.height / 2),
  };
  if (dot(offset, direction) <= EPSILON) return null; // not in front of the mover
  const side = { x: -direction.y, y: direction.x };
  const halfSpan = (Math.abs(side.x) * (from.width + to.width) + Math.abs(side.y) * (from.height + to.height)) / 2;
  const offCenter = Math.max(-1, Math.min(1, dot(offset, side) / halfSpan));
  const sideways = Math.sign(offCenter) *
    Math.max(0, (Math.abs(offCenter) - STRAIGHT_PUSH_ZONE) / (1 - STRAIGHT_PUSH_ZONE));
  const push = add(scale(direction, 1 - Math.abs(sideways)), scale(side, sideways));
  const length = Math.hypot(push.x, push.y);
  return length ? scale(push, 1 / length) : null;
}

/**
 * Resolve one frame of the player walking into crates.
 * @param {object} options
 * @param {{left:number, top:number, width:number, height:number}} options.player
 * @param {{x:number, y:number}} options.velocity - the player's intended velocity, px/s
 * @param {number} options.dt - seconds
 * @param {{key:any, rect:object, locked:boolean}[]} options.crates
 * @param {(rect:object) => boolean} options.isBlocked - true if a crate can't occupy rect
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

        // Speed the push up to keep pace forward; edge-clipped crates are capped and flicked aside.
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
          // The mover advances only as far as the crate gave way, but may slide along it.
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
