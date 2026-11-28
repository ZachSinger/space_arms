import assert from "node:assert/strict";
import { test } from "node:test";
import { SupplyDeliveryAnimation, deliveryCratePosition, deliveryDropTime, deliveryLift } from "../js/logic/SupplyDeliveryAnimation.js";
import { Crate } from "../js/logic/Crate.js";

test("crates leave the space window before starting their glide, in order", () => {
  for (const count of [1, 3, 6, 9]) {
    let previous = 0;
    for (let index = 0; index < count; index++) {
      const start = deliveryDropTime(index, count);
      assert.ok(start > previous);
      assert.ok(deliveryCratePosition(index, count, start - 1.6 - index * 0.2).y > 260);
      assert.equal(deliveryLift(start - 0.01, start, 300), 300);
      assert.equal(deliveryLift(start + 1.3, start, 300), 0);
      previous = start;
    }
  }
});

test("deliveries reserve invisible crates, land in row order, and finish before the next batch starts", () => {
  const makeCrate = (x, y) => ({
    setThrowHeight(height) { this.lift = height; },
    sprite: {
      x, y, displayWidth: 32, displayHeight: 28, visible: true,
      body: { enable: true, bottom: y + 14, updateFromGameObject() {} },
      setVisible(visible) { this.visible = visible; },
    },
  });
  const graphic = () => ({
    setDepth() { return this; }, clear() {}, fillStyle() {},
    fillEllipse() {}, fillTriangle() {}, destroy() {},
  });
  const animation = Object.assign(Object.create(SupplyDeliveryAnimation.prototype), {
    queue: [], active: null, status: {}, drawSpace() {},
    uiWindow: { openWindow() {}, close() {} },
    shop: {
      room: {}, add: { graphics: graphic },
      supply: { freePlayerFromPad() {} },
    },
  });
  const crates = [makeCrate(168, 6720), makeCrate(128, 6680), makeCrate(88, 6680)];
  const next = makeCrate(88, 6760);
  animation.enqueue(crates);
  animation.enqueue([next]);
  assert.ok([...crates, next].every((crate) => crate.incomingDelivery &&
    !crate.sprite.visible && !crate.sprite.body.enable));
  animation.update(1);
  assert.deepEqual(animation.active.crates.map(({ crate }) => crate), [crates[2], crates[1], crates[0]]);
  animation.update((animation.active.crates.at(-1).start + 1.4) * 1000);
  assert.ok(crates.every((crate) => !crate.incomingDelivery && crate.lift === 0 &&
    crate.sprite.visible && crate.sprite.body.enable));
  assert.equal(animation.status.textContent, "3 crates landed");
  assert.equal(next.sprite.visible, false);
  animation.update(1800);
  assert.equal(animation.active, null);
  animation.update(1);
  assert.equal(animation.active.crates[0].crate, next);
});

test("incoming crates cannot be picked up or emptied before landing", () => {
  const crate = {
    incomingDelivery: true, kind: "item", lockedToPad: true,
    isStationary: () => true, isSliding: () => false,
  };
  assert.equal(Crate.prototype.canPickUp.call(crate), false);
  assert.equal(Crate.prototype.canTake.call(crate, null, { orderId: "order" }), false);
  crate.incomingDelivery = false;
  assert.equal(Crate.prototype.canPickUp.call(crate), true);
  assert.equal(Crate.prototype.canTake.call(crate, null, { orderId: "order" }), true);
});
