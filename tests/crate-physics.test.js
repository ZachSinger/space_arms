import assert from "node:assert/strict";
import test from "node:test";
import { Crate, INTERACT_RANGE, THROW_ACCELERATION_MS } from "../js/logic/Crate.js";

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
          acceleration: { x: 0, y: 0 },
          maxSpeed: -1,
          blocked: { none: true },
          touching: { none: true },
          setAcceleration(x, y) {
            this.acceleration = { x, y };
            return this;
          },
          setMaxSpeed(value) {
            this.maxSpeed = value;
            return this;
          },
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
          setImmovable(value) {
            this.immovable = value;
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
          getBounds() {
            return {
              left: this.x - this.width / 2, right: this.x + this.width / 2,
              top: this.y - this.height / 2, bottom: this.y + this.height / 2,
            };
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

test("fixture crates preserve their fixture type", () => {
  const scene = createScene();
  const crate = new Crate(scene, null, 1, 100, 100, {
    kind: "fixture",
    typeId: "shelf_universal",
  });
  assert.deepEqual(crate.serializePayload(), {
    kind: "fixture",
    typeId: "shelf_universal",
  });
  assert.equal(crate.itemId, null);
  assert.equal(crate.pickUp({ x: 120, y: 120, depth: 1 }), true);
  crate.drop(120, 140, 80, 0, false);
  assert.equal(crate.isThrown, true);
  assert.deepEqual(crate.serializePayload(), {
    kind: "fixture",
    typeId: "shelf_universal",
  });
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
  assert.deepEqual(body.drag, { x: 480, y: 0 });
  assert.equal(crate.quantity, 5);

  crate.setPaused(true);
  assert.equal(body.moves, false);
  assert.deepEqual(body.velocity, { x: 240, y: 0 });
  crate.setPaused(false);
  assert.equal(body.moves, true);
});

function thrower(x = 100, y = 100) {
  return {
    x, y, depth: 8,
    getBounds: () => ({ left: x - 16, right: x + 16, top: y - 16, bottom: y + 16 }),
  };
}

test("a crate still being launched by a throw cannot be picked up, even when paused", () => {
  const crate = new Crate(createScene(), "item", 5, 100, 100);
  const body = crate.sprite.body;
  const carrier = thrower();
  assert.equal(crate.pickUp(carrier), true);
  crate.startThrow(carrier, 160, 0);
  assert.equal(crate.isSliding(), false);
  assert.equal(crate.canPickUp(), false);
  assert.equal(crate.pickUp(carrier), false);
  crate.setPaused(true);
  assert.equal(crate.pickUp(carrier), false);
  assert.equal(crate.isCarried, false);
  assert.equal(body.enable, true);
  assert.deepEqual(body.velocity, { x: 160, y: 0 });
});

test("a thrown crate starts sliding once its launch ends and it clears the thrower", () => {
  const crate = new Crate(createScene(), "item", 5, 100, 100);
  const carrier = thrower();
  crate.pickUp(carrier);
  crate.startThrow(carrier, 160, 0);

  crate.sprite.setPosition(200, 100); // clear of the thrower, but the boost is still running
  crate.updateThrow(1);
  assert.equal(crate.isSliding(), false);

  crate.updateThrow(10_000); // boost over
  assert.equal(crate.isSliding(), true);
  assert.equal(crate.isThrown, true); // can still hit customers while sliding
  assert.equal(crate.canPickUp(), true);
  assert.equal(crate.pickUp(carrier), true);
  assert.equal(crate.isCarried, true);
  assert.deepEqual(crate.sprite.body.velocity, { x: 0, y: 0 });
});

test("a thrown crate keeps its launch boost until it clears the thrower", () => {
  const crate = new Crate(createScene(), "item", 5, 100, 100);
  const carrier = thrower();
  crate.pickUp(carrier);
  crate.startThrow(carrier, 0, 160);

  crate.updateThrow(10_000); // past the usual boost time, but still overlapping the thrower
  assert.notEqual(crate.launch, null);
  assert.equal(crate.launch.remainingMs, 1);
  assert.equal(crate.isSliding(), false);

  crate.sprite.setPosition(100, 200); // now clear
  crate.updateThrow(16);
  assert.equal(crate.launch, null);
  assert.equal(crate.isSliding(), true);
});

test("a thrown crate that hits something ends its boost even while over the thrower", () => {
  const crate = new Crate(createScene(), "item", 5, 100, 100);
  const carrier = thrower();
  crate.pickUp(carrier);
  crate.startThrow(carrier, 0, 160);
  crate.sprite.body.blocked = { none: false };
  crate.updateThrow(16);
  assert.equal(crate.launch, null);
});

for (const kind of ["item", "fixture"]) {
  test(`a moving, pushed ${kind} crate can be picked up without waiting`, () => {
    const crate = new Crate(createScene(), "item", 5, 100, 100,
      kind === "fixture" ? { kind, typeId: "shelf_universal" } : {});
    crate.push({ x: 80, y: -40 });
    assert.equal(crate.isStationary(), false);
    assert.equal(crate.canPickUp(), true);
    assert.equal(crate.pickUp({ x: 200, y: 160, depth: 8 }), true);
    assert.equal(crate.isCarried, true);
    assert.equal(crate.isPushed, false);
    assert.equal(crate.isThrown, false);
    assert.equal(crate.sprite.body.enable, false);
    assert.deepEqual(crate.sprite.body.velocity, { x: 0, y: 0 });
    assert.equal(crate.quantity, kind === "fixture" ? 1 : 5);
  });
}

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
  assert.ok(Math.abs(Math.hypot(body.drag.x, body.drag.y) - 480) < 0.001);
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

function carrierAt(x = 250, y = 250) {
  return {
    x, y, depth: 9999,
    getBounds() {
      return { left: this.x - 23, right: this.x + 23, top: this.y - 24, bottom: this.y + 24 };
    },
  };
}

function assertClearOfCarrier(crate, position, carrier) {
  const bounds = carrier.getBounds();
  const { width, height } = crate.sprite.body;
  assert.ok(position.x + width / 2 <= bounds.left || position.x - width / 2 >= bounds.right ||
    position.y + height / 2 <= bounds.top || position.y - height / 2 >= bounds.bottom,
    `Crate at ${JSON.stringify(position)} overlaps player at ${JSON.stringify(bounds)}`);
}

function advanceThrow(crate, milliseconds) {
  const body = crate.sprite.body;
  if (body.moves && body.enable) {
    const dt = milliseconds / 1000;
    for (const axis of ["x", "y"]) {
      if (body.acceleration[axis]) body.velocity[axis] += body.acceleration[axis] * dt;
      else body.velocity[axis] = Math.sign(body.velocity[axis]) * Math.max(0, Math.abs(body.velocity[axis]) - body.drag[axis] * dt);
    }
    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    if (body.maxSpeed >= 0 && speed > body.maxSpeed) {
      body.velocity.x *= body.maxSpeed / speed;
      body.velocity.y *= body.maxSpeed / speed;
    }
    crate.sprite.x += body.velocity.x * dt;
    crate.sprite.y += body.velocity.y * dt;
  }
  crate.updateThrow(milliseconds);
}

for (const kind of ["item", "fixture"]) {
  test(`${kind} throws inherit walking speed without teleporting, accelerate, then decelerate in all eight directions`, () => {
    for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const crate = new Crate(createScene(), "item", 5, 0, 0, { kind, typeId: "shelf_universal" });
      const carrier = carrierAt();
      const speed = 160;
      const length = Math.hypot(x, y);
      const vx = x / length * speed;
      const vy = y / length * speed;
      crate.pickUp(carrier);
      const start = { x: crate.sprite.x, y: crate.sprite.y };
      const position = crate.findThrowPosition(carrier, vx, vy);
      assert.ok(position);
      assertClearOfCarrier(crate, position, carrier);
      crate.startThrow(carrier, vx, vy);
      const body = crate.sprite.body;
      assert.deepEqual({ x: crate.sprite.x, y: crate.sprite.y }, start);
      assert.deepEqual(body.velocity, { x: vx, y: vy });
      assert.equal(crate.sprite.depth, carrier.depth + 1);
      let previousSpeed = speed;
      for (let elapsed = 0; elapsed < THROW_ACCELERATION_MS; elapsed += 10) {
        carrier.x += vx * 0.01;
        carrier.y += vy * 0.01;
        advanceThrow(crate, 10);
        const nextSpeed = Math.hypot(body.velocity.x, body.velocity.y);
        assert.ok(nextSpeed >= previousSpeed - 0.001);
        previousSpeed = nextSpeed;
      }
      assert.ok(Math.abs(previousSpeed - 400) < 0.001);
      // A crate thrown from overhead keeps its peak speed until it clears the thrower.
      for (let guard = 0; crate.launch && guard < 100; guard += 1) {
        carrier.x += vx * 0.01;
        carrier.y += vy * 0.01;
        advanceThrow(crate, 10);
        assert.ok(Math.abs(Math.hypot(body.velocity.x, body.velocity.y) - 400) < 0.001);
      }
      assert.equal(crate.throwCarrier, null);
      assert.equal(crate.launch, null);
      assert.deepEqual(body.acceleration, { x: 0, y: 0 });
      assert.ok(Math.abs(Math.hypot(body.drag.x, body.drag.y) - 480) < 0.001);
      carrier.x += vx * 0.01;
      carrier.y += vy * 0.01;
      advanceThrow(crate, 10);
      assert.ok(Math.hypot(body.velocity.x, body.velocity.y) < previousSpeed);
      for (let elapsed = 0; elapsed < 400; elapsed += 10) {
        carrier.x += vx * 0.01;
        carrier.y += vy * 0.01;
        advanceThrow(crate, 10);
      }
      assertClearOfCarrier(crate, { x: crate.sprite.x, y: crate.sprite.y }, carrier);
      assert.equal(crate.sprite.depth, 2);
      for (let elapsed = 0; elapsed < 450; elapsed += 10) advanceThrow(crate, 10);
      assert.equal(crate.isStationary(), true, "throw should stop within about one second");
      const distance = Math.hypot(crate.sprite.x - start.x, crate.sprite.y - start.y);
      // Downward throws start overhead and keep their boost until clear, so they go a bit farther.
      assert.ok(distance >= 200 && distance <= 310,
        `throw should travel about 210-300 pixels, not the previous 490: ${distance}`);
    }
  });

  test(`${kind} crates dropped while stationary land beside the player`, () => {
    const crate = new Crate(createScene(), "item", 5, 0, 0, { kind, typeId: "shelf_universal" });
    const carrier = carrierAt();
    const position = crate.findDropPosition(carrier.x, carrier.y, carrier);
    assert.ok(position);
    assertClearOfCarrier(crate, position, carrier);
    assert.ok(Math.hypot(position.x - carrier.x, position.y - carrier.y) <= INTERACT_RANGE);
  });
}

test("forward releases cannot skip through obstacles, other crates, or the loading pad", () => {
  const carrier = carrierAt();
  const wall = { enable: true, left: 274, right: 276, top: 0, bottom: 500 };
  const scene = createScene([wall]);
  const crate = new Crate(scene, "item", 1, 0, 0);
  crate.pickUp(carrier);
  assert.equal(crate.findThrowPosition(carrier, 160, 0), null, "must not skip through a thin wall");
  scene.physics.overlapRect = () => [];
  scene.restockCrates = [{ sprite: { body: { enable: true, left: 280, right: 320, top: 230, bottom: 270 } } }];
  assert.equal(crate.findThrowPosition(carrier, 160, 0), null);
  scene.restockCrates = [];
  scene.loadingPadRect = { left: 280, right: 416, top: 200, bottom: 328 };
  assert.equal(crate.findThrowPosition(carrier, 160, 0), null);
  assert.equal(crate.findThrowPosition(carrierAt(25, 250), -160, 0), null, "must stay inside world bounds");
  assert.equal(crate.findThrowPosition(carrier, 0, 0), null);
});

test("launch acceleration pauses with the crate and survives saving and loading", () => {
  const crate = new Crate(createScene(), "item", 5, 250, 250);
  const carrier = carrierAt();
  crate.pickUp(carrier);
  crate.startThrow(carrier, 160, 0);
  advanceThrow(crate, 40);
  crate.setPaused(true);
  const paused = crate.serialize();
  advanceThrow(crate, 1000);
  assert.deepEqual(crate.serialize(), paused);
  crate.setPaused(false);
  advanceThrow(crate, 40);
  const saved = crate.serialize();
  const restored = new Crate(createScene(), "item", 5, 0, 0);
  restored.applySave(saved);
  assert.deepEqual(restored.serialize(), saved);
  assert.deepEqual(restored.sprite.body.acceleration, crate.sprite.body.acceleration);
  advanceThrow(restored, 80);
  assert.equal(restored.launch, null);
  assert.deepEqual(restored.sprite.body.acceleration, { x: 0, y: 0 });
});

for (const impact of ["crate", "wall", "world"]) {
  test(`a ${impact} impact cancels launch acceleration and restores drag`, () => {
    const crate = new Crate(createScene(), "item", 5, 250, 250);
    crate.startThrow(carrierAt(), 160, 0);
    if (impact === "crate") crate.refreshDrag();
    else {
      if (impact === "wall") crate.sprite.body.touching.none = false;
      else crate.sprite.body.blocked.none = false;
      crate.updateThrow(16);
    }
    assert.equal(crate.launch, null);
    assert.deepEqual(crate.sprite.body.acceleration, { x: 0, y: 0 });
    assert.equal(crate.sprite.body.maxSpeed, -1);
    assert.deepEqual(crate.sprite.body.drag, { x: 480, y: 0 });
  });
}

test("a throw can hit each customer once, including across bounces", () => {
  const crate = new Crate(createScene(), "item", 5, 100, 100);
  const customer = { isDestroyed: false };
  const otherCustomer = { isDestroyed: false };
  crate.drop(100, 100, 160, 0, false);
  assert.equal(crate.tryHitCustomer(customer), true);
  assert.equal(crate.tryHitCustomer(customer), false);
  crate.sprite.body.setVelocity(-120, 0);
  assert.equal(crate.tryHitCustomer(customer), false);
  assert.equal(crate.tryHitCustomer(otherCustomer), true);
  assert.equal(crate.quantity, 5);

  crate.sprite.body.stop();
  assert.equal(crate.tryHitCustomer({ isDestroyed: false }), false);
  crate.drop(100, 100, 160, 0, false);
  assert.equal(crate.tryHitCustomer(customer), true);
});

test("only active throws can hit customers", () => {
  const crate = new Crate(createScene(), "item", 5, 100, 100);
  const customer = { isDestroyed: false };
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

test("drop position never lands on another crate", () => {
  const scene = createScene();
  const resting = new Crate(scene, "item", 1, 200, 200);
  Object.assign(resting.sprite.body, { left: 180, right: 220, top: 180, bottom: 220 });
  scene.restockCrates = [resting];
  const carried = new Crate(scene, "item", 1, 0, 0);
  const position = carried.findDropPosition(200, 200);
  assert.ok(position);
  const half = carried.sprite.body.width / 2;
  const clear = position.x - half >= 220 || position.x + half <= 180 ||
    position.y - half >= 220 || position.y + half <= 180;
  assert.ok(clear, JSON.stringify(position));
});

test("a bumped crate gets drag along its new direction so it always stops", () => {
  const crate = new Crate(createScene(), "item", 1, 100, 100);
  crate.drop(100, 100, 0, 0, false);
  assert.deepEqual(crate.sprite.body.drag, { x: 0, y: 0 });
  crate.sprite.body.setVelocity(0, -90);
  crate.refreshDrag();
  assert.deepEqual(crate.sprite.body.drag, { x: 0, y: 480 });
});

test("a delivered crate stays locked on the loading pad until picked up", () => {
  const crate = new Crate(createScene(), "item", 5, 100, 100);
  const body = crate.sprite.body;
  crate.lockToPad();
  assert.equal(body.immovable, true);
  assert.equal(body.moves, false);
  crate.setPaused(false);
  assert.equal(body.moves, false);
  assert.equal(crate.serialize().onPad, true);

  assert.equal(crate.pickUp({ x: 100, y: 100, depth: 1 }), true);
  assert.equal(crate.lockedToPad, false);
  assert.equal(body.immovable, false);
  crate.drop(300, 300, 0, 0, false);
  assert.equal(body.moves, true);
  assert.equal(crate.serialize().onPad, false);
});

test("a carried crate can't be dropped onto the loading pad", () => {
  const scene = createScene();
  scene.loadingPadRect = { left: 200, top: 200, right: 336, bottom: 328 };
  const crate = new Crate(scene, "item", 5, 0, 0);
  const position = crate.findDropPosition(268, 264);
  assert.equal(position, null);
  const nearEdge = crate.findDropPosition(268, 175);
  assert.ok(nearEdge.y + 20 <= 200);
});
