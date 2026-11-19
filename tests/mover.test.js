import assert from "node:assert/strict";
import { test } from "node:test";
import { Mover } from "../js/world/Mover.js";

function installPhaser(t) {
  const previous = globalThis.Phaser;
  globalThis.Phaser = {
    Math: {
      Distance: { Between: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1) },
      Angle: { Between: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1) },
    },
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.Phaser;
    else globalThis.Phaser = previous;
  });
}

function createCharacter() {
  const velocity = { x: 0, y: 0 };
  const character = {
    path: [],
    destination: null,
    sprite: {
      x: 0,
      y: 0,
      body: {
        center: { x: 0, y: 0 },
        setVelocity(x, y) { Object.assign(velocity, { x, y }); },
      },
    },
  };
  return { character, velocity };
}

function moverOptions(overrides = {}) {
  return {
    findPath: () => [],
    canFindPath: () => true,
    getSpeed: () => 100,
    replanIntervalMs: 200,
    waypointArrivalDistance: 0.0001,
    destinationArrivalDistance: 6,
    onReroute() {},
    onPortal() {},
    onPathUnavailable() {},
    ...overrides,
  };
}

test("mover uses portal hooks at waypoints and arrives only at the destination", (t) => {
  installPhaser(t);
  const { character } = createCharacter();
  const events = [];
  const portal = { x: 20, y: 0 };
  const mover = new Mover(character, moverOptions({
    findPath: () => [{ x: 10, y: 0, teleportTo: portal }],
    onPortal: (destination) => {
      events.push("portal");
      character.sprite.body.center.x = destination.x;
    },
  }));
  mover.setDestination(30, 0, () => events.push("arrive"));

  character.sprite.body.center.x = 10;
  mover.followPath(16);
  assert.deepEqual(events, ["portal"]);
  assert.deepEqual(character.path, []);
  assert.equal(character.sprite.body.center.x, 20);

  character.sprite.body.center.x = 30;
  mover.followPath(16);
  assert.deepEqual(events, ["portal", "arrive"]);
});

test("mover stops and reports a route that cannot be found", (t) => {
  installPhaser(t);
  const { character, velocity } = createCharacter();
  let failures = 0;
  const mover = new Mover(character, moverOptions({
    findPath: () => null,
    onPathUnavailable: () => { failures += 1; },
  }));

  mover.setDestination(30, 0, () => assert.fail("unreachable destination must not arrive"));
  assert.equal(character.path, null);
  mover.handlePathUnavailable();

  assert.equal(failures, 1);
  assert.deepEqual(velocity, { x: 0, y: 0 });
});
