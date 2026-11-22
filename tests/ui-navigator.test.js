import test from "node:test";
import assert from "node:assert/strict";
import { UINavigator } from "../js/logic/UINavigator.js";
import { PAD } from "../js/input/GamepadInput.js";
import {
  controllerButtonFor, defaultControllerBindings, setControllerBindings, swapControllerBinding,
} from "../js/input/ControllerBindings.js";
import { setInputDevice } from "../js/input/InputDevice.js";

function setup(t) {
  const previous = new Map(["window", "document", "MouseEvent", "HTMLSelectElement"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class MouseEvent {
    constructor(type, options) { Object.assign(this, { type, detail: 0 }, options); }
  }
  const body = {
    dataset: {}, dispatchEvent() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 300 }),
  };
  globalThis.window = { PointerEvent: MouseEvent, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { body, getElementById: () => null };
  globalThis.MouseEvent = MouseEvent;
  globalThis.HTMLSelectElement = class {};
  setInputDevice("gamepad");
  t.after(() => {
    setInputDevice("keyboard");
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const navigator = new UINavigator();
  navigator.getScope = () => navigator.testScope;
  navigator.getTargets = () => navigator.testTargets.filter((element) => element.isConnected);
  navigator.testScope = {};
  navigator.testTargets = [];
  return navigator;
}

function target(dataset = {}, rect = { left: 0, top: 0, right: 20, bottom: 20 }) {
  return {
    dataset, isConnected: true, events: [],
    getBoundingClientRect: () => rect,
    closest: () => null,
    hasAttribute(name) {
      const key = name.replace(/^data-/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return key in this.dataset;
    },
    classList: { add() {}, remove() {} },
    dispatchEvent(event) { this.events.push(event); },
  };
}

const pad = (pressed = [], down = pressed) => ({
  justPressed: (button) => pressed.includes(button),
  isDown: (button) => down.includes(button),
  justPressedAction: (action) => pressed.includes(controllerButtonFor(action)),
  isActionDown: (action) => down.includes(controllerButtonFor(action)),
  rightStick: { y: 0 },
});

test("a controller click has mouse-click detail, not keyboard-click detail", (t) => {
  const navigator = setup(t);
  const button = target();
  navigator.click(button);
  assert.deepEqual(button.events.map(({ type, detail }) => [type, detail]),
    [["mousedown", 1], ["mouseup", 1], ["click", 1]]);
});

test("the remapped use button activates the focused menu item", (t) => {
  const navigator = setup(t);
  const defaults = defaultControllerBindings();
  const remapped = swapControllerBinding(defaults, "interact", PAD.RB).bindings;
  setControllerBindings(remapped);
  t.after(() => setControllerBindings(defaults));
  const button = target();
  navigator.testTargets = [button];

  navigator.handle(pad([PAD.RB]));
  assert.equal(button.events.find(({ type }) => type === "click")?.type, "click");
});

test("shelf controller holds keep the pointer down and release on button or screen changes", (t) => {
  const navigator = setup(t);
  const cell = target({ padHold: "" });
  navigator.testTargets = [cell];
  navigator.handle(pad([PAD.A]));
  navigator.handle(pad([], [PAD.A]), 500);
  assert.equal(cell.events.filter(({ type }) => type === "pointerdown").length, 1);
  navigator.handle(pad());
  assert.equal(cell.events.filter(({ type }) => type === "pointerup").length, 1);

  navigator.handle(pad([PAD.X]));
  const rightPress = cell.events.at(-1);
  assert.equal(rightPress.type, "pointerdown");
  assert.equal(rightPress.button, 2);
  assert.equal(rightPress.buttons, 2);
  navigator.focus(target());
  assert.equal(cell.events.filter(({ type }) => type === "pointerup").length, 2);
  navigator.focus(cell);
  navigator.handle(pad([PAD.X]));
  navigator.testScope = {};
  navigator.handle(pad([], [PAD.X]));
  assert.equal(cell.events.filter(({ type }) => type === "pointerup").length, 3);
});

test("held cash collection advances after removal and never repeats onto the next screen", (t) => {
  const navigator = setup(t);
  const drawer = target();
  const cash = [0, 1, 2].map((index) => target({ padRepeat: "80", padAutofocus: "", tenderIndex: String(index) }));
  let taken = 0;
  for (const bill of cash) {
    bill.dispatchEvent = (event) => {
      if (event.type !== "mousedown") return;
      bill.isConnected = false;
      taken += 1;
      if (taken === cash.length) {
        navigator.testScope = {};
        navigator.testTargets = [drawer];
      }
    };
  }
  navigator.testTargets = cash;
  navigator.handle(pad([PAD.A]));
  assert.equal(taken, 1);
  navigator.handle(pad([], [PAD.A]), 40);
  assert.equal(taken, 1);
  navigator.handle(pad(), 400);
  assert.equal(taken, 1, "release stops collection before the next item");
  navigator.handle(pad([PAD.A]));
  assert.equal(taken, 2);
  navigator.handle(pad([], [PAD.A]), 80);
  assert.equal(taken, 3);
  navigator.handle(pad([], [PAD.A]), 500);
  assert.equal(drawer.events.some(({ type }) => type === "mousedown"), false);
});

test("Supply left/right crosses between the item list and order buttons, keeping the selected row", (t) => {
  const navigator = setup(t);
  const row = target({ padRow: "", itemId: "item" });
  const clear = target({ supplyClear: "" }, { left: 200, top: 400, right: 280, bottom: 430 });
  const place = target({ supplyPlace: "" }, { left: 200, top: 450, right: 280, bottom: 480 });
  const panel = { contains: () => true };
  row.closest = (selector) => selector === ".supply-panel" ? panel : selector === ".supply-list" ? {} : null;
  for (const button of [clear, place]) {
    button.closest = (selector) => selector === ".supply-panel" ? panel : null;
    button.matches = () => true;
  }
  row.matches = () => false;
  const targets = [row, clear, place];
  navigator.focus(row);
  navigator.move("right", targets);
  assert.equal(navigator.focused, clear, "order buttons are reachable despite being far below the row");
  navigator.move("down", targets);
  assert.equal(navigator.focused, place);
  navigator.move("left", targets);
  assert.equal(navigator.focused, row);
});
