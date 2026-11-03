import assert from "node:assert/strict";
import test from "node:test";
import { Crate, INTERACT_RANGE } from "../js/logic/Crate.js";

function createScene(obstacles = []) {
  const scene = {
    crateBounds: { left: 0, top: 0, right: 500, bottom: 500 },
    physics: { overlapRect: () => obstacles },
    crateGroup: {
      add(sprite) {
        sprite.body = {
          width: sprite.width,
          height: sprite.height,
          enable: true,
          moves: true,
          velocity: { x: 0, y: 0 },
          drag: { x: 0, y: 0 },
          setAllowGravity(value) {
            this.allowGravity = value;
            return this;
          },
          setAllowRotation(value) {
            this.allowRotation = value;
            return this;
          },
          setBounce(value) {
            this.bounce = value;
            return this;
          },
          setBoundsRectangle(value) {
            this.bounds = value;
            return this;
          },
          setCollideWorldBounds(value) {
            this.collideWorldBounds = value;
            return this;
          },
          setVelocity(x, y) {
            this.velocity = { x, y };
            return this;
          },
          setDrag(x, y) {
            this.drag = { x, y };
            return this;
          },
          stop() {
            this.setVelocity(0, 0);
            return this;
          },
          reset(x, y) {
            this.stop();
            sprite.setPosition(x, y);
          },
        };
      },
    },
    add: {
      image(x, y) {
        return {
          x,
          y,
          setDisplaySize(width, height) {
            this.width = width;
            this.height = height;
            return this;
          },
          setDepth(depth) {
            this.depth = depth;
            return this;
          },
          setPosition(newX, newY) {
            this.x = newX;
            this.y = newY;
            return this;
          },
        };
      },
    },
  };
  return scene;
}

test("crate saving restores its contents, position, and in-flight velocity", () => {
  const original = new Crate(createScene(), "item", 5, 100, 100);
  original.drop(120, 140, 80, -40, false);
  const saved = original.serialize();
  const restored = new Crate(createScene(), saved.itemId, saved.quantity, 0, 0);
  restored.applySave(saved);
  assert.deepEqual(restored.serialize(), saved);
  assert.equal(restored.isThrown, true);
});

test("picking up a stationary crate and dropping it preserves contents", () => {
  const scene = createScene();
  const crate = new Crate(scene, "item", 5, 100, 100);
  const body = crate.sprite.body;
  assert.equal(body.bounce, 0.6);
  assert.equal(body.allowGravity, false);
  assert.equal(body.allowRotation, false);
  assert.equal(body.collideWorldBounds, true);
  assert.equal(body.bounds, scene.crateBounds);

  assert.equal(crate.pickUp({ x: 200, y: 160, depth: 8 }), true);
  assert.equal(crate.isCarried, true);
  assert.equal(body.enable, false);
  assert.deepEqual(body.velocity, { x: 0, y: 0 });
  assert.deepEqual([crate.sprite.x, crate.sprite.y, crate.sprite.depth], [200, 132, 9]);

  crate.drop(200, 160, 160, 0, false);
  assert.equal(crate.isCarried, false);
  assert.equal(body.enable, true);
  assert.equal(body.moves, true);
  assert.deepEqual(body.velocity, { x: 240, y: 0 });
  assert.deepEqual(body.drag, { x: 180, y: 0 });
  assert.equal(crate.quantity, 5);

  crate.setPaused(true);
  assert.equal(body.moves, false);
  assert.deepEqual(body.velocity, { x: 240, y: 0 });
  crate.setPaused(false);
  assert.equal(body.moves, true);
});

test("moving crates cannot be picked up until both velocity components reach zero", () => {
  const crate = new Crate(createScene(), "item", 5, 100, 100);
  const body = crate.sprite.body;
  const carrier = { x: 200, y: 160, depth: 8 };

  for (const [x, y] of [[50, 0], [0, -20], [3, 4], [0.0001, 0]]) {
    body.setVelocity(x, y);
    assert.equal(crate.isStationary(), false);
    assert.equal(crate.pickUp(carrier), false);
    assert.equal(crate.isCarried, false);
    assert.equal(body.enable, true);
    assert.deepEqual(body.velocity, { x, y });
    assert.deepEqual([crate.sprite.x, crate.sprite.y, crate.quantity], [100, 100, 5]);
  }

  crate.setPaused(true);
  assert.equal(crate.pickUp(carrier), false);
  body.setVelocity(0, 0);
  assert.equal(crate.isStationary(), true);
  assert.equal(crate.pickUp(carrier), true);
  assert.equal(crate.isCarried, true);
  assert.equal(body.enable, false);
});

test("stationary drops stay still and diagonal throws retain full speed", () => {
  const crate = new Crate(createScene(), "item", 2, 100, 100);
  const body = crate.sprite.body;
  crate.drop(100, 100, 0, 0, true);
  assert.deepEqual(body.velocity, { x: 0, y: 0 });
  assert.deepEqual(body.drag, { x: 0, y: 0 });
  assert.equal(body.moves, false);

  const diagonal = 160 / Math.sqrt(2);
  crate.drop(100, 100, diagonal, -diagonal, false);
  assert.ok(body.velocity.x > 0 && body.velocity.y < 0);
  assert.ok(Math.abs(Math.hypot(body.velocity.x, body.velocity.y) - 240) < 0.001);
  assert.ok(Math.abs(Math.hypot(body.drag.x, body.drag.y) - 180) < 0.001);
  assert.equal(crate.quantity, 2);
});

test("drop position avoids nearby walls and stays within pickup range", () => {
  const wall = { enable: true, left: 0, right: 100, top: 0, bottom: 500 };
  const crate = new Crate(createScene([wall]), "item", 1, 200, 200);
  const position = crate.findDropPosition(111, 200);
  assert.ok(position);
  assert.ok(position.x - crate.sprite.body.width / 2 >= wall.right);
  assert.ok(Math.hypot(position.x - 111, position.y - 200) <= INTERACT_RANGE);
});

test("a throw can hit each customer once, including across bounces", () => {
  const crate = new Crate(createScene(), "item", 5, 100, 100);
  let hits = 0;
  const customer = { isDestroyed: false, hitByCrate: () => { hits += 1; } };
  const otherCustomer = { isDestroyed: false, hitByCrate: () => { hits += 1; } };
  crate.drop(100, 100, 160, 0, false);
  assert.equal(crate.tryHitCustomer(customer), true);
  assert.equal(crate.tryHitCustomer(customer), false);
  crate.sprite.body.setVelocity(-120, 0);
  assert.equal(crate.tryHitCustomer(customer), false);
  assert.equal(crate.tryHitCustomer(otherCustomer), true);
  assert.equal(hits, 2);
  assert.equal(crate.quantity, 5);

  crate.sprite.body.stop();
  assert.equal(crate.tryHitCustomer({ hitByCrate: () => { hits += 1; } }), false);
  crate.drop(100, 100, 160, 0, false);
  assert.equal(crate.tryHitCustomer(customer), true);
  assert.equal(hits, 3);
});

test("only active throws can hit customers", () => {
  const crate = new Crate(createScene(), "item", 5, 100, 100);
  const customer = { isDestroyed: false, hitByCrate: () => {} };
  crate.sprite.body.setVelocity(10, 0);
  assert.equal(crate.tryHitCustomer(customer), false);
  crate.drop(100, 100, 0, 0, false);
  crate.sprite.body.setVelocity(10, 0);
  assert.equal(crate.tryHitCustomer(customer), false);

  crate.drop(100, 100, 160, 0, true);
  assert.equal(crate.tryHitCustomer(customer), false);
  crate.setPaused(false);
  assert.equal(crate.tryHitCustomer({ ...customer, isDestroyed: true }), false);
  assert.equal(crate.tryHitCustomer(customer), true);

  crate.sprite.body.stop();
  crate.pickUp({ x: 100, y: 100, depth: 8 });
  assert.equal(crate.tryHitCustomer(customer), false);
});

test("drop position avoids corners and world bounds, or reports no room", () => {
  const walls = [
    { enable: true, left: 0, right: 100, top: 0, bottom: 500 },
    { enable: true, left: 0, right: 500, top: 0, bottom: 100 },
  ];
  const crate = new Crate(createScene(walls), "item", 1, 200, 200);
  const corner = crate.findDropPosition(111, 111);
  assert.ok(corner);
  assert.ok(corner.x >= 120 && corner.y >= 120);
  assert.ok(Math.hypot(corner.x - 111, corner.y - 111) <= INTERACT_RANGE);

  const clearCrate = new Crate(createScene(), "item", 1, 200, 200);
  assert.deepEqual(clearCrate.findDropPosition(200, 200), { x: 200, y: 200 });
  assert.ok(clearCrate.findDropPosition(10, 200).x >= 20);
  const enclosed = { enable: true, left: 0, right: 500, top: 0, bottom: 500 };
  const blockedCrate = new Crate(createScene([enclosed]), "item", 1, 200, 200);
  assert.equal(blockedCrate.findDropPosition(200, 200), null);
});
