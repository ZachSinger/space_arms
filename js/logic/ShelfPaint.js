// ==========================================
// FILE: ShelfPaint.js
// ==========================================
// Shelf paint colors. Budget Shelves are drawn from gray art (js/logic/TintableArt.js) and
// each shelf is tinted with its own paint, so later paints can be unlocked or mixed and put
// on one shelf at a time. Purple, the shelves' original color, is every new shelf's paint.
// See also: js/scenes/shelfColorLab.js (DEV room for trying colors).

export const SHELF_PAINTS = Object.freeze({
  purple: Object.freeze({ id: "purple", name: "Purple", tint: 0xb89ff7 }),
});

export const DEFAULT_SHELF_PAINT = "purple";

/** Shelves whose art is drawn gray and painted. */
export function isPaintableFixture(spec) {
  return spec?.artLayout === "budget";
}

/** @param {string} [paintId] - unknown or missing paints fall back to the default */
export function shelfPaintTint(paintId) {
  return (SHELF_PAINTS[paintId] ?? SHELF_PAINTS[DEFAULT_SHELF_PAINT]).tint;
}
