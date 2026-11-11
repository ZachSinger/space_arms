import test from "node:test";
import assert from "node:assert/strict";
import { GamepadInput, PAD, applyDeadzone } from "../js/logic/GamepadInput.js";
import { pickNeighbor, pickNearest } from "../js/logic/PadNavigation.js";
import { controlLabel, getInputDevice, setInputDevice, watchKeyboardAndMouse } from "../js/logic/InputDevice.js";

function fakePad() {
  const state = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  const input = new GamepadInput(() => [{ connected: true, buttons: state.buttons, axes: state.axes }]);
  const press = (button, pressed = true) => {
    state.buttons[button] = { pressed, value: pressed ? 1 : 0 };
  };
  return { state, input, press };
}

test("the first poll only notes what is already held", () => {
  const { input, press } = fakePad();
  press(PAD.A);
  input.poll(0);
  assert.equal(input.justPressed(PAD.A), false);
  assert.equal(input.hadInput, false);
  input.poll(16);
  assert.equal(input.justPressed(PAD.A), false, "still the same hold");
  press(PAD.A, false);
  input.poll(32);
  press(PAD.A);
  input.poll(48);
  assert.equal(input.justPressed(PAD.A), true);
  assert.equal(input.hadInput, true);
  input.poll(64);
  assert.equal(input.justPressed(PAD.A), false, "a press fires once");
  assert.equal(input.isDown(PAD.A), true);
});

test("triggers count as pressed past halfway", () => {
  const { state, input } = fakePad();
  input.poll(0);
  state.buttons[PAD.RT] = { pressed: false, value: 0.4 };
  input.poll(16);
  assert.equal(input.wantsDash(), false);
  state.buttons[PAD.RT] = { pressed: false, value: 0.8 };
  input.poll(32);
  assert.equal(input.wantsDash(), true);
});

test("holding B dashes", () => {
  const { input, press } = fakePad();
  input.poll(0);
  press(PAD.B);
  input.poll(16);
  assert.equal(input.wantsDash(), true);
});

test("small stick drift is ignored and the rest rescales from zero", () => {
  assert.deepEqual(applyDeadzone(0.1, 0.1), { x: 0, y: 0 });
  const full = applyDeadzone(1, 0);
  assert.equal(full.x, 1);
  const half = applyDeadzone(0.625, 0);
  assert.ok(Math.abs(half.x - 0.5) < 1e-9);
});

test("the D-pad walks at full speed and wins over the stick", () => {
  const { state, input, press } = fakePad();
  input.poll(0);
  state.axes[0] = -1;
  input.poll(16);
  assert.deepEqual(input.moveVector(), { x: -1, y: 0 });
  press(PAD.RIGHT);
  press(PAD.DOWN);
  input.poll(32);
  assert.deepEqual(input.moveVector(), { x: 1, y: 1 });
});

test("a held direction moves the menu cursor once, then repeats", () => {
  const { input, press } = fakePad();
  input.poll(0);
  press(PAD.DOWN);
  input.poll(100);
  assert.equal(input.navDirection, "down");
  input.poll(200);
  assert.equal(input.navDirection, null);
  input.poll(480);
  assert.equal(input.navDirection, "down", "repeats after the first delay");
  input.poll(500);
  assert.equal(input.navDirection, null);
  input.poll(600);
  assert.equal(input.navDirection, "down", "then repeats faster");
});

test("a direction held from the previous screen is ignored until released", () => {
  const { state, input } = fakePad();
  state.axes[1] = 1;
  input.poll(0);
  input.poll(5000);
  assert.equal(input.navDirection, null);
  state.axes[1] = 0;
  input.poll(5016);
  state.axes[1] = 1;
  input.poll(5032);
  assert.equal(input.navDirection, "down");
});

test("no controller means nothing is connected or pressed", () => {
  const input = new GamepadInput(() => [null, null]);
  input.poll(0);
  input.poll(16);
  assert.equal(input.connected, false);
  assert.equal(input.hadInput, false);
  assert.deepEqual(input.moveVector(), { x: 0, y: 0 });
});

const box = (left, top, size = 10) => ({ left, top, right: left + size, bottom: top + size });

test("the menu cursor moves to the lined-up neighbor before a closer diagonal one", () => {
  const candidates = [
    { rect: box(100, 0), item: "same row, far" },
    { rect: box(30, 40), item: "diagonal, near" },
    { rect: box(-50, 0), item: "behind" },
  ];
  assert.equal(pickNeighbor(box(0, 0), candidates, "right"), "same row, far");
  assert.equal(pickNeighbor(box(0, 0), candidates, "down"), "diagonal, near");
  assert.equal(pickNeighbor(box(0, 0), candidates, "left"), "behind");
  assert.equal(pickNeighbor(box(0, 0), candidates, "up"), null);
});

test("the nearest target is picked when the cursor's target disappears", () => {
  const candidates = [{ rect: box(0, 0), item: "a" }, { rect: box(50, 50), item: "b" }];
  assert.equal(pickNearest({ x: 52, y: 60 }, candidates), "b");
  assert.equal(pickNearest({ x: 0, y: 0 }, []), null);
});

test("on-screen prompts name the key or the controller button", () => {
  assert.equal(controlLabel("interact", "keyboard"), "E");
  assert.equal(controlLabel("interact", "gamepad"), "A");
  assert.equal(controlLabel("crate", "gamepad"), "X");
  assert.equal(controlLabel("unpack", "keyboard"), "Q");
  assert.equal(controlLabel("unpack", "gamepad"), "Y");
  assert.equal(controlLabel("goBacks", "gamepad"), "Y");
  assert.throws(() => controlLabel("jump"));
});

test("real keyboard or mouse use switches prompts back; faked controller clicks don't", () => {
  const listeners = {};
  const target = { addEventListener: (type, fn) => (listeners[type] = fn), removeEventListener: () => {} };
  const stop = watchKeyboardAndMouse(target);
  setInputDevice("gamepad");
  listeners.mousedown({ type: "mousedown", isTrusted: false });
  assert.equal(getInputDevice(), "gamepad");
  listeners.mousemove({ type: "mousemove", isTrusted: true, movementX: 0, movementY: 0 });
  assert.equal(getInputDevice(), "gamepad");
  listeners.keydown({ type: "keydown", isTrusted: true });
  assert.equal(getInputDevice(), "keyboard");
  stop();
});