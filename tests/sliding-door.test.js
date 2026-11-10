import assert from "node:assert/strict";
import test from "node:test";
import { SLIDING_DOOR_ASSETS, SlidingDoor } from "../js/logic/SlidingDoor.js";

function createDoor() {
  const sprite = {
    texture: null,
    setOrigin() { return this; },
    setDisplaySize() { return this; },
    setDepth() { return this; },
    setTexture(texture) {
      this.texture = texture;
      return this;
    },
    destroy() {},
  };
  const blocker = {
    body: { enable: true },
    setVisible() { return this; },
    destroy() {},
  };
  const scene = {
    add: {
      image(_x, _y, texture) {
        sprite.texture = texture;
        return sprite;
      },
      rectangle() {
        return blocker;
      },
    },
  };
  const group = { add: () => blocker };
  return { door: new SlidingDoor(scene, { x: 100, y: 64, wallGroup: group }), sprite, blocker };
}

test("the door loads its six authored opening frames and static states", () => {
  assert.equal(SLIDING_DOOR_ASSETS.length, 8);
  assert.ok(SLIDING_DOOR_ASSETS.every(({ path }) => path.endsWith(".png")));
  assert.equal(SLIDING_DOOR_ASSETS[0].path.endsWith("opening_00.png"), true);
  assert.equal(SLIDING_DOOR_ASSETS[5].path.endsWith("opening_05.png"), true);
  assert.equal(SLIDING_DOOR_ASSETS[6].path.endsWith("state_closed.png"), true);
  assert.equal(SLIDING_DOOR_ASSETS[7].path.endsWith("state_open.png"), true);
});

test("the door opens for nearby people and closes after they leave", () => {
  const { door, blocker, sprite } = createDoor();
  assert.equal(door.state, "closed");
  assert.equal(blocker.body.enable, true);

  door.update(16, [{ x: 100, y: 64 }]);
  assert.equal(door.state, "opening");
  assert.equal(blocker.body.enable, false);
  assert.equal(sprite.texture, "research_sliding_door_opening_00");

  door.update(464, [{ x: 100, y: 64 }]);
  assert.equal(door.state, "open");
  assert.equal(sprite.texture, "research_sliding_door_state_open");

  door.update(499, []);
  assert.equal(door.state, "open");
  door.update(1, []);
  assert.equal(door.state, "closing");
  assert.equal(blocker.body.enable, false);

  door.update(480, []);
  assert.equal(door.state, "closed");
  assert.equal(sprite.texture, "research_sliding_door_state_closed");
  assert.equal(blocker.body.enable, true);
});

test("the door reverses its closing animation if someone approaches", () => {
  const { door, sprite, blocker } = createDoor();
  const nearby = [{ x: 100, y: 64 }];
  door.update(480, nearby);
  door.update(499, []);
  door.update(241, []);
  assert.equal(door.state, "closing");
  assert.equal(sprite.texture, "research_sliding_door_opening_02");

  door.update(16, nearby);
  assert.equal(door.state, "opening");
  assert.equal(sprite.texture, "research_sliding_door_opening_02");
  assert.equal(blocker.body.enable, false);
});
