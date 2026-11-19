import assert from "node:assert/strict";
import test from "node:test";
import { ShiftClock, SHIFT_DURATION_MS } from "../js/logic/ShiftClock.js";

test("a shift reaches soft close after seven unpaused minutes", () => {
  assert.equal(SHIFT_DURATION_MS, 420_000);
  const clock = new ShiftClock();
  clock.update(420_000);
  assert.equal(clock.elapsedHours, 0);
  assert.equal(clock.started, false);

  clock.startNewShift();
  assert.equal(clock.getFormattedTime(), "08:00");
  clock.update(210_000);
  assert.equal(clock.elapsedHours, 6);
  assert.equal(clock.getElapsedMs(), 210_000);
  assert.equal(clock.getFormattedTime(), "14:00");

  clock.update(209_999);
  assert.equal(clock.softClosed, false);
  assert.equal(clock.getFormattedTime(), "19:59");
  clock.update(1);
  assert.equal(clock.softClosed, true);
  assert.equal(clock.elapsedHours, 12);
  assert.equal(clock.getElapsedMs(), SHIFT_DURATION_MS);
  assert.equal(clock.getFormattedTime(), "20:00");

  clock.update(60_000);
  assert.equal(clock.elapsedHours, 12);
});

test("regular frame updates do not close a shift before seven minutes", () => {
  const clock = new ShiftClock();
  clock.startNewShift();

  for (let elapsedMs = 16; elapsedMs < 420_000; elapsedMs += 16) {
    clock.update(16);
  }
  assert.equal(clock.softClosed, false);
  clock.update(16);
  assert.equal(clock.softClosed, true);
});

test("pausing extends the shift without advancing the clock", () => {
  const clock = new ShiftClock();
  clock.startNewShift();
  clock.update(210_000);
  clock.togglePause();
  clock.update(420_000);
  assert.equal(clock.elapsedHours, 6);
  assert.equal(clock.getElapsedMs(), 210_000);
  assert.equal(clock.softClosed, false);

  clock.togglePause();
  clock.update(209_999);
  assert.equal(clock.softClosed, false);
  clock.update(1);
  assert.equal(clock.softClosed, true);
});

test("a new shift resets the clock after soft close", () => {
  const clock = new ShiftClock();
  clock.startNewShift();
  clock.update(420_000);
  assert.equal(clock.softClosed, true);

  clock.startNewShift();
  assert.equal(clock.elapsedHours, 0);
  assert.equal(clock.started, true);
  assert.equal(clock.isPaused, false);
  assert.equal(clock.softClosed, false);
  assert.equal(clock.getFormattedTime(), "08:00");
});
