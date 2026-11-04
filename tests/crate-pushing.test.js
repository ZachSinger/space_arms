import test from "node:test";
import assert from "node:assert/strict";
import { solveCratePush, PUSH_SPEED_BY_CRATE_COUNT } from "../js/logic/CratePushing.js";

const PLAYER = { left: 89, top: 200, width: 22, height: 40 };
const crateAt = (key, x, y, locked = false) => ({ key, rect: { left: x - 20, top: y - 20, width: 40, height: 40 }, locked });
const UP = { x: 0, y: -160 };
const solve = (crates, { velocity = UP, isBlocked = () => false } = {}) =>
  solveCratePush({ player: PLAYER, velocity, dt: 1 / 60, crates, isBlocked });

test("walking straight into a crate pushes it straight ahead and slows the player", () => {
  const { playerVelocity, crateVelocities } = solve([crateAt("a", 100, 179)]);
  const speed = 160 * PUSH_SPEED_BY_CRATE_COUNT[1];
  assert.ok(Math.abs(playerVelocity.y + speed) < 0.01);
  assert.ok(Math.abs(playerVelocity.x) < 0.01);
  const crate = crateVelocities.get("a");
  assert.ok(Math.abs(crate.x) < 0.01);
  assert.ok(Math.abs(crate.y - playerVelocity.y) < 0.01);
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
