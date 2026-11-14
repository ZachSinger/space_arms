import assert from "node:assert/strict";
import { test } from "node:test";
import { ControlMode, CONTROL_MODES } from "../js/logic/ControlMode.js";

function createScene() {
  return {
    startingShift: false,
    loadFailed: false,
    fixturePlacement: { active: false },
    operatingRegister: false,
    carriedCrate: null,
    windowManager: { windows: new Map() },
  };
}

test("selects the active control mode by state priority", () => {
  const scene = createScene();
  const controls = new ControlMode(scene);
  assert.equal(controls.getMode(), CONTROL_MODES.WALKING);

  scene.carriedCrate = {};
  assert.equal(controls.getMode(), CONTROL_MODES.CARRYING);
  assert.equal(controls.allows("move"), true);

  scene.operatingRegister = true;
  assert.equal(controls.getMode(), CONTROL_MODES.REGISTER);
  assert.equal(controls.allows("move"), false);

  scene.windowManager.windows.set("manager-tablet", { id: "manager-tablet", isOpen: true });
  assert.equal(controls.getMode(), CONTROL_MODES.MODAL);

  scene.fixturePlacement.active = true;
  assert.equal(controls.getMode(), CONTROL_MODES.PLACING);

  scene.startingShift = true;
  assert.equal(controls.getMode(), CONTROL_MODES.LOADING);
});

test("register windows retain register controls, while other open windows take modal control", () => {
  const scene = createScene();
  scene.operatingRegister = true;
  scene.windowManager.windows.set("checkout-window", { id: "checkout-window", isOpen: true });
  const controls = new ControlMode(scene);
  assert.equal(controls.getMode(), CONTROL_MODES.REGISTER);
  assert.equal(controls.allows("interact"), true);

  scene.windowManager.windows.set("manager-tablet", { id: "manager-tablet", isOpen: true });
  assert.equal(controls.getMode(), CONTROL_MODES.MODAL);
  assert.equal(controls.allows("interact"), false);
  assert.equal(controls.allows("move"), false);
  assert.equal(controls.allows("pause"), false);
  assert.equal(controls.allows("debug"), false);
});

test("each mode exposes only its declared actions", () => {
  const scene = createScene();
  const controls = new ControlMode(scene);

  assert.equal(controls.allows("move"), true);
  assert.equal(controls.allows("debugGrid"), true);
  scene.fixturePlacement.active = true;
  assert.equal(controls.allows("rotateFixture"), true);
  assert.equal(controls.allows("debugGrid"), true);
  assert.equal(controls.allows("debug"), false);
  assert.equal(controls.allows("crate"), false);

  scene.fixturePlacement.active = false;
  assert.equal(controls.allows("rotateFixture"), false);
  scene.startingShift = true;
  assert.equal(controls.allows("pause"), false);
  assert.equal(controls.allows("debugGrid"), false);
});
