// ==========================================
// FILE: InputDevice.js
// ==========================================
// Remembers whether the player last used the keyboard/mouse or a controller, so on-screen
// hints name the right button. The choice is mirrored to <body data-input-device>, where
// CSS shows .kbd-only or .pad-only hint text.

import { actionBindingLabel } from "./KeyBindings.js";
import { controllerButtonFor } from "./ControllerBindings.js";

let currentDevice = "keyboard";
let controllerLabelStyle = null;
const CONTROLLER_LABELS_STORAGE_KEY = "space-arms-dealer.controller-label-style";
const CONTROLLER_LABEL_STYLES = Object.freeze(["automatic", "xbox", "playstation", "nintendo"]);

const GAMEPAD_LAYOUTS = Object.freeze({
  xbox: Object.freeze({
    0: "A", 1: "B", 2: "X", 3: "Y", 4: "LB", 5: "RB",
    8: "View", 9: "Start", 10: "Left stick click", 11: "Right stick click",
    leftTrigger: "LT", rightTrigger: "RT",
  }),
  playstation: Object.freeze({
    0: "✕", 1: "○", 2: "□", 3: "△", 4: "L1", 5: "R1",
    8: "Share/Create", 9: "Options", 10: "Left stick click (L3)", 11: "Right stick click (R3)",
    leftTrigger: "L2", rightTrigger: "R2",
  }),
  nintendo: Object.freeze({
    0: "B", 1: "A", 2: "Y", 3: "X", 4: "L", 5: "R",
    8: "Minus", 9: "Plus", 10: "Left stick click", 11: "Right stick click",
    leftTrigger: "ZL", rightTrigger: "ZR",
  }),
});

const GAMEPAD_ACTIONS = Object.freeze({
  interact: "interact",
  crate: "crate",
  putDown: "putDown",
  nextCrate: "nextCrate",
  dash: "cancel",
  highlightTrash: "highlightTrash",
  moveFixture: "interact",
  tablet: "tablet",
  rotate: "putDown",
  cancel: "cancel",
  cancelFixture: "crate",
  handOverChange: "putDown",
  place: "interact",
  tenderAdd: "interact",
  tenderRemove: "crate",
  start: "pause",
  zoomIn: "zoomIn",
  zoomOut: "zoomOut",
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
  controlHelp("Light up all trash and dirt on the floor (hold)", controlLabel("highlightTrash", "keyboard"), controlLabel("highlightTrash", "gamepad")),
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

export function controllerButtonLabel(button, style = getResolvedControllerLabelStyle()) {
  const layout = GAMEPAD_LAYOUTS[style];
  if (!layout || typeof layout[button] !== "string") throw new Error(`Unknown controller button: ${button}`);
  return layout[button];
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
 * Runs `fn` with hints naming `device`'s buttons, without changing this screen's own device.
 * Co-op uses it to word the friend's hints for whatever they play with.
 * @template T
 * @param {"keyboard"|"gamepad"} device
 * @param {() => T} fn
 * @returns {T}
 */
export function withInputDevice(device, fn) {
  const previous = currentDevice;
  currentDevice = device === "gamepad" ? "gamepad" : "keyboard";
  try {
    return fn();
  } finally {
    currentDevice = previous;
  }
}

/**
 * Button or key name for an action, e.g. "E" on keyboard or "A" on a controller.
 * @param {keyof typeof GAMEPAD_ACTIONS} action
 * @param {"keyboard"|"gamepad"} [device]
 */
export function controlLabel(action, device = currentDevice) {
  if (device === "gamepad") {
    const layout = GAMEPAD_LAYOUTS[getResolvedControllerLabelStyle()];
    if (action === "dash") {
      return `${controllerButtonLabel(controllerButtonFor("cancel"))} or a trigger (${layout.leftTrigger} or ${layout.rightTrigger})`;
    }
    if (action === "highlightTrash") {
      return `${controllerButtonLabel(controllerButtonFor("highlightTrash"))} (hold)`;
    }
    if (!(action in GAMEPAD_ACTIONS)) throw new Error(`Unknown control action: ${action}`);
    return controllerButtonLabel(controllerButtonFor(GAMEPAD_ACTIONS[action]));
  }
  if (!(action in GAMEPAD_ACTIONS) && !["dash", "highlightTrash"].includes(action)) {
    throw new Error(`Unknown control action: ${action}`);
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
