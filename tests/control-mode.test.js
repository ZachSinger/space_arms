import assert from "node:assert/strict";
import { test } from "node:test";
import { ControlMode, CONTROL_MODES } from "../js/input/ControlMode.js";

function createScene() {
  return {
    shift: { starting: false },
    loadFailed: false,
    fixturePlacement: { active: false },
    checkoutSystem: { operatingRegister: false },
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

  scene.checkoutSystem.operatingRegister = true;
  assert.equal(controls.getMode(), CONTROL_MODES.REGISTER);
  assert.equal(controls.allows("move"), false);

  scene.windowManager.windows.set("manager-tablet", { id: "manager-tablet", isOpen: true });
  assert.equal(controls.getMode(), CONTROL_MODES.MODAL);

  scene.fixturePlacement.active = true;
  assert.equal(controls.getMode(), CONTROL_MODES.PLACING);

  scene.shift.starting = true;
  assert.equal(controls.getMode(), CONTROL_MODES.LOADING);
});

test("register windows retain register controls, while other open windows take modal control", () => {
  const scene = createScene();
  scene.checkoutSystem.operatingRegister = true;
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

test("placement allows walking unless another window or controller menu has focus", () => {
  const scene = createScene();
  let tabletFocused = false;
  let controllerMenuOpen = false;
  const tablet = {
    id: "manager-tablet",
    isOpen: true,
    element: { classList: { contains: () => tabletFocused } },
  };
  scene.fixturePlacement = { active: true };
  scene.windowManager.windows.set(tablet.id, tablet);
  scene.uiNavigator = { hasScope: () => controllerMenuOpen };
  const controls = new ControlMode(scene);

  assert.equal(controls.getMode(), CONTROL_MODES.PLACING);
  assert.equal(controls.allows("move"), true);
  tabletFocused = true;
  assert.equal(controls.getMode(), CONTROL_MODES.MODAL);
  assert.equal(controls.allows("move"), false);
  tabletFocused = false;
  controllerMenuOpen = true;
  assert.equal(controls.getMode(), CONTROL_MODES.MODAL);
  assert.equal(controls.allows("move"), false);
  controllerMenuOpen = false;
  assert.equal(controls.allows("move"), true);
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
  scene.shift.starting = true;
  assert.equal(controls.allows("pause"), false);
  assert.equal(controls.allows("debugGrid"), false);
});

test("manual pause overrides register, placement and menus and allows only resume", () => {
  const scene = createScene();
  scene.shiftClock = { started: true, isPaused: true };
  scene.checkoutSystem.operatingRegister = true;
  scene.fixturePlacement.active = true;
  scene.windowManager.windows.set("manager-tablet", { id: "manager-tablet", isOpen: true });
  const controls = new ControlMode(scene);
  assert.equal(controls.getMode(), CONTROL_MODES.PAUSED);
  assert.equal(controls.allows("pause"), true);
  for (const action of ["move", "interact", "crate", "goBacks", "tablet", "debug", "debugGrid", "cameraZoom", "rotateFixture"]) {
    assert.equal(controls.allows(action), false, action);
  }
  scene.shiftClock.isPaused = false;
  assert.equal(controls.getMode(), CONTROL_MODES.PLACING);
});

test("a stopped pre-shift clock does not lock store management", () => {
  const scene = createScene();
  scene.shiftClock = { started: false, isPaused: true };
  const controls = new ControlMode(scene);
  assert.equal(controls.getMode(), CONTROL_MODES.WALKING);
  assert.equal(controls.allows("tablet"), true);
  scene.fixturePlacement.active = true;
  assert.equal(controls.allows("rotateFixture"), true);
});
