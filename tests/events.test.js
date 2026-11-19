import assert from "node:assert/strict";
import test from "node:test";
import { Events, GAME_EVENTS, createBatchedNotifier } from "../js/core/Events.js";

test("events notify only their subscribers with the original payload", () => {
  const bus = new Events();
  const received = [];
  bus.on("sale", (payload) => received.push(payload));
  bus.on("shift", (payload) => received.push(payload));
  const sale = { total: 25 };

  bus.emit("sale", sale);

  assert.deepEqual(received, [sale]);
  assert.equal(received[0], sale);
});

test("unsubscribe is safe to call more than once", () => {
  const bus = new Events();
  let calls = 0;
  const unsubscribe = bus.on("sale", () => { calls += 1; });

  unsubscribe();
  unsubscribe();
  bus.emit("sale", {});

  assert.equal(calls, 0);
});

test("listeners added during dispatch start receiving events on the next emit", () => {
  const bus = new Events();
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
  const bus = new Events();
  let calls = 0;
  bus.on("sale", () => { calls += 1; });
  bus.on("shift", () => { calls += 1; });

  bus.clear();
  bus.emit("sale", {});
  bus.emit("shift", {});

  assert.equal(calls, 0);
});

test("invalid subscriptions fail explicitly", () => {
  const bus = new Events();

  assert.throws(() => bus.on("", () => {}), /Event name is required/);
  assert.throws(() => bus.on("sale", null), /must be a function/);
});

test("an event announced while another is being handled waits until that one is finished", () => {
  const bus = new Events();
  const calls = [];
  bus.on("sale", () => {
    calls.push("sale-1");
    bus.emit("shift", {});
  });
  bus.on("sale", () => calls.push("sale-2"));
  bus.on("shift", () => calls.push("shift"));

  bus.emit("sale", {});

  assert.deepEqual(calls, ["sale-1", "sale-2", "shift"]);
});

test("a listener error doesn't leave later events stuck in the queue", () => {
  const bus = new Events();
  const calls = [];
  bus.on("sale", () => {
    bus.emit("shift", {});
    throw new Error("boom");
  });
  bus.on("shift", () => calls.push("shift"));

  assert.throws(() => bus.emit("sale", {}), /boom/);
  bus.emit("shift", {});

  assert.deepEqual(calls, ["shift"]);
});

test("once listens for one event only, and a group unsubscribes together", () => {
  const bus = new Events();
  let onceCalls = 0;
  let groupCalls = 0;
  bus.once("sale", () => { onceCalls += 1; });
  const group = bus.group();
  group.on("sale", () => { groupCalls += 1; });
  group.on("shift", () => { groupCalls += 1; });

  bus.emit("sale", {});
  bus.emit("sale", {});
  group.off();
  bus.emit("shift", {});

  assert.equal(onceCalls, 1);
  assert.equal(groupCalls, 2);
});

test("strict mode only accepts the game's own event names", () => {
  const bus = new Events({ strict: true });

  assert.throws(() => bus.emit("sael", {}), /Unknown event "sael"/);
  assert.throws(() => bus.on("sael", () => {}), /Unknown event/);
  assert.doesNotThrow(() => bus.emit(GAME_EVENTS.SHIFT_STARTED, {}));
});

test("the batched notifier collapses many changes into one call per flush", () => {
  let calls = 0;
  const notifier = createBatchedNotifier(() => { calls += 1; });

  notifier.notify();
  notifier.notify();
  notifier.flush();
  notifier.flush();

  assert.equal(calls, 1);
});
