// ==========================================
// FILE: ShelfPaint.js
// ==========================================
// Paint colors for shelves and registers. Budget Shelves are drawn from gray art
// (js/logic/TintableArt.js) and each shelf is tinted with its own paint; registers get a
// recolored copy of their art instead, so their lights and screen keep their own colors.
// Purple, the original color, is every new fixture's paint. The player changes one fixture's
// paint by holding the paint key in front of it (js/logic/FixturePaintWindow.js).
// See also: js/scenes/shelfColorLab.js (DEV room for trying colors).

const paint = (id, name, tint) => Object.freeze({ id, name, tint });

// In the order the paint window shows them.
export const SHELF_PAINTS = Object.freeze({
  purple: paint("purple", "Purple", 0xb89ff7),
  gray: paint("gray", "Gray", 0xffffff),
  steel: paint("steel", "Steel", 0x94a3b8),
  black: paint("black", "Black", 0x4b5563),
  red: paint("red", "Red", 0xef4444),
  orange: paint("orange", "Orange", 0xf97316),
  yellow: paint("yellow", "Yellow", 0xfacc15),
  green: paint("green", "Green", 0x22c55e),
  teal: paint("teal", "Teal", 0x14b8a6),
  blue: paint("blue", "Blue", 0x3b82f6),
  pink: paint("pink", "Pink", 0xec4899),
});

export const DEFAULT_SHELF_PAINT = "purple";

/** Shelves and registers: fixtures the player can change the color of. */
export function isPaintableFixture(spec) {
  return paintsWithTint(spec) || spec?.kind === "register";
}

/** Shelves whose art is drawn gray and tinted on the map. */
export function paintsWithTint(spec) {
  return spec?.artLayout === "budget";
}

/** @param {string} [paintId] - unknown or missing paints fall back to the default */
export function shelfPaintTint(paintId) {
  return (SHELF_PAINTS[paintId] ?? SHELF_PAINTS[DEFAULT_SHELF_PAINT]).tint;
}
