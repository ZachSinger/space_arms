import test from "node:test";
import assert from "node:assert/strict";
import { solveCratePush, PUSH_SPEED_BY_CRATE_COUNT } from "../js/logic/CratePushing.js";

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

test("each crate in a row slows the player more, and four can't be pushed", () => {
  const row = (n) => Array.from({ length: n }, (_, i) => crateAt(`c${i}`, 100, 179 - i * 40));
  const speeds = [1, 2, 3].map((n) => -solve(row(n)).playerVelocity.y);
  assert.ok(speeds[0] > speeds[1] && speeds[1] > speeds[2] && speeds[2] > 0);
  assert.ok(Math.abs(solve(row(4)).playerVelocity.y) < 0.01);
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
