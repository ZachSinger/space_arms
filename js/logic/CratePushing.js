// ==========================================
// FILE: CratePushing.js
// ==========================================
// Walking into a crate pushes it: dead-on moves it straight, off-center turns it sideways.
// Pushed crates push others and each slows the player; a crate that can't move blocks.

// Player speed multiplier by number of crates being pushed at once (index = count).
export const PUSH_SPEED_BY_CRATE_COUNT = [1, 0.6, 0.4, 0.25];
// Most crates the player can move at once: everything pushed plus everything carried.
export const MAX_MOVED_CRATES = 4;
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
 * @param {{key:any, rect:object, locked:boolean, weight?:number}[]} options.crates - weight
 *   is how many crates' worth this counts as when slowing the player (e.g. a floor stack)
 * @param {(rect:object) => boolean} options.isBlocked - true if a crate can't occupy rect
 * @param {number} [options.carriedWeight] - crates the player is carrying, added to the
 *   weight whenever anything is pushed
 * @param {number} [options.maxMoved] - most crates moved at once, carried ones included;
 *   customers pass Infinity since they shove anything in their way
 * @returns {{playerVelocity:{x:number,y:number}, crateVelocities: Map<any,{x:number,y:number}>}}
 */
export function solveCratePush({
  player, velocity, dt, crates, isBlocked, carriedWeight = 0, maxMoved = MAX_MOVED_CRATES,
}) {
  const run = (intended) => {
    const crateVelocities = new Map();
    const inChain = new Set();
    let budget = maxMoved - carriedWeight;

    const slideAgainstStatic = (rect, v) => {
      const fits = (candidate) => !isBlocked(reach(rect, candidate, dt));
      if (fits(v)) return v;
      // Creep in smaller steps so a crate finishes flush against a wall instead of
      // stopping a whole step early.
      for (const fraction of [0.5, 0.25, 0.125]) {
        const crept = scale(v, fraction);
        if (fits(crept)) return crept;
      }
      for (const axis of [v.x && { x: v.x, y: 0 }, v.y && { x: 0, y: v.y }]) {
        if (!axis) continue;
        if (fits(axis)) return axis;
        for (const fraction of [0.5, 0.25, 0.125]) {
          const crept = scale(axis, fraction);
          if (fits(crept)) return crept;
        }
      }
      return { x: 0, y: 0 };
    };

    const resolve = (rect, v, mover) => {
      let out = mover ? slideAgainstStatic(rect, v) : { ...v };
      for (const crate of crates) {
        if (crate === mover || inChain.has(crate)) continue;
        if (overlaps(rect, crate.rect)) {
          // Allow escape and sliding along an edge, but not movement through the crate.
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const dx = centerX - (crate.rect.left + crate.rect.width / 2);
          const dy = centerY - (crate.rect.top + crate.rect.height / 2);
          const insideX = centerX > crate.rect.left && centerX < crate.rect.left + crate.rect.width;
          const insideY = centerY > crate.rect.top && centerY < crate.rect.top + crate.rect.height;
          out = {
            x: insideY && dx * out.x < 0 ? 0 : out.x,
            y: insideX && dy * out.y < 0 ? 0 : out.y,
          };
          continue;
        }
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
        if (!crate.locked && (crateVelocities.has(crate) || budget >= (crate.weight ?? 1))) {
          if (!crateVelocities.has(crate)) budget -= crate.weight ?? 1;
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

  // First pass finds how much weight actually moves, which sets how much the player slows.
  // A crate's weight defaults to 1; anything carried adds to the weight once something moves.
  const moving = [...run(velocity).crateVelocities]
    .filter(([, v]) => Math.hypot(v.x, v.y) > EPSILON);
  const weight = moving.reduce((sum, [crate]) => sum + (crate.weight ?? 1), 0) +
    (moving.length ? carriedWeight : 0);
  const factor = PUSH_SPEED_BY_CRATE_COUNT[Math.min(weight, PUSH_SPEED_BY_CRATE_COUNT.length - 1)];
  const result = run({ x: velocity.x * factor, y: velocity.y * factor });
  const crateVelocities = new Map();
  for (const [crate, v] of result.crateVelocities) crateVelocities.set(crate.key, v);
  const still = crates.filter((crate) => {
    const v = result.crateVelocities.get(crate);
    return !v || Math.hypot(v.x, v.y) <= EPSILON;
  });
  return { playerVelocity: keepOutOfCrates(player, result.playerVelocity, dt, still), crateVelocities };
}

// How long (ms) a customer's claim on the crates they're pushing lasts without renewal.
export const CUSTOMER_PUSH_CLAIM_MS = 150;

/**
 * Two customers shoving the same crates: whoever is further from their destination keeps
 * pushing. Returns the claim this customer must give way to, or null if they may push.
 * @param {object} options
 * @param {any} options.customer
 * @param {number} options.distance - px this customer still has to walk
 * @param {number} options.now - ms
 * @param {Iterable<{customerPushClaim?: {customer:any, distance:number, time:number}}>} options.crates
 *   the crates this customer would move this frame
 * @param {(customer:any) => boolean} [options.isActive] - false once a claimant has left
 */
export function findCratePushRival({ customer, distance, now, crates, isActive = () => true }) {
  for (const crate of crates) {
    const claim = crate.customerPushClaim;
    if (!claim || claim.customer === customer || !isActive(claim.customer)) continue;
    if (now - claim.time > CUSTOMER_PUSH_CLAIM_MS) continue;
    if (claim.distance >= distance) return claim;
  }
  return null;
}

// How far a rect sits inside a crate, measured along the shallower side (0 if apart).
function depthInside(rect, crate) {
  const x = Math.min(rect.left + rect.width, crate.left + crate.width) - Math.max(rect.left, crate.left);
  const y = Math.min(rect.top + rect.height, crate.top + crate.height) - Math.max(rect.top, crate.top);
  return x > 0 && y > 0 ? Math.min(x, y) : 0;
}

// Final guard, one axis at a time: no step may sink the player deeper into a crate that
// isn't moving. Cutting a corner diagonally, then wiggling, used to slip him between
// Loading Pad crates. Stepping out and sliding along an edge still work.
function keepOutOfCrates(player, velocity, dt, crates) {
  let rect = player;
  const out = { x: 0, y: 0 };
  for (const axis of ["x", "y"]) {
    if (!velocity[axis]) continue;
    const next = axis === "x"
      ? { ...rect, left: rect.left + velocity.x * dt }
      : { ...rect, top: rect.top + velocity.y * dt };
    if (crates.every(({ rect: crate }) => depthInside(next, crate) <= depthInside(rect, crate) + EPSILON)) {
      out[axis] = velocity[axis];
      rect = next;
    }
  }
  return out;
}
