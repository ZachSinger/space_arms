// ==========================================
// FILE: Hovercart.js
// ==========================================
// The player's hovercart capacities and upgrade prices, shared by the tablet and saves.

export const HOVERCART_CAPACITY = 15;
export const LEGACY_HOVERCART_CAPACITY = 10;

// Each upgrade unlocks at a Shop Level (see documentation/StoreLevel.md).
export const HOVERCART_UPGRADES = Object.freeze([
  Object.freeze({ capacity: 20, price: 200, requiredShopLevel: 3 }),
  Object.freeze({ capacity: 25, price: 300, requiredShopLevel: 8 }),
  Object.freeze({ capacity: 30, price: 400, requiredShopLevel: 14 }),
  Object.freeze({ capacity: 35, price: 500, requiredShopLevel: 21 }),
  Object.freeze({ capacity: 40, price: 600, requiredShopLevel: 28 }),
]);

export function isValidHovercartCapacity(capacity) {
  return capacity === LEGACY_HOVERCART_CAPACITY || capacity === HOVERCART_CAPACITY ||
    HOVERCART_UPGRADES.some((upgrade) => upgrade.capacity === capacity);
}

export function getNextHovercartUpgrade(capacity) {
  if (!isValidHovercartCapacity(capacity) || capacity === LEGACY_HOVERCART_CAPACITY) {
    throw new RangeError(`Invalid current hovercart capacity: ${capacity}.`);
  }
  return HOVERCART_UPGRADES.find((upgrade) => upgrade.capacity === capacity + 5) ?? null;
}
