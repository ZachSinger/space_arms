import assert from "node:assert/strict";
import test from "node:test";
import { EventBus } from "../js/logic/EventBus.js";

test("events notify only their subscribers with the original payload", () => {
  const bus = new EventBus();
  const received = [];
  bus.on("sale", (payload) => received.push(payload));
  bus.on("shift", (payload) => received.push(payload));
  const sale = { total: 25 };

  bus.emit("sale", sale);

  assert.deepEqual(received, [sale]);
  assert.equal(received[0], sale);
});

test("unsubscribe is safe to call more than once", () => {
  const bus = new EventBus();
  let calls = 0;
  const unsubscribe = bus.on("sale", () => { calls += 1; });

  unsubscribe();
  unsubscribe();
  bus.emit("sale", {});

  assert.equal(calls, 0);
});

test("listeners added during dispatch start receiving events on the next emit", () => {
  const bus = new EventBus();
  const calls = [];
  bus.on("sale", () => {
    calls.push("first");
    bus.on("sale", () => calls.push("late"));
  });

  bus.emit("sale", {});
  assert.deepEqual(calls, ["first"]);
  bus.emit("sale", {});
  assert.deepEqual(calls, ["first", "first", "late"]);
});

test("clear removes every subscriber", () => {
  const bus = new EventBus();
  let calls = 0;
  bus.on("sale", () => { calls += 1; });
  bus.on("shift", () => { calls += 1; });

  bus.clear();
  bus.emit("sale", {});
  bus.emit("shift", {});

  assert.equal(calls, 0);
});

test("invalid subscriptions fail explicitly", () => {
  const bus = new EventBus();

  assert.throws(() => bus.on("", () => {}), /Event name is required/);
  assert.throws(() => bus.on("sale", null), /must be a function/);
});
