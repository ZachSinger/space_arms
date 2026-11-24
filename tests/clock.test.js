import { test } from "node:test";
import assert from "node:assert/strict";
import { PausableTimers } from "../js/core/Clock.js";

// A fake clock: `advance` moves real time forward and fires anything that came due.
function fakeHost() {
  let realMs = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    now: () => realMs,
    schedule: (callback, ms) => {
      const id = nextId++;
      pending.set(id, { at: realMs + ms, callback });
      return id;
    },
    unschedule: (id) => pending.delete(id),
    advance(ms) {
      const end = realMs + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        realMs = due[1].at;
        due[1].callback();
      }
      realMs = end;
    },
  };
}

test("a delay waits out a pause and finishes the time it had left", () => {
  const host = fakeHost();
  const timers = new PausableTimers(host);
  let fired = false;
  timers.after(1000, () => { fired = true; });

  host.advance(400);
  timers.setPaused(true);
  host.advance(5000);
  assert.equal(fired, false);

  timers.setPaused(false);
  host.advance(599);
  assert.equal(fired, false);
  host.advance(1);
  assert.equal(fired, true);
});

test("a repeating timer reports only unpaused time between ticks", () => {
  const host = fakeHost();
  const timers = new PausableTimers(host);
  const ticks = [];
  timers.every(100, (elapsed) => ticks.push(elapsed));

  host.advance(50);
  timers.setPaused(true);
  host.advance(10000);
  timers.setPaused(false);
  host.advance(150);

  assert.deepEqual(ticks, [100, 100]);
  assert.equal(timers.now(), 200);
});

test("cancelled and cleared timers never fire", () => {
  const host = fakeHost();
  const timers = new PausableTimers(host);
  let calls = 0;
  const handle = timers.after(10, () => { calls += 1; });
  timers.every(10, () => { calls += 1; });

  handle.cancel();
  timers.clear();
  host.advance(1000);

  assert.equal(calls, 0);
});
