// The hovercart's numbers and save rules, kept free of Phaser so saves can be checked anywhere.
import { getBackroomInteriorBounds } from "../../logic/RoomLayout.js";

export const HOVERCART_NAME = "Hovercart";
export const HOVERCART_LEVEL = 7;
export const HOVERCART_PRICE = 1500;
export const HOVERCART_CAPACITY = 3;
// Energy per second: sitting still is 1 plus 1 per crate, moving is 4 plus 2 per crate.
// A full battery lasts 30 seconds moving with 3 crates.
export const HOVERCART_BATTERY = Object.freeze({ capacity: 300, chargeSeconds: 60 });

/** Where the docked cart sits: the top-left of the backroom, under its charger. */
export function getHovercartDock() {
  const bounds = getBackroomInteriorBounds();
  return { x: bounds.left + 40, y: bounds.top + 22 };
}

/** The charger, the docked cart, and room to reach them, which fixtures must stay out of (px). */
export function getHovercartReservedRectangle() {
  const bounds = getBackroomInteriorBounds();
  const dock = getHovercartDock();
  return {
    left: dock.x - 18,
    right: dock.x + 18,
    top: bounds.top,
    bottom: dock.y + 24,
    reason: "Keep the space in front of the hovercart charger clear.",
  };
}

/**
 * Whether a saved hovercart entry is well formed. Its crates' contents are checked with the
 * rest of the save's crates.
 * @param {unknown} value
 */
export function isValidHovercartSave(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const { owned, crates, battery, out } =
    /** @type {{ owned?: unknown, crates?: unknown, battery?: unknown, out?: unknown }} */ (value);
  // Battery and out were added after the first hovercart saves, so they're optional.
  const batteryOk = battery === undefined ||
    (typeof battery === "number" && Number.isFinite(battery) && battery >= 0 && battery <= HOVERCART_BATTERY.capacity);
  return owned === true && batteryOk && (out === undefined || typeof out === "boolean") &&
    Array.isArray(crates) && crates.length <= HOVERCART_CAPACITY &&
    crates.every((crate) => crate !== null && typeof crate === "object" && (crate.kind ?? "item") === "item");
}
