// ==========================================
// FILE: InputDevice.js
// ==========================================
// Remembers whether the player last used the keyboard/mouse or a controller, so on-screen
// hints name the right button. The choice is mirrored to <body data-input-device>, where
// CSS shows .kbd-only or .pad-only hint text.

let currentDevice = "keyboard";

const KEYBOARD_LABELS = Object.freeze({
  interact: "E",
  crate: "Space",
  unpack: "Q",
  goBacks: "Q",
  tablet: "I",
  rotate: "R",
  cancel: "Esc",
});

const GAMEPAD_LABELS = Object.freeze({
  interact: "A",
  crate: "X",
  unpack: "Y",
  goBacks: "Y",
  tablet: "Back",
  rotate: "Y",
  cancel: "B",
});

export function getInputDevice() {
  return currentDevice;
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
 * @param {keyof KEYBOARD_LABELS} action
 * @param {"keyboard"|"gamepad"} [device]
 */
export function controlLabel(action, device = currentDevice) {
  const labels = device === "gamepad" ? GAMEPAD_LABELS : KEYBOARD_LABELS;
  if (!(action in labels)) throw new Error(`Unknown control action: ${action}`);
  return labels[action];
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
