import test from "node:test";
import assert from "node:assert/strict";
import {
  HOVERCART_BATTERY,
  Hovercart,
  getHovercartDrainPerSecond,
  getHovercartMoveSpeed,
  getHovercartTransferCount,
} from "../js/modules/hovercart/Hovercart.js";
import {
  HOVERCART_UPGRADES,
  getHovercartBatteryCapacity,
  getHovercartCapacity,
  isValidHovercartSave,
} from "../js/modules/hovercart/HovercartRules.js";

test("hovercart transfers never exceed available crates or free space", () => {
  assert.equal(getHovercartTransferCount(4, 3), 3);
  assert.equal(getHovercartTransferCount(2, 5), 2);
  assert.equal(getHovercartTransferCount(4, 0), 0);
  assert.equal(getHovercartTransferCount(-1, 3), 0);
});

test("a loaded hovercart follows more slowly, with a minimum speed", () => {
  assert.ok(getHovercartMoveSpeed(3) < getHovercartMoveSpeed(0));
  assert.equal(getHovercartMoveSpeed(5), 60);
  assert.equal(getHovercartMoveSpeed(8), 60);
});

test("hovercart upgrades change speed and capacity by their purchased steps", () => {
  assert.equal(getHovercartMoveSpeed(0, 1), 190);
  assert.equal(getHovercartMoveSpeed(4, 1), 142);
  assert.equal(getHovercartMoveSpeed(5, 2), 205);
  assert.equal(getHovercartMoveSpeed(6, 3), 280);
  assert.equal(getHovercartCapacity({ speed: 2, length: 2, battery: 0 }), 5);
  assert.equal(getHovercartBatteryCapacity({ speed: 3, length: 3, battery: 6 }), 1600);
  assert.equal(HOVERCART_UPGRADES.battery[5].capacity / getHovercartDrainPerSecond(6, true), 100);
});

test("hovercart saves validate upgrade dependencies and upgraded cargo and battery", () => {
  const saved = { owned: true, crates: [], upgrades: { speed: 1, length: 1, battery: 1 }, battery: 450 };
  assert.equal(isValidHovercartSave(saved), true);
  assert.equal(isValidHovercartSave({ ...saved, upgrades: { ...saved.upgrades, speed: 0 } }), false);
  assert.equal(isValidHovercartSave({ ...saved, crates: [{ kind: "item" }, {}, {}, {}, {}] }), false);
  assert.equal(isValidHovercartSave({ ...saved, battery: 451 }), false);
  assert.equal(isValidHovercartSave({
    owned: true,
    crates: [{}, {}, {}, {}, {}, {}],
    upgrades: { speed: 3, length: 3, battery: 6 },
    battery: 1600,
  }), true);
  assert.equal(isValidHovercartSave({ owned: true, crates: [], battery: HOVERCART_BATTERY.capacity }), true);
});

test("hovercart battery drain matches the agreed table", () => {
  assert.deepEqual([0, 1, 2, 3].map((n) => getHovercartDrainPerSecond(n, false)), [1, 2, 3, 4]);
  assert.deepEqual([0, 1, 2, 3].map((n) => getHovercartDrainPerSecond(n, true)), [4, 6, 8, 10]);
  assert.equal(HOVERCART_BATTERY.capacity / getHovercartDrainPerSecond(3, true), 30);
});

test("stocking beside a linked cart includes distant stopped carts, but not unavailable ones", () => {
  const scene = { areas: { playerArea: "shop", areaAt: (_x, y) => y < 100 ? "shop" : "backroom" } };
  const carts = [20, 70, 120].map((x) => Object.assign(Object.create(Hovercart.prototype), {
    scene,
    cart: { x, y: 20 },
    cartCrates: [{ id: `cargo-${x}` }],
    moving: false,
    carried: false,
    crossing: null,
    active: true,
    isInReach() { return this.active && !this.moving && this.cart.x < 56; },
  }));
  for (const cart of carts) cart.linkedCarts = carts;
  const cargo = carts.flatMap((cart) => cart.cartCrates);
  for (const cart of carts) assert.deepEqual(cart.getStockableCrates(), cargo);
  assert.deepEqual(carts[1].getCargoCrates(), cargo);

  const tail = carts[2];
  for (const [property, value] of [["moving", true], ["active", false], ["carried", true],
    ["crossing", { phase: "out" }]]) {
    const previous = tail[property];
    tail[property] = value;
    assert.deepEqual(carts[0].getStockableCrates(), cargo.slice(0, 2), property);
    tail[property] = previous;
  }
  tail.cart.y = 200;
  assert.deepEqual(carts[0].getStockableCrates(), cargo.slice(0, 2), "other room");
  tail.cart.y = 20;
  scene.areas.playerArea = "backroom";
  assert.deepEqual(carts[0].getStockableCrates(), [], "player in another room");
  scene.areas.playerArea = "shop";
  carts[0].cart.x = 200;
  assert.deepEqual(carts[1].getStockableCrates(), [], "no linked cart in reach");
  assert.deepEqual(carts[1].getCargoCrates(), cargo, "inventory still counts unavailable cargo");
  carts[0].linkedCarts = null;
  carts[0].cart.x = 20;
  assert.deepEqual(carts[0].getStockableCrates(), carts[0].cartCrates, "normal single-cart stocking");
});

test("a player pushes all touching linked carts at one-crate speed and cannot push them through a wall", () => {
  const body = (x, y, width, height) => ({
    x, y, width, height, enable: true, velocity: { x: 0, y: 0 },
    setVelocity(x, y) { this.velocity = { x, y }; },
  });
  const playerBody = body(100, 100, 22, 20);
  const scene = { player: { sprite: { body: playerBody } }, crateBounds: {} };
  let blocked = false;
  const carts = Array.from({ length: 3 }, (_, i) => Object.assign(Object.create(Hovercart.prototype), {
    scene,
    cart: { body: body(122 + i * 32, 102, 32, 16) },
    cartCrates: Array(6).fill({}),
    active: true,
    carried: false,
    path: ["old path"],
    isCartSpaceBlocked(rect) { return blocked && rect.left + rect.width > 218; },
  }));
  for (const cart of carts) cart.linkedCarts = carts;
  playerBody.setVelocity(160, 0);
  carts[0].updatePlayerPush(1000 / 60);
  assert.deepEqual(playerBody.velocity, { x: 96, y: 0 });
  for (const cart of carts) {
    assert.deepEqual(cart.cart.body.velocity, playerBody.velocity);
    assert.equal(cart.path, null);
  }
  blocked = true;
  playerBody.setVelocity(160, 0);
  carts[0].updatePlayerPush(1000 / 60);
  assert.deepEqual(playerBody.velocity, { x: 0, y: 0 });
  for (const cart of carts) assert.deepEqual(cart.cart.body.velocity, { x: 0, y: 0 });
});

test("linked carts track their leader's position and room, even while it crosses a door", () => {
  const player = { x: 10, y: 10, body: { enable: true, center: { x: 10, y: 12 } } };
  const leader = { x: 20, y: 200, body: { enable: false, center: { x: 20, y: 15 } } };
  const follower = {
    scene: { player: { sprite: player }, areas: {
      playerArea: "shop",
      areaAt: (_x, y) => y > 100 ? "backroom" : "shop",
    } },
    followTarget: leader,
    trailArea: "shop",
    trail: [{ x: 10, y: 12 }],
    trailTarget: { x: 10, y: 12 },
    targetFeet: Hovercart.prototype.targetFeet,
  };
  Hovercart.prototype.recordTrail.call(follower);
  assert.equal(follower.trailArea, "backroom");
  assert.deepEqual(follower.trail, [{ x: 20, y: 200 }]);
  assert.equal(follower.trailTarget, null);
});

test("a linked cart follows its leader, including when the leader changes rooms", () => {
  const previousPhaser = globalThis.Phaser;
  globalThis.Phaser = { Math: { Distance: { Between: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1) } } };
  try {
    const leader = { x: 100, y: 200, body: { enable: true, center: { x: 100, y: 200 } } };
    const player = { x: 10, y: 10, body: { center: { x: 10, y: 10 } } };
    let steeredTo = null;
    let doorTarget = null;
    const follower = {
      scene: { player: { sprite: player }, areas: {
        playerArea: "shop",
        areaAt: (_x, y) => y > 100 ? "backroom" : "shop",
      } },
      cart: { x: 0, y: 200, body: { stop() {} } },
      active: true,
      moving: false,
      followTarget: leader,
      recordTrail() {},
      syncCartCrates() {},
      steerInRoom(_time, target) { steeredTo = target; },
      findFollowPath(target, sameArea) { doorTarget = { target, sameArea }; return []; },
      targetFeet: Hovercart.prototype.targetFeet,
    };
    Hovercart.prototype.updateMovement.call(follower, 0, false);
    assert.equal(steeredTo, leader);
    leader.y = 10;
    Hovercart.prototype.updateMovement.call(follower, 500, false);
    assert.deepEqual(doorTarget, { target: leader, sameArea: false });
  } finally {
    if (previousPhaser === undefined) delete globalThis.Phaser;
    else globalThis.Phaser = previousPhaser;
  }
});
