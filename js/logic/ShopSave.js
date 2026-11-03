import { FIXTURE_SPECS } from "./FixtureLayout.js";
import { TILE_SIZE, ZONES, getTotalGridSize } from "./RoomLayout.js";
import { MIN_BASE_RATIO, MAX_BASE_RATIO, MIN_SUPPLY_RATIO, MAX_SUPPLY_RATIO } from "./Market.js";

function requireSave(condition, message) {
  if (!condition) throw new Error(`Invalid saved game: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value, minimum = Number.MIN_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= minimum;
}

export function validateShopSave(data, database) {
  requireSave(isRecord(data), "missing shop state.");
  const items = database.getAllItems();
  const itemById = new Map(items.map((item) => [item.id, item]));
  const stockCapacity = (stock, capacity) => {
    requireSave(Array.isArray(stock), "missing inventory.");
    const ids = new Set();
    let used = 0;
    for (const entry of stock) {
      const item = itemById.get(entry?.itemId);
      requireSave(item && integer(entry.quantity, 1) && !ids.has(item.id), "invalid inventory entry.");
      ids.add(item.id);
      used += item.slots * entry.quantity;
    }
    requireSave(used <= capacity, "inventory exceeds its capacity.");
  };
  const player = data.playerState;
  requireSave(isRecord(player), "missing player state.");
  requireSave(integer(player.credits) && integer(player.globalReputation) &&
    integer(player.customersTurnedAway, 0), "invalid credits or reputation.");
  requireSave(isRecord(player.factionReputation) &&
    ["scavengers", "mercenaries", "explorers"].every((id) => integer(player.factionReputation[id])),
  "invalid faction reputation.");
  requireSave(Array.isArray(player.activeLicenses) &&
    new Set(player.activeLicenses).size === player.activeLicenses.length &&
    player.activeLicenses.every((id) => database.getLicense(id)), "unknown supplier license.");
  requireSave(isRecord(player.storePrices) && Object.entries(player.storePrices).every(
    ([id, price]) => itemById.has(id) && integer(price, 1),
  ), "invalid store price.");
  requireSave(isRecord(player.hovercart) && player.hovercart.capacity === 10, "invalid hovercart.");
  stockCapacity(player.hovercart.stock, player.hovercart.capacity);

  const market = data.market;
  requireSave(isRecord(market) && integer(market.day, 1) &&
    isRecord(market.prices) && isRecord(market.supplyRatios), "missing market state.");
  requireSave(Object.keys(market.prices).length === items.length &&
    Object.keys(market.supplyRatios).length === items.length, "incomplete market prices.");
  for (const item of items) {
    const price = market.prices[item.id];
    const ratio = market.supplyRatios[item.id];
    requireSave(integer(price, 1) &&
      price >= Math.max(1, Math.round(item.baseCost * MIN_BASE_RATIO)) &&
      price <= Math.max(1, Math.round(item.baseCost * MAX_BASE_RATIO)),
    `invalid market price for ${item.id}.`);
    requireSave(Number.isFinite(ratio) && ratio >= MIN_SUPPLY_RATIO && ratio <= MAX_SUPPLY_RATIO,
      `invalid supplier rate for ${item.id}.`);
  }

  requireSave(Array.isArray(data.fixtures) && data.fixtures.length === FIXTURE_SPECS.length,
    "missing fixture layout.");
  const fixtureIds = new Set();
  for (const entry of data.fixtures) {
    const spec = FIXTURE_SPECS.find((candidate) => candidate.id === entry?.id);
    requireSave(spec && !fixtureIds.has(spec.id) && integer(entry.gx, 0) && integer(entry.gy, 0),
      "invalid fixture position.");
    fixtureIds.add(spec.id);
    if (spec.kind === "storage") stockCapacity(entry.stock, spec.capacity);
    if (spec.kind === "shelf") {
      requireSave(Array.isArray(entry.placements), "missing shelf contents.");
      const occupied = new Set();
      for (const placement of entry.placements) {
        const item = itemById.get(placement?.itemId);
        requireSave(item && typeof placement.rotated === "boolean" &&
          integer(placement.gx, 0) && integer(placement.gy, 0) &&
          integer(placement.quantity, 1), "invalid shelf stack.");
        const w = placement.rotated ? item.dimensions.h : item.dimensions.w;
        const h = placement.rotated ? item.dimensions.w : item.dimensions.h;
        requireSave(placement.w === w && placement.h === h &&
          placement.gx + w <= spec.displayGrid.w && placement.gy + h <= spec.displayGrid.h &&
          placement.quantity <= Math.floor(spec.stackDepth / item.stackSize),
        "shelf stack does not fit.");
        for (let dy = 0; dy < h; dy += 1) {
          for (let dx = 0; dx < w; dx += 1) {
            const key = `${placement.gx + dx},${placement.gy + dy}`;
            requireSave(!occupied.has(key), "overlapping shelf stacks.");
            occupied.add(key);
          }
        }
      }
    }
  }
  requireSave(Array.isArray(data.unlockedZones) &&
    new Set(data.unlockedZones).size === data.unlockedZones.length &&
    data.unlockedZones.every((id) => ZONES.some((zone) => zone.id === id)) &&
    ZONES.filter((zone) => !zone.locked).every((zone) => data.unlockedZones.includes(zone.id)),
  "invalid unlocked rooms.");
  const validateCrateContents = (crate) => requireSave(
    isRecord(crate) && itemById.has(crate.itemId) && integer(crate.quantity, 1), "invalid crate contents.",
  );
  const { gridW, gridH } = getTotalGridSize();
  requireSave(Array.isArray(data.crates), "missing crates.");
  for (const crate of data.crates) {
    validateCrateContents(crate);
    requireSave(Number.isFinite(crate.x) && Number.isFinite(crate.y) &&
      crate.x >= 20 && crate.x <= gridW * TILE_SIZE - 20 &&
      crate.y >= 20 && crate.y <= gridH * TILE_SIZE - 20 &&
      Number.isFinite(crate.velocityX) && Number.isFinite(crate.velocityY), "invalid crate position or motion.");
  }
  requireSave(data.carriedCrate === null || isRecord(data.carriedCrate), "invalid carried crate.");
  if (data.carriedCrate) validateCrateContents(data.carriedCrate);
  return data;
}
