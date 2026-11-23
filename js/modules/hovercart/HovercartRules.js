// The hovercart's numbers and save rules, kept free of Phaser so saves can be checked anywhere.
import { TILE_SIZE, getBackroomInteriorBounds } from "../../logic/RoomLayout.js";

export const HOVERCART_NAME = "Hovercart";
export const HOVERCART_LEVEL = 7;
export const HOVERCART_PRICE = 2200;
export const HOVERCART_CAPACITY = 3;
// Energy per second: sitting still is 1 plus 1 per crate, moving is 4 plus 2 per crate.
// A full battery lasts 30 seconds moving with 3 crates.
export const HOVERCART_BATTERY = Object.freeze({ capacity: 300, chargeSeconds: 60 });

export const HOVERCART_CHARGER_TYPE = "hovercart_charger";
// The charger art is 64x88: the post up top, the pad the cart parks on below it.
const CHARGER_ART = Object.freeze({ width: 64, height: 88, padLeft: 5, padRight: 59, padBottom: 82 });

/**
 * Where things are around a placed charger, in px: the cart's spot on the pad, where it pulls
 * out to when switched on, the charger's solid box, and the art's top-left (for its screen).
 * @param {{ gx: number, gy: number }} charger - a HOVERCART CHARGER fixture (1 x 1.375 tiles)
 */
export function getHovercartChargerSpots(charger) {
  const x = (charger.gx + CHARGER_ART.width / TILE_SIZE / 2) * TILE_SIZE;
  const top = charger.gy * TILE_SIZE;
  return {
    dock: { x, y: top + 74 },
    launch: { x, y: top + CHARGER_ART.padBottom + 12 },
    bounds: {
      left: x - CHARGER_ART.width / 2 + CHARGER_ART.padLeft,
      right: x - CHARGER_ART.width / 2 + CHARGER_ART.padRight,
      top,
      bottom: top + CHARGER_ART.padBottom,
    },
    artTop: { x: x - CHARGER_ART.width / 2, y: top },
  };
}

/** The old fixed charger spot, top-left of the backroom, as a grid position (for older saves). */
export function getLegacyChargerSpot() {
  const bounds = getBackroomInteriorBounds();
  const snap = (value) => Math.round(value * 8) / 8;
  return { gx: snap((bounds.left + 8) / TILE_SIZE), gy: snap((bounds.top - 32) / TILE_SIZE) };
}

/**
 * Whether a saved hovercart entry is well formed. Its crates' contents are checked with the
 * rest of the save's crates.
 * @param {unknown} value
 */
export function isValidHovercartSave(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const { owned, crates, battery, out, charger } =
    /** @type {{ owned?: unknown, crates?: unknown, battery?: unknown, out?: unknown, charger?: unknown }} */ (value);
  // Battery and out were added after the first hovercart saves, so they're optional.
  const batteryOk = battery === undefined ||
    (typeof battery === "number" && Number.isFinite(battery) && battery >= 0 && battery <= HOVERCART_BATTERY.capacity);
  // Saves from before the charger was a placeable fixture have no charger flag.
  return owned === true && batteryOk && (out === undefined || typeof out === "boolean") &&
    (charger === undefined || charger === true) &&
    Array.isArray(crates) && crates.length <= HOVERCART_CAPACITY &&
    crates.every((crate) => crate !== null && typeof crate === "object" && (crate.kind ?? "item") === "item");
}
