// Keyboard and mouse bindings are shared by the settings screen and the running game.
export const BINDING_GROUPS = Object.freeze([
  { title: "Movement", actions: [
    { id: "moveUp", label: "Walk up", defaults: ["KeyW", "ArrowUp"] },
    { id: "moveDown", label: "Walk down", defaults: ["KeyS", "ArrowDown"] },
    { id: "moveLeft", label: "Walk left", defaults: ["KeyA", "ArrowLeft"] },
    { id: "moveRight", label: "Walk right", defaults: ["KeyD", "ArrowRight"] },
    { id: "dash", label: "Dash", defaults: ["Shift", null] },
  ] },
  { title: "Shop", actions: [
    { id: "interact", label: "Use or open", defaults: ["KeyE", null] },
    { id: "crate", label: "Pick up crate; hand over change", defaults: ["Space", null] },
    { id: "putDown", label: "Put down crate; choose stocking crate", defaults: ["KeyQ", null] },
    { id: "nextCrate", label: "Move crate arrow / move fixture", defaults: ["Control", null] },
    { id: "highlightTrash", label: "Show trash", defaults: ["KeyH", null] },
  ] },
  { title: "Fixtures", actions: [
    { id: "rotate", label: "Rotate fixture", defaults: ["KeyR", null] },
    { id: "place", label: "Place fixture", defaults: ["Mouse0", null] },
    { id: "cancel", label: "Cancel fixture placement", defaults: ["Escape", "Mouse2"] },
  ] },
  { title: "Menus & camera", actions: [
    { id: "tablet", label: "Open / close tablet", defaults: ["KeyI", "Tab"] },
    { id: "pause", label: "Pause / resume", defaults: ["KeyP", "Escape"] },
    { id: "zoomIn", label: "Zoom in", defaults: ["PageUp", null] },
    { id: "zoomOut", label: "Zoom out", defaults: ["PageDown", null] },
  ] },
]);

const ACTIONS = BINDING_GROUPS.flatMap((group) => group.actions);
const STORAGE_KEY = "space-arms-dealer.key-bindings";
const SPECIAL_KEYS = new Set([
  "Space", "Tab", "Enter", "Backspace", "Delete", "Escape", "Shift", "Control", "Alt",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End",
  "Insert", "CapsLock", "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash",
  "Semicolon", "Quote", "Backquote", "Comma", "Period", "Slash",
]);
let current;

export function defaultBindings() {
  return Object.fromEntries(ACTIONS.map(({ id, defaults }) => [id, [...defaults]]));
}

function validBinding(value) {
  return value === null || (typeof value === "string" && (
    SPECIAL_KEYS.has(value) || /^Key[A-Z]$/.test(value) || /^Digit[0-9]$/.test(value) ||
    /^Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter)$/.test(value) ||
    /^F(?:[1-9]|1[0-2])$/.test(value) || /^Mouse[0-4]$/.test(value)
  ));
}

function sharedEscape(first, second, value) {
  return value === "Escape" && new Set([first, second]).size === 2 &&
    [first, second].every((id) => id === "pause" || id === "cancel");
}

export function validateBindings(bindings) {
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return false;
  for (const { id } of ACTIONS) {
    const pair = bindings[id];
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.some((value) => value !== null) ||
      !pair.every(validBinding) || (pair[0] !== null && pair[0] === pair[1])) return false;
  }
  for (let i = 0; i < ACTIONS.length; i += 1) {
    for (let j = i + 1; j < ACTIONS.length; j += 1) {
      const first = ACTIONS[i].id;
      const second = ACTIONS[j].id;
      if (bindings[first].some((value) => value !== null && bindings[second].includes(value) &&
        !sharedEscape(first, second, value))) return false;
    }
  }
  return true;
}

export function getBindings() {
  if (!current) {
    current = defaultBindings();
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (!validateBindings(parsed)) throw new Error("Invalid saved control bindings");
          current = parsed;
        } catch (error) {
          console.error("Could not load control bindings; using defaults:", error);
        }
      }
    }
  }
  return Object.fromEntries(ACTIONS.map(({ id }) => [id, [...current[id]]]));
}

export function setBindings(bindings, { persist = false } = {}) {
  if (!validateBindings(bindings)) throw new Error("Invalid control bindings");
  if (persist) localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  current = Object.fromEntries(ACTIONS.map(({ id }) => [id, [...bindings[id]]]));
}

export function bindingForEvent(event) {
  if (typeof event.button === "number" &&
    (event.type?.startsWith("mouse") || event.type?.startsWith("pointer"))) return `Mouse${event.button}`;
  const code = event.code || (event.key === " " ? "Space" : event.key);
  if (/^Shift(?:Left|Right)$/.test(code)) return "Shift";
  if (/^Control(?:Left|Right)$/.test(code)) return "Control";
  if (/^Alt(?:Left|Right)$/.test(code)) return "Alt";
  return validBinding(code) ? code : null;
}

export function matchesBinding(action, event) {
  const binding = bindingForEvent(event);
  return binding !== null && isBound(action, binding);
}

export function isBound(action, binding) {
  if (!current) getBindings();
  return current[action]?.includes(binding) ?? false;
}

export function isBoundAnywhere(binding) {
  if (!current) getBindings();
  return Object.values(current).some((pair) => pair.includes(binding));
}

export function isWorldMouseBinding(event) {
  const binding = bindingForEvent(event);
  return Boolean(binding?.startsWith("Mouse")) && [
    "moveUp", "moveDown", "moveLeft", "moveRight", "dash", "interact", "crate", "putDown",
    "nextCrate", "highlightTrash", "tablet", "pause", "zoomIn", "zoomOut",
  ].some((action) => isBound(action, binding));
}

export function bindingLabel(binding) {
  if (!binding) return "—";
  const labels = {
    Mouse0: "Left click", Mouse1: "Middle click", Mouse2: "Right click",
    Mouse3: "Mouse button 4", Mouse4: "Mouse button 5",
    Control: "Ctrl", Escape: "Esc", ArrowUp: "Up arrow", ArrowDown: "Down arrow",
    ArrowLeft: "Left arrow", ArrowRight: "Right arrow", Space: "Space",
  };
  if (labels[binding]) return labels[binding];
  if (binding.startsWith("Key")) return binding.slice(3);
  if (binding.startsWith("Digit")) return binding.slice(5);
  if (binding.startsWith("Numpad")) return `Numpad ${binding.slice(6)}`;
  return binding.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function actionBindingLabel(action) {
  if (!current) getBindings();
  return current[action].filter(Boolean).map(bindingLabel).join(" or ");
}

export function bindingConflict(bindings, action, slot, value) {
  for (const { id, label } of ACTIONS) {
    for (let index = 0; index < 2; index += 1) {
      if (id === action && index === slot) continue;
      if (bindings[id][index] === value && !sharedEscape(id, action, value)) return label;
    }
  }
  return null;
}
