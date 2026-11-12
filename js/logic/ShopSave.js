// ==========================================
// FILE: ShopSave.js
// ==========================================
// Validates a loaded shop save against the item database and layout rules, throwing a
// readable error on anything malformed and migrating older fixture entries.
import { getFixtureType, getShelfDisplayGrid, getShelfSlotCapacity, isFixturePosition, isValidFixtureRotation, migrateFixtureEntry } from "./FixtureLayout.js";
import employeeRoster from "../../data/Employees.json" with { type: "json" };
import { EMPLOYEE_JOB_IDS } from "./EmployeeJobs.js";
import { MAX_EMPLOYEE_SKILL_LEVEL } from "./EmployeeTraining.js";
import { TILE_SIZE, ZONES, getAuthoredGridSize } from "./RoomLayout.js";
import { MIN_BASE_RATIO, MAX_BASE_RATIO, MIN_SUPPLY_RATIO, MAX_SUPPLY_RATIO } from "./Market.js";
import { THROW_ACCELERATION_MS } from "./Crate.js";
import { MAX_CARRIED_CRATES } from "./CrateStack.js";
import { isValidLedgerData } from "./DayLedger.js";
import { isMoney, roundMoney } from "./Money.js";
import { isValidHovercartCapacity } from "./Hovercart.js";
import { isKnownShopLevel } from "./ShopProgression.js";
import { CUSTOMER_FACTION_IDS } from "./CustomerBuyLists.js";

// Older saves used "slot depth 12 ÷ stackSize". Stacks valid under that rule still load;
// trimShelfOverflow() then moves anything over the current cap to the Go-Backs bin.
const LEGACY_SHELF_STACK_DEPTH = 12;

function requireSave(condition, message) {
  if (!condition) throw new Error(`Invalid saved game: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value, minimum = Number.MIN_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= minimum;
}

// The backroom snaps to whole squares now that crates and the Loading Pad match the tile art.
export const SHOP_LAYOUT_VERSION = 5;

/**
 * Validate a shop save and return it, with pre-fixture-type entries migrated.
 * Throws on the first invalid field.
 * @param {object} data
 * @param {object} database - item and license lookup
 * @returns {object}
 */
export function validateShopSave(data, database) {
  requireSave(isRecord(data), "missing shop state.");
  requireSave(Array.isArray(data.fixtures) && data.fixtures.length > 0, "missing fixture layout.");
  data = { ...data, fixtures: data.fixtures.map(migrateFixtureEntry) };
  requireSave(data.layoutVersion === SHOP_LAYOUT_VERSION,
    data.layoutVersion === undefined || [2, 3, 4].includes(data.layoutVersion)
      ? "this save uses the old backroom size. Start a new game."
      : "unknown shop layout version.");
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
  requireSave(isMoney(player.credits) && integer(player.globalReputation) &&
    integer(player.customersTurnedAway, 0), "invalid credits or reputation.");
  if (player.shopLevel !== undefined) {
    requireSave(isKnownShopLevel(player.shopLevel), "invalid shop level.");
  }
  if (player.pendingReputation !== undefined) {
    const pending = player.pendingReputation;
    requireSave(isRecord(pending) && integer(pending.global) && isRecord(pending.factions) &&
      CUSTOMER_FACTION_IDS.every((id) => integer(pending.factions[id])),
    "invalid pending reputation.");
  }
  if (player.hiredEmployees !== undefined) {
    const employeeIds = new Set(employeeRoster.map((employee) => employee.id));
    requireSave(Array.isArray(player.hiredEmployees) &&
      new Set(player.hiredEmployees).size === player.hiredEmployees.length &&
      player.hiredEmployees.every((id) => employeeIds.has(id)), "invalid hired employees.");
  }
  if (player.offShiftEmployees !== undefined) {
    requireSave(Array.isArray(player.offShiftEmployees) &&
      new Set(player.offShiftEmployees).size === player.offShiftEmployees.length &&
      player.offShiftEmployees.every((id) => (player.hiredEmployees ?? []).includes(id)),
    "invalid off-shift employees.");
  }
  if (player.employeeJobPriorities !== undefined) {
    const hiredEmployees = player.hiredEmployees || [];
    requireSave(isRecord(player.employeeJobPriorities) &&
      Object.keys(player.employeeJobPriorities).length === hiredEmployees.length &&
      hiredEmployees.every((employeeId) => {
        const priorities = player.employeeJobPriorities[employeeId];
        return Array.isArray(priorities) && priorities.length === EMPLOYEE_JOB_IDS.length &&
          new Set(priorities).size === EMPLOYEE_JOB_IDS.length &&
          priorities.every((jobId) => EMPLOYEE_JOB_IDS.includes(jobId));
      }), "invalid employee job priorities.");
  }
  if (player.employeeSkills !== undefined) {
    requireSave(isRecord(player.employeeSkills) &&
      Object.entries(player.employeeSkills).every(([employeeId, levels]) =>
        employeeRoster.some(({ id }) => id === employeeId) && isRecord(levels) &&
        Object.keys(levels).length === EMPLOYEE_JOB_IDS.length &&
        EMPLOYEE_JOB_IDS.every((jobId) =>
          integer(levels[jobId], 1) && levels[jobId] <= MAX_EMPLOYEE_SKILL_LEVEL)),
    "invalid employee skills.");
  }
  if (player.employeeTraining !== undefined) {
    requireSave(isRecord(player.employeeTraining) &&
      Object.entries(player.employeeTraining).every(([employeeId, jobId]) =>
        (player.hiredEmployees ?? []).includes(employeeId) && EMPLOYEE_JOB_IDS.includes(jobId) &&
        (player.employeeSkills?.[employeeId]?.[jobId] ?? 1) < MAX_EMPLOYEE_SKILL_LEVEL),
    "invalid employee training.");
  }
  requireSave(isRecord(player.factionReputation) &&
    CUSTOMER_FACTION_IDS.every((id) => integer(player.factionReputation[id])),
  "invalid faction reputation.");
  requireSave(Array.isArray(player.activeLicenses) &&
    new Set(player.activeLicenses).size === player.activeLicenses.length &&
    player.activeLicenses.every((id) => database.getLicense(id)), "unknown supplier license.");
  requireSave(isRecord(player.storePrices) && Object.entries(player.storePrices).every(
    ([id, price]) => itemById.has(id) && isMoney(price) && price >= 1,
  ), "invalid store price.");
  requireSave(isRecord(player.hovercart) &&
    isValidHovercartCapacity(player.hovercart.capacity), "invalid hovercart.");
  stockCapacity(player.hovercart.stock, player.hovercart.capacity);
  // Optional so saves from before the Go-Backs bin existed still load.
  if (player.goBacks !== undefined) stockCapacity(player.goBacks, Infinity);

  const market = data.market;
  requireSave(isRecord(market) && integer(market.day, 1) &&
    isRecord(market.prices) && isRecord(market.supplyRatios), "missing market state.");
  requireSave(Object.keys(market.prices).length === items.length &&
    Object.keys(market.supplyRatios).length === items.length, "incomplete market prices.");
  for (const item of items) {
    const price = market.prices[item.id];
    const ratio = market.supplyRatios[item.id];
    // Whole-credit saves can sit just outside today's cent-rounded bounds.
    requireSave(isMoney(price) && price >= 1 &&
      price >= Math.max(1, Math.min(Math.round(item.baseCost * MIN_BASE_RATIO), roundMoney(item.baseCost * MIN_BASE_RATIO))) &&
      price <= Math.max(1, Math.max(Math.round(item.baseCost * MAX_BASE_RATIO), roundMoney(item.baseCost * MAX_BASE_RATIO))),
    `invalid market price for ${item.id}.`);
    requireSave(Number.isFinite(ratio) && ratio >= MIN_SUPPLY_RATIO && ratio <= MAX_SUPPLY_RATIO,
      `invalid supplier rate for ${item.id}.`);
  }
  // Receipts are optional so saves from before End Day existed still load.
  if (player.dayLedger !== undefined) {
    requireSave(isValidLedgerData(player.dayLedger) && player.dayLedger.day === market.day,
      "invalid daily receipt.");
  }
  if (player.lastDayReceipt !== undefined && player.lastDayReceipt !== null) {
    requireSave(isValidLedgerData(player.lastDayReceipt, { closed: true }) &&
      player.lastDayReceipt.day < market.day, "invalid previous day's receipt.");
  }
  if (player.awaitingEndDay !== undefined) {
    requireSave(typeof player.awaitingEndDay === "boolean", "invalid end-of-day state.");
  }
  if (player.emergencyLoan !== undefined && player.emergencyLoan !== null) {
    const loan = player.emergencyLoan;
    requireSave(isRecord(loan) && isMoney(loan.balance) && loan.balance > 0 &&
      integer(loan.takenOnDay, 1) && loan.takenOnDay <= market.day, "invalid emergency loan.");
  }

  const fixtureIds = new Set();
  for (const entry of data.fixtures) {
    const spec = getFixtureType(entry?.type);
    requireSave(spec && typeof entry.id === "string" && !fixtureIds.has(entry.id) &&
      isFixturePosition(entry.gx) && entry.gx >= 0 && isFixturePosition(entry.gy) && entry.gy >= 0 &&
      isValidFixtureRotation(entry.rotation),
    "invalid fixture position.");
    fixtureIds.add(entry.id);
    if (spec.kind === "storage") stockCapacity(entry.stock, spec.capacity);
    if (spec.kind === "shelf") {
      const displayGrid = getShelfDisplayGrid(spec);
      requireSave(Array.isArray(entry.placements), "missing shelf contents.");
      const occupied = new Set();
      for (const placement of entry.placements) {
        const item = itemById.get(placement?.itemId);
        requireSave(item && typeof placement.rotated === "boolean" &&
          integer(placement.gx, 0) && integer(placement.gy, 0) &&
          integer(placement.quantity, 0), "invalid shelf stack.");
        const w = placement.rotated ? item.dimensions.h : item.dimensions.w;
        const h = placement.rotated ? item.dimensions.w : item.dimensions.h;
        requireSave(placement.w === w && placement.h === h &&
          placement.gx + w <= displayGrid.w && placement.gy + h <= displayGrid.h &&
          placement.quantity <= Math.max(
            getShelfSlotCapacity(spec.stackDepth, item),
            Math.floor(LEGACY_SHELF_STACK_DEPTH / item.stackSize),
          ),
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
  const validateCrateContents = (crate) => {
    requireSave(isRecord(crate), "invalid crate contents.");
    const kind = crate.kind ?? "item";
    if (kind === "fixture") {
      requireSave(getFixtureType(crate.typeId), "unknown fixture crate.");
      return;
    }
    requireSave(kind === "item" && itemById.has(crate.itemId) &&
      integer(crate.quantity, 1), "invalid crate contents.");
  };
  const { gridW, gridH } = getAuthoredGridSize();
  requireSave(Array.isArray(data.crates), "missing crates.");
  for (const crate of data.crates) {
    validateCrateContents(crate);
    // Crates must sit at least 20 px inside the map edge.
    requireSave(Number.isFinite(crate.x) && Number.isFinite(crate.y) &&
      crate.x >= 20 && crate.x <= gridW * TILE_SIZE - 20 &&
      crate.y >= 20 && crate.y <= gridH * TILE_SIZE - 20 &&
      Number.isFinite(crate.velocityX) && Number.isFinite(crate.velocityY), "invalid crate position or motion.");
    // Saves can capture a crate mid-throw; its remaining launch must still be plausible.
    if (crate.launch !== undefined) {
      const launch = crate.launch;
      requireSave(isRecord(launch) && Number.isFinite(launch.remainingMs) &&
        launch.remainingMs > 0 && launch.remainingMs <= THROW_ACCELERATION_MS &&
        Number.isFinite(launch.accelerationX) && Number.isFinite(launch.accelerationY) &&
        Number.isFinite(launch.maxSpeed) && launch.maxSpeed > 0 &&
        crate.onPad !== true, "invalid crate launch.");
    }
  }
  requireSave(data.carriedCrate === null || isRecord(data.carriedCrate), "invalid carried crate.");
  if (data.carriedCrate) validateCrateContents(data.carriedCrate);
  if (data.carriedCrates !== undefined) {
    requireSave(Array.isArray(data.carriedCrates) && data.carriedCrates.length <= MAX_CARRIED_CRATES,
      "invalid carried crate stack.");
    data.carriedCrates.forEach(validateCrateContents);
    requireSave((data.carriedCrates.length === 0) === (data.carriedCrate === null),
      "carried crate stack does not match the carried crate.");
    if (data.carriedCrates.length > 1) {
      requireSave(data.carriedCrates.every((crate) => (crate.kind ?? "item") === "item"),
        "only item crates can be stacked.");
    }
    if (data.carriedCrates.length) {
      const top = data.carriedCrates.at(-1);
      const single = data.carriedCrate;
      requireSave((top.kind ?? "item") === (single.kind ?? "item") &&
        top.itemId === single.itemId && top.typeId === single.typeId && top.quantity === single.quantity,
      "carried crate stack does not match its top crate.");
    }
  }
  return data;
}
