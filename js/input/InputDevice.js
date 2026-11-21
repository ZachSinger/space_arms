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
  putDown: "Q",
  nextCrate: "Ctrl",
  moveFixture: "Ctrl",
  dash: "Shift",
  highlightTrash: "H",
  goBacks: "Q",
  tablet: "I or Tab",
  rotate: "R",
  cancel: "Esc",
  handOverChange: "Space",
});

const GAMEPAD_LABELS = Object.freeze({
  interact: "A",
  crate: "X",
  putDown: "Y",
  nextCrate: "Right stick click",
  moveFixture: "A",
  dash: "B or a trigger",
  highlightTrash: "Not on controller yet",
  goBacks: "Y",
  tablet: "Back / View",
  rotate: "Y",
  cancel: "B",
  handOverChange: "Y",
});

const controlHelp = (label, keyboard, gamepad) => Object.freeze({ label, keyboard, gamepad });

export const CONTROL_HELP = Object.freeze([
  controlHelp("Walk", "WASD or arrow keys", "Left stick or D-pad"),
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
  controlHelp("Pause or resume the shift", "P or Esc (when not paused, Esc closes an open window first)",
    "Start, then PAUSE; Start to resume"),
  controlHelp("Zoom (sales floor only)", "Page Up / Page Down", "LB / RB"),
  controlHelp("Move a fixture while placing it", "Mouse", "Right stick"),
  controlHelp("Turn a fixture or shelf item", controlLabel("rotate", "keyboard"), controlLabel("rotate", "gamepad")),
  controlHelp("Cancel fixture placement", "Esc or right-click", "X"),
  controlHelp("Cancel other actions", "Esc or right-click", controlLabel("cancel", "gamepad")),
]);

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
