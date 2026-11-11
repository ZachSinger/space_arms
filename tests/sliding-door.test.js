import assert from "node:assert/strict";
import test from "node:test";
import { STORE_DOOR_SPRITE, SlidingDoor } from "../js/logic/SlidingDoor.js";

function createDoor() {
  const sprites = [];
  const blockers = [];
  const scene = {
    add: {
      sprite(x, y, texture, frame) {
        const sprite = {
          x, y, texture, frame,
          setOrigin() { return this; },
          setDisplaySize(width, height) { this.width = width; this.height = height; return this; },
          setDepth() { return this; },
          setFrame(next) { this.frame = next; return this; },
          destroy() {},
        };
        sprites.push(sprite);
        return sprite;
      },
      rectangle(x, y, width, height) {
        const blocker = {
          x, y, width, height,
          body: { enable: true },
          setVisible() { return this; },
          destroy() {},
        };
        blockers.push(blocker);
        return blocker;
      },
    },
  };
  const group = { add: () => {} };
  return { door: new SlidingDoor(scene, { x: 100, y: 64, wallGroup: group }), sprites, blockers };
}

const frames = (sprites) => sprites.map((sprite) => sprite.frame);
const atExit = [{ x: 132, y: 64 }];

test("the doorway is an entrance door on the left and an exit door on the right", () => {
  assert.deepEqual(STORE_DOOR_SPRITE, {
    key: "store_glass_door",
    path: "img/Icons_Extracted/Tileset/Doors/store_glass_door.png",
    frameWidth: 96,
    frameHeight: 96,
  });
  const { door, sprites, blockers } = createDoor();
  assert.deepEqual(sprites.map(({ x, y, width, height }) => [x, y, width, height]),
    [[68, 64, 64, 64], [132, 64, 64, 64]]);
  assert.deepEqual(blockers.map(({ x, width }) => [x, width]), [[74, 52], [126, 52]]);
  assert.deepEqual(door.entrancePoint, { x: 68, y: 64 });
  assert.deepEqual(door.exitPoint, { x: 132, y: 64 });
  assert.deepEqual(frames(sprites), [0, 0]);
});

test("only the exit door opens when someone walks up, then closes after they leave", () => {
  const { door, blockers, sprites } = createDoor();
  door.update(16, atExit);
  assert.equal(door.exit.state, "opening");
  assert.equal(door.entrance.state, "closed");
  assert.deepEqual(blockers.map((b) => b.body.enable), [true, false]);
  door.update(90, atExit);
  assert.deepEqual(frames(sprites), [0, 1]);

  door.update(180, atExit);
  assert.equal(door.exit.state, "open");
  assert.deepEqual(frames(sprites), [0, 3]);

  door.update(499, []);
  assert.equal(door.exit.state, "open");
  door.update(1, []);
  assert.equal(door.exit.state, "closing");

  door.update(270, []);
  assert.equal(door.exit.state, "closed");
  assert.deepEqual(frames(sprites), [0, 0]);
  assert.deepEqual(blockers.map((b) => b.body.enable), [true, true]);
});

test("standing at the entrance door does not open it", () => {
  const { door } = createDoor();
  door.update(500, [{ x: 40, y: 64 }]);
  assert.equal(door.entrance.state, "closed");
  assert.equal(door.exit.state, "closed");
});

test("the entrance door opens for an arriving customer until they walk clear", () => {
  const { door, sprites, blockers } = createDoor();
  const arrival = { x: 68, y: 90, active: true };
  door.letIn(arrival);
  door.update(270, []);
  assert.equal(door.entrance.state, "open");
  assert.deepEqual(frames(sprites), [3, 0]);
  assert.deepEqual(blockers.map((b) => b.body.enable), [false, true]);

  door.update(1000, []);
  assert.equal(door.entrance.state, "open");

  arrival.y = 400;
  door.update(16, []);
  assert.equal(door.entrance.state, "open");
  door.update(484, []);
  door.update(270, []);
  assert.equal(door.entrance.state, "closed");

  // Walking back past the entrance later doesn't reopen it.
  arrival.y = 90;
  door.update(500, []);
  assert.equal(door.entrance.state, "closed");
});

test("a door reverses its closing animation if someone approaches", () => {
  const { door, sprites } = createDoor();
  door.update(270, atExit);
  door.update(499, []);
  door.update(1, []);
  door.update(90, []);
  assert.equal(door.exit.state, "closing");
  assert.deepEqual(frames(sprites), [0, 2]);

  door.update(16, atExit);
  assert.equal(door.exit.state, "opening");
  door.update(90, atExit);
  assert.equal(door.exit.state, "open");
});
