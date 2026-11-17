import test from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER_PUSH_CLAIM_MS, findCratePushRival, solveCratePush, PUSH_SPEED_BY_CRATE_COUNT,
} from "../js/logic/CratePushing.js";
import { canLeaveLoadingPad } from "../js/logic/LoadingPadEscape.js";

const PLAYER = { left: 89, top: 200, width: 22, height: 40 };
const crateAt = (key, x, y, locked = false) => ({ key, rect: { left: x - 20, top: y - 20, width: 40, height: 40 }, locked });
const UP = { x: 0, y: -160 };
const solve = (crates, { player = PLAYER, velocity = UP, isBlocked = () => false } = {}) =>
  solveCratePush({ player, velocity, dt: 1 / 60, crates, isBlocked });

test("walking straight into a crate pushes it straight ahead and slows the player", () => {
  const { playerVelocity, crateVelocities } = solve([crateAt("a", 100, 179)]);
  const speed = 160 * PUSH_SPEED_BY_CRATE_COUNT[1];
  assert.ok(Math.abs(playerVelocity.y + speed) < 0.01);
  assert.ok(Math.abs(playerVelocity.x) < 0.01);
  const crate = crateVelocities.get("a");
  assert.ok(Math.abs(crate.x) < 0.01);
  assert.ok(Math.abs(crate.y - playerVelocity.y) < 0.01);
});

test("a heavier crate and carried crates slow the player more", () => {
  const { playerVelocity } = solve([{ ...crateAt("a", 100, 179), weight: 2 }]);
  assert.ok(Math.abs(playerVelocity.y + 160 * PUSH_SPEED_BY_CRATE_COUNT[2]) < 0.01);
  const carrying = solveCratePush({
    player: PLAYER, velocity: UP, dt: 1 / 60, crates: [crateAt("a", 100, 179)],
    isBlocked: () => false, carriedWeight: 2,
  });
  assert.ok(Math.abs(carrying.playerVelocity.y + 160 * PUSH_SPEED_BY_CRATE_COUNT[3]) < 0.01);
});

test("a crate slightly off-center is still pushed straight ahead", () => {
  const crate = solve([crateAt("a", 112, 179)]).crateVelocities.get("a");
  assert.ok(crate.y < 0);
  assert.ok(Math.abs(crate.x) < 0.01);
});

test("a crate further off-center is pushed mostly forward and a little sideways", () => {
  const crate = solve([crateAt("a", 118, 179)]).crateVelocities.get("a");
  assert.ok(crate.y < 0, "moves forward");
  assert.ok(crate.x > 0, "moves to the right");
  assert.ok(Math.abs(crate.y) > Math.abs(crate.x));
});

test("a crate mostly to the right is pushed slightly forward and mostly right", () => {
  const crate = solve([crateAt("a", 125, 179)]).crateVelocities.get("a");
  assert.ok(crate.y < 0, "moves forward");
  assert.ok(crate.x > Math.abs(crate.y), "moves mostly right");
});

test("a crate clipping the edge of the path is pushed only sideways, out of the way", () => {
  const { playerVelocity, crateVelocities } = solve([crateAt("a", 130, 179)]);
  const crate = crateVelocities.get("a");
  assert.ok(crate.x > 0);
  assert.ok(Math.abs(crate.y) < crate.x * 0.1, "barely moves forward");
  assert.ok(playerVelocity.y < 0, "the player keeps walking");
});

test("walking sideways into a crate beside the player pushes it sideways", () => {
  const RIGHT = { x: 160, y: 0 };
  const { playerVelocity, crateVelocities } = solve([crateAt("a", 131, 220)], { velocity: RIGHT });
  const crate = crateVelocities.get("a");
  assert.ok(crate.x > 0 && Math.abs(crate.y) < 0.01);
  assert.ok(playerVelocity.x > 0 && playerVelocity.x < 160);
});

test("a crate beside the player is not pushed when walking past it", () => {
  const result = solve([crateAt("a", 131, 220)]);
  assert.equal(result.crateVelocities.size, 0);
  assert.deepEqual(result.playerVelocity, UP);
});

test("a crate blocked by a wall stops both the crate and the player", () => {
  const { playerVelocity, crateVelocities } = solve([crateAt("a", 100, 179)], { isBlocked: () => true });
  assert.ok(Math.abs(playerVelocity.y) < 0.01);
  const crate = crateVelocities.get("a");
  assert.deepEqual(crate, { x: 0, y: 0 });
});

test("loading pad crates act like walls", () => {
  const { playerVelocity, crateVelocities } = solve([crateAt("a", 100, 179, true)]);
  assert.ok(Math.abs(playerVelocity.y) < 0.01);
  assert.equal(crateVelocities.size, 0);
});

test("each crate in a row slows the player more, and five can't be pushed", () => {
  const row = (n) => Array.from({ length: n }, (_, i) => crateAt(`c${i}`, 100, 179 - i * 40));
  const speeds = [1, 2, 3].map((n) => -solve(row(n)).playerVelocity.y);
  assert.ok(speeds[0] > speeds[1] && speeds[1] > speeds[2] && speeds[2] > 0);
  assert.ok(-solve(row(4)).playerVelocity.y > 0);
  assert.ok(Math.abs(solve(row(5)).playerVelocity.y) < 0.01);
});

test("no more than four crates move at once, counting stacks and what the player carries", () => {
  const stack = (key, y, weight) => ({ ...crateAt(key, 100, y), weight });
  const twoStacks = [stack("a", 179, 3), stack("b", 139, 3)];
  assert.ok(Math.abs(solve(twoStacks).playerVelocity.y) < 0.01, "two stacks of 3 won't budge");
  const carrying = (carriedWeight, crates) => solveCratePush({
    player: PLAYER, velocity: UP, dt: 1 / 60, crates, isBlocked: () => false, carriedWeight,
  }).playerVelocity.y;
  assert.ok(carrying(1, [stack("a", 179, 3)]) < 0, "holding 1 and pushing 3 is 4");
  assert.ok(Math.abs(carrying(2, [stack("a", 179, 3)])) < 0.01, "holding 2 and pushing 3 is too many");
});

test("customers shove any number of crates out of their way", () => {
  const stacks = [{ ...crateAt("a", 100, 179), weight: 3 }, { ...crateAt("b", 100, 139), weight: 3 }];
  const { playerVelocity, crateVelocities } = solveCratePush({
    player: PLAYER, velocity: UP, dt: 1 / 60, crates: stacks, isBlocked: () => false, maxMoved: Infinity,
  });
  assert.ok(playerVelocity.y < 0);
  assert.ok(crateVelocities.get("b").y < 0);
});

test("when customers push the same crates, the one further from their destination wins", () => {
  const near = { name: "near" };
  const far = { name: "far" };
  const crate = { customerPushClaim: { customer: far, distance: 300, time: 1000 } };
  const rival = (customer, distance, now = 1050, isActive) =>
    findCratePushRival({ customer, distance, now, crates: [crate], isActive });
  assert.equal(rival(near, 100), crate.customerPushClaim, "the closer customer gives way");
  assert.equal(rival(near, 400), null, "the further customer keeps pushing");
  assert.equal(rival(far, 100), null, "a customer never gives way to themselves");
  assert.equal(rival(near, 100, 1000 + CUSTOMER_PUSH_CLAIM_MS + 1), null, "an old claim has lapsed");
  assert.equal(rival(near, 100, 1050, () => false), null, "a claim by someone who left doesn't count");
});

test("overlapping crates block movement farther inside, but allow escape in every direction", () => {
  const cases = [
    { player: { left: 89, top: 110, width: 22, height: 20 }, into: { x: 160, y: 0 } },
    { player: { left: 129, top: 110, width: 22, height: 20 }, into: { x: -160, y: 0 } },
    { player: { left: 109, top: 89, width: 22, height: 20 }, into: { x: 0, y: 160 } },
    { player: { left: 109, top: 131, width: 22, height: 20 }, into: { x: 0, y: -160 } },
  ];
  for (const locked of [false, true]) {
    for (const { player, into } of cases) {
      const crates = [crateAt("a", 120, 120, locked)];
      const blocked = solve(crates, { player, velocity: into });
      assert.deepEqual(blocked.playerVelocity, { x: 0, y: 0 });
      assert.equal(blocked.crateVelocities.size, 0);
      const away = { x: -into.x || 0, y: -into.y || 0 };
      assert.deepEqual(solve(crates, { player, velocity: away }).playerVelocity, away);
    }
  }
});

test("a player overlapping a crate can slide along it and can't walk through it", () => {
  const player = { left: 89, top: 110, width: 22, height: 20 };
  const crates = [crateAt("a", 120, 120, true)];
  assert.deepEqual(
    solve(crates, { player, velocity: { x: 160, y: -80 } }).playerVelocity,
    { x: 0, y: -80 },
  );
  for (let frame = 0; frame < 120; frame += 1) {
    const { playerVelocity } = solve(crates, { player, velocity: { x: 160, y: 0 } });
    player.left += playerVelocity.x / 60;
  }
  assert.equal(player.left, 89);
});

test("an off-center overlap still lets the player slide along the crate's side", () => {
  const crates = [crateAt("a", 120, 120, true)];
  const leftEdge = { left: 89, top: 98, width: 22, height: 20 };
  assert.deepEqual(
    solve(crates, { player: leftEdge, velocity: { x: 160, y: 160 } }).playerVelocity,
    { x: 0, y: 160 },
  );
  const topEdge = { left: 98, top: 89, width: 22, height: 20 };
  assert.deepEqual(
    solve(crates, { player: topEdge, velocity: { x: 160, y: 160 } }).playerVelocity,
    { x: 160, y: 0 },
  );
});

test("overlapping near a corner does not let the player pass through a crate", () => {
  const crates = [crateAt("a", 120, 120, true)];
  const cases = [
    { player: { left: 93, top: 92, width: 22, height: 20 }, velocity: { x: 160, y: 0 } },
    { player: { left: 91, top: 95, width: 22, height: 20 }, velocity: { x: 0, y: 160 } },
  ];
  for (const { player, velocity } of cases) {
    const start = { ...player };
    for (let frame = 0; frame < 120; frame += 1) {
      const { playerVelocity } = solve(crates, { player, velocity });
      player.left += playerVelocity.x / 60;
      player.top += playerVelocity.y / 60;
    }
    assert.deepEqual(player, start);
  }
});

test("a player overlapping crates on both sides can still move out between them", () => {
  const player = { left: 100, top: 100, width: 22, height: 20 };
  const crates = [
    { key: "left", rect: { left: 60, top: 90, width: 42, height: 40 }, locked: true },
    { key: "right", rect: { left: 120, top: 90, width: 42, height: 40 }, locked: true },
  ];
  assert.deepEqual(
    solve(crates, { player, velocity: { x: 160, y: -160 } }).playerVelocity,
    { x: 0, y: -160 },
  );
});

test("cutting diagonally past a pad crate's corner doesn't sink the player into it", () => {
  const crates = [{ key: "pad", rect: { left: 74, top: 6666, width: 28, height: 28 }, locked: true }];
  const player = { left: 106, top: 6654.6, width: 22, height: 20 };
  const dt = 1 / 30;
  const { playerVelocity } = solveCratePush({ player, velocity: { x: -198, y: -198 }, dt, crates, isBlocked: () => false });
  const moved = { left: player.left + playerVelocity.x * dt, top: player.top + playerVelocity.y * dt };
  const overlapsCrate = moved.left < 102 && moved.left + 22 > 74 && moved.top < 6694 && moved.top + 20 > 6666;
  assert.equal(overlapsCrate, false);
});

// The real backroom: a 128px pad against the bottom wall, crate spots 40px apart.
const PAD = { top: 6656 };
const FLOOR = { left: 64, right: 192, bottom: 6784 };
const padCrate = (x, y) => ({ left: x - 14, top: y - 14, width: 28, height: 28 });
const IN_CORNER = { left: 170, top: 6764, width: 22, height: 20 };
const padWithout = (...empty) => [6680, 6720, 6760].flatMap((y) => [88, 128, 168].map((x) => [x, y]))
  .filter(([x, y]) => !empty.some(([ex, ey]) => ex === x && ey === y))
  .map(([x, y]) => padCrate(x, y));

test("crates around the bottom-right pad corner box the player in", () => {
  const crates = padWithout([128, 6680], [168, 6680], [168, 6760]);
  assert.equal(canLeaveLoadingPad({ player: IN_CORNER, crates, pad: PAD, floor: FLOOR }), false);
});

test("an open pad column lets the player walk off the pad", () => {
  const crates = padWithout([128, 6680], [168, 6680], [168, 6720], [168, 6760]);
  assert.equal(canLeaveLoadingPad({ player: IN_CORNER, crates, pad: PAD, floor: FLOOR }), true);
});

test("a crate on top of the player boxes him in", () => {
  const player = { left: 157, top: 6750, width: 22, height: 20 };
  assert.equal(canLeaveLoadingPad({ player, crates: [padCrate(168, 6760)], pad: PAD, floor: FLOOR }), false);
});
