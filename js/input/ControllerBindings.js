// Controller actions use the standard Gamepad API button indexes. Sticks, triggers,
// and the D-pad keep their existing movement, dash, and navigation behavior.
export const CONTROLLER_ACTIONS = Object.freeze([
  { id: "interact", label: "Use, open, or place a fixture", defaultButton: 0 },
  { id: "crate", label: "Pick up a crate; cancel fixture placement", defaultButton: 2 },
  { id: "putDown", label: "Put down a crate; turn a fixture", defaultButton: 3 },
  { id: "nextCrate", label: "Move the crate arrow", defaultButton: 11 },
  { id: "highlightTrash", label: "Show trash (hold)", defaultButton: 10 },
  { id: "tablet", label: "Open or close the tablet", defaultButton: 8 },
  { id: "pause", label: "Open the menu or pause", defaultButton: 9 },
  { id: "cancel", label: "Go back, leave the register, or dash", defaultButton: 1 },
  { id: "zoomOut", label: "Zoom out or previous tab", defaultButton: 4 },
  { id: "zoomIn", label: "Zoom in or next tab", defaultButton: 5 },
]);

const STORAGE_KEY = "space-arms-dealer.controller-bindings";
const ASSIGNABLE_BUTTONS = new Set(CONTROLLER_ACTIONS.map(({ defaultButton }) => defaultButton));
let current;

export function defaultControllerBindings() {
  return Object.fromEntries(CONTROLLER_ACTIONS.map(({ id, defaultButton }) => [id, defaultButton]));
}

export function validateControllerBindings(bindings) {
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return false;
  const ids = CONTROLLER_ACTIONS.map(({ id }) => id);
  if (Object.keys(bindings).length !== ids.length || ids.some((id) => !Object.hasOwn(bindings, id))) return false;
  const buttons = ids.map((id) => bindings[id]);
  return buttons.every((button) => Number.isInteger(button) && ASSIGNABLE_BUTTONS.has(button)) &&
    new Set(buttons).size === buttons.length;
}

export function getControllerBindings() {
  if (!current) {
    current = defaultControllerBindings();
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (!validateControllerBindings(parsed)) throw new Error("Invalid saved controller bindings");
          current = parsed;
        } catch (error) {
          console.error("Could not load controller bindings; using defaults:", error);
        }
      }
    }
  }
  return { ...current };
}

export function setControllerBindings(bindings, { persist = false } = {}) {
  if (!validateControllerBindings(bindings)) throw new Error("Invalid controller bindings");
  if (persist && typeof window !== "undefined" && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  }
  current = Object.fromEntries(CONTROLLER_ACTIONS.map(({ id }) => [id, bindings[id]]));
}

export function controllerButtonFor(action) {
  if (!current) getControllerBindings();
  if (!Object.hasOwn(current, action)) throw new Error(`Unknown controller action: ${action}`);
  return current[action];
}

export function swapControllerBinding(bindings, action, button) {
  if (!validateControllerBindings(bindings)) throw new Error("Invalid controller bindings");
  if (!Object.hasOwn(bindings, action)) throw new Error(`Unknown controller action: ${action}`);
  if (!ASSIGNABLE_BUTTONS.has(button)) throw new Error("That controller button cannot be assigned");
  const updated = { ...bindings };
  const replacedAction = CONTROLLER_ACTIONS.find(({ id }) => bindings[id] === button)?.id;
  if (replacedAction && replacedAction !== action) updated[replacedAction] = bindings[action];
  updated[action] = button;
  return { bindings: updated, replacedAction: replacedAction === action ? null : replacedAction };
}
