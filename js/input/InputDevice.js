// ==========================================
// FILE: InputDevice.js
// ==========================================
// Remembers whether the player last used the keyboard/mouse or a controller, so on-screen
// hints name the right button. The choice is mirrored to <body data-input-device>, where
// CSS shows .kbd-only or .pad-only hint text.

import { actionBindingLabel } from "./KeyBindings.js";

let currentDevice = "keyboard";
let controllerLabelStyle = null;
const CONTROLLER_LABELS_STORAGE_KEY = "space-arms-dealer.controller-label-style";
const CONTROLLER_LABEL_STYLES = Object.freeze(["automatic", "xbox", "playstation", "nintendo"]);

const GAMEPAD_ACTIONS = Object.freeze({
  interact: "bottom",
  crate: "left",
  putDown: "top",
  nextCrate: "rightStick",
  moveFixture: "bottom",
  dash: "dash",
  highlightTrash: "highlightTrash",
  tablet: "back",
  rotate: "top",
  cancel: "right",
  cancelFixture: "left",
  handOverChange: "top",
  place: "bottom",
  tenderAdd: "bottom",
  tenderRemove: "left",
  start: "start",
  zoomIn: "rightBumper",
  zoomOut: "leftBumper",
});

const GAMEPAD_LAYOUTS = Object.freeze({
  xbox: Object.freeze({
    bottom: "A", right: "B", left: "X", top: "Y",
    leftBumper: "LB", rightBumper: "RB", leftTrigger: "LT", rightTrigger: "RT",
    back: "View", start: "Start", rightStick: "Right stick click",
    dash: "B or a trigger (LT or RT)", highlightTrash: "Not on controller yet",
  }),
  playstation: Object.freeze({
    bottom: "✕", right: "○", left: "□", top: "△",
    leftBumper: "L1", rightBumper: "R1", leftTrigger: "L2", rightTrigger: "R2",
    back: "Share/Create", start: "Options", rightStick: "Right stick click",
    dash: "○ or a trigger (L2 or R2)", highlightTrash: "Not on controller yet",
  }),
  nintendo: Object.freeze({
    bottom: "B", right: "A", left: "Y", top: "X",
    leftBumper: "L", rightBumper: "R", leftTrigger: "ZL", rightTrigger: "ZR",
    back: "Minus", start: "Plus", rightStick: "Right stick click",
    dash: "A or a trigger (ZL or ZR)", highlightTrash: "Not on controller yet",
  }),
});

const controlHelp = (label, keyboard, gamepad) => Object.freeze({ label, keyboard, gamepad });

export function getControlHelp() { return [
  controlHelp("Walk up", actionBindingLabel("moveUp"), "Left stick or D-pad up"),
  controlHelp("Walk down", actionBindingLabel("moveDown"), "Left stick or D-pad down"),
  controlHelp("Walk left", actionBindingLabel("moveLeft"), "Left stick or D-pad left"),
  controlHelp("Walk right", actionBindingLabel("moveRight"), "Left stick or D-pad right"),
  controlHelp("Dash (uses stamina)", `Hold ${controlLabel("dash", "keyboard")}`, `Hold ${controlLabel("dash", "gamepad")}`),
  controlHelp("Use or open", controlLabel("interact", "keyboard"), controlLabel("interact", "gamepad")),
  controlHelp("Pick up a crate (hold: the whole stack from the arrow up)", controlLabel("crate", "keyboard"), controlLabel("crate", "gamepad")),
  controlHelp("Throw your crate (carrying just one, while walking, no arrow)", controlLabel("crate", "keyboard"), controlLabel("crate", "gamepad")),
  controlHelp("Light up all trash on the floor (hold)", controlLabel("highlightTrash", "keyboard"), controlLabel("highlightTrash", "gamepad")),
  controlHelp("Put a crate down (hold: your whole stack)", controlLabel("putDown", "keyboard"), controlLabel("putDown", "gamepad")),
  controlHelp("Move the green arrow one crate down", controlLabel("nextCrate", "keyboard"), controlLabel("nextCrate", "gamepad")),
  controlHelp(
    "Pick up a fixture to move it (facing it, empty hands, store closed)",
    `Hold ${controlLabel("moveFixture", "keyboard")}`,
    `Hold ${controlLabel("moveFixture", "gamepad")}`,
  ),
  controlHelp("Manager's Tablet", controlLabel("tablet", "keyboard"), controlLabel("tablet", "gamepad")),
  controlHelp("Pause or resume the shift", `${actionBindingLabel("pause")} (Esc closes an open window first)`,
    `${controlLabel("start", "gamepad")} opens the menu; choose PAUSE. Press ${controlLabel("start", "gamepad")} to resume`),
  controlHelp("Zoom in (sales floor only)", actionBindingLabel("zoomIn"), controlLabel("zoomIn", "gamepad")),
  controlHelp("Zoom out (sales floor only)", actionBindingLabel("zoomOut"), controlLabel("zoomOut", "gamepad")),
  controlHelp("Move a fixture while placing it", "Mouse", "Right stick"),
  controlHelp("Turn a fixture", controlLabel("rotate", "keyboard"), controlLabel("rotate", "gamepad")),
  controlHelp("Place a fixture", controlLabel("place", "keyboard"), controlLabel("place", "gamepad")),
  controlHelp("Cancel fixture placement", controlLabel("cancelFixture", "keyboard"), controlLabel("cancelFixture", "gamepad")),
  controlHelp("Close other windows", "Esc", controlLabel("cancel", "gamepad")),
]; }

export function getInputDevice() {
  return currentDevice;
}

export function getControllerLabelStyle() {
  if (controllerLabelStyle) return controllerLabelStyle;
  const saved = typeof window === "undefined"
    ? null
    : window.localStorage.getItem(CONTROLLER_LABELS_STORAGE_KEY);
  controllerLabelStyle = CONTROLLER_LABEL_STYLES.includes(saved) ? saved : "automatic";
  return controllerLabelStyle;
}

/**
 * @param {string} id
 * @returns {"xbox"|"playstation"|"nintendo"|null}
 */
export function detectControllerLabelStyle(id) {
  const name = String(id).toLowerCase();
  if (/playstation|dualshock|dualsense|sony|vendor:\s*054c/.test(name)) return "playstation";
  if (/nintendo|joy.con|switch|vendor:\s*057e/.test(name)) return "nintendo";
  if (/xbox|xinput|microsoft|vendor:\s*045e/.test(name)) return "xbox";
  return null;
}

export function getResolvedControllerLabelStyle() {
  const preference = getControllerLabelStyle();
  if (preference !== "automatic") return preference;

  if (typeof navigator !== "undefined" && navigator.getGamepads) {
    for (const pad of navigator.getGamepads()) {
      if (!pad || pad.connected === false) continue;
      const detected = detectControllerLabelStyle(pad.id);
      if (detected) return detected;
    }
  }
  return "xbox";
}

/**
 * @param {"automatic"|"xbox"|"playstation"|"nintendo"} style
 * @param {{persist?: boolean}} [options]
 */
export function setControllerLabelStyle(style, { persist = false } = {}) {
  if (!CONTROLLER_LABEL_STYLES.includes(style)) throw new Error(`Unknown controller label style: ${style}`);
  controllerLabelStyle = style;
  if (persist && typeof window !== "undefined") {
    window.localStorage.setItem(CONTROLLER_LABELS_STORAGE_KEY, style);
  }
}

/**
 * @param {"keyboard"|"gamepad"} device
 */
export function setInputDevice(device) {
  if (device === currentDevice) return;
  currentDevice = device;
  if (typeof document !== "undefined" && document.body) document.body.dataset.inputDevice = device;
}

/**
 * Button or key name for an action, e.g. "E" on keyboard or "A" on a controller.
 * @param {keyof typeof GAMEPAD_ACTIONS} action
 * @param {"keyboard"|"gamepad"} [device]
 */
export function controlLabel(action, device = currentDevice) {
  if (!(action in GAMEPAD_ACTIONS)) throw new Error(`Unknown control action: ${action}`);
  if (device === "gamepad") {
    const layout = GAMEPAD_LAYOUTS[getResolvedControllerLabelStyle()];
    return layout[GAMEPAD_ACTIONS[action]];
  }
  const mapped = { moveFixture: "nextCrate", handOverChange: "crate", cancelFixture: "cancel" }[action] ?? action;
  return actionBindingLabel(mapped);
}

/**
 * Real key presses and mouse use switch hints back to the keyboard. Events the controller
 * menu cursor fakes are untrusted, so they never count.
 * @returns {() => void} stop watching
 */
export function watchKeyboardAndMouse(target = window) {
  if (typeof document !== "undefined" && document.body) document.body.dataset.inputDevice = currentDevice;
  const useKeyboard = (event) => {
    if (!event.isTrusted) return;
    if (event.type === "mousemove" && !event.movementX && !event.movementY) return;
    setInputDevice("keyboard");
  };
  const events = ["keydown", "mousedown", "mousemove", "wheel"];
  for (const type of events) target.addEventListener(type, useKeyboard, true);
  return () => {
    for (const type of events) target.removeEventListener(type, useKeyboard, true);
  };
}
