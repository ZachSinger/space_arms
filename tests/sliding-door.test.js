import assert from "node:assert/strict";
import test from "node:test";
import { AnimatedDoor, BACKROOM_DOOR_SPRITE, STORE_DOOR_SPRITE, SlidingDoor } from "../js/logic/SlidingDoor.js";

function createScene() {
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
  return { scene, sprites, blockers };
}

function createDoor() {
  const { scene, sprites, blockers } = createScene();
  const group = { add: () => {} };
  return { door: new SlidingDoor(scene, { x: 100, y: 64, wallGroup: group }), sprites, blockers };
}

const frames = (sprites) => sprites.map((sprite) => sprite.frame);
const atDoor = [{ x: 100, y: 64 }];

test("the front doorway is one double door that blocks the doorway while closed", () => {
  assert.deepEqual(STORE_DOOR_SPRITE, {
    key: "store_double_door",
    path: "img/Icons_Extracted/Tileset/Doors/store_double_door.png",
    frameWidth: 96,
    frameHeight: 96,
  });
  const { door, sprites, blockers } = createDoor();
  assert.deepEqual(sprites.map(({ x, y, width, height }) => [x, y, width, height]), [[100, 64, 64, 64]]);
  assert.deepEqual(blockers.map(({ x, width }) => [x, width]), [[100, 64]]);
  assert.deepEqual(door.doorwayPoint, { x: 100, y: 64 });
  assert.deepEqual(frames(sprites), [0]);
});

test("the door opens when someone walks up, then closes after they leave", () => {
  const { door, blockers, sprites } = createDoor();
  door.update(16, atDoor);
  assert.equal(door.state, "opening");
  assert.equal(blockers[0].body.enable, false);
  door.update(90, atDoor);
  assert.deepEqual(frames(sprites), [1]);

  door.update(180, atDoor);
  assert.equal(door.state, "open");
  assert.deepEqual(frames(sprites), [3]);

  door.update(499, []);
  assert.equal(door.state, "open");
  door.update(1, []);
  assert.equal(door.state, "closing");

  door.update(270, []);
  assert.equal(door.state, "closed");
  assert.deepEqual(frames(sprites), [0]);
  assert.equal(blockers[0].body.enable, true);
});

test("the door stays shut for someone who isn't near it", () => {
  const { door } = createDoor();
  door.update(500, [{ x: 400, y: 300 }, null]);
  assert.equal(door.state, "closed");
});

test("the door opens for an arriving customer until they walk clear", () => {
  const { door, sprites, blockers } = createDoor();
  const arrival = { x: 100, y: 90, active: true };
  door.letIn(arrival);
  door.update(270, []);
  assert.equal(door.state, "open");
  assert.deepEqual(frames(sprites), [3]);
  assert.equal(blockers[0].body.enable, false);

  door.update(1000, []);
  assert.equal(door.state, "open");

  arrival.y = 400;
  door.update(16, []);
  assert.equal(door.state, "open");
  door.update(484, []);
  door.update(270, []);
  assert.equal(door.state, "closed");
});

test("the door reverses its closing animation if someone approaches", () => {
  const { door, sprites } = createDoor();
  door.update(270, atDoor);
  door.update(499, []);
  door.update(1, []);
  door.update(90, []);
  assert.equal(door.state, "closing");
  assert.deepEqual(frames(sprites), [2]);

  door.update(16, atDoor);
  assert.equal(door.state, "opening");
  door.update(90, atDoor);
  assert.equal(door.state, "open");
});

test("the backroom's glass door only animates; it adds nothing solid", () => {
  const { scene, sprites, blockers } = createScene();
  const door = new AnimatedDoor(scene, { x: 50, y: 128, sprite: BACKROOM_DOOR_SPRITE });
  assert.equal(sprites[0].texture, "backroom_glass_door");
  assert.equal(blockers.length, 0);
  door.update(270, true);
  assert.equal(door.state, "open");
  door.update(500, false);
  door.update(270, false);
  assert.equal(door.state, "closed");
  door.destroy();
});
