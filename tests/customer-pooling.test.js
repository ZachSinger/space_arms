import assert from "node:assert/strict";
import test from "node:test";
import {
  createCustomerArrivalSchedule,
  createCustomerPool,
  getEmployeeScaler,
  getFactionRepMultiplier,
  getLicensedFactionIds,
  getStoreRepPool,
  growCustomerArrivalSchedule,
} from "../js/logic/CustomerPooling.js";
import { SHIFT_DURATION_MS } from "../js/logic/ShiftClock.js";

const catalog = [
  ...["scav_1", "scav_2", "scav_3"].map((id) => ({
    id,
    license: "lic_scav",
    tags: ["Surplus"],
  })),
  ...["merc_1", "merc_2", "merc_3"].map((id) => ({
    id,
    license: "lic_merc",
    tags: ["Ammunition", "Standard"],
  })),
  ...["explorer_1", "explorer_2", "explorer_3"].map((id) => ({
    id,
    license: "lic_explorer",
    tags: ["Survival"],
  })),
  { id: "neutral_apparel", license: "lic_neutral", tags: ["Apparel"] },
];
const getItem = (itemId) => catalog.find((item) => item.id === itemId);
const allLicenses = new Set(["lic_scav", "lic_merc", "lic_explorer"]);
const allFactions = new Set(["scavengers", "mercenaries", "explorers"]);
const neutralReputation = { scavengers: 0, mercenaries: 0, explorers: 0 };

test("licensed faction eligibility is based on licensed Primary-list items", () => {
  assert.deepEqual(
    getLicensedFactionIds(new Set(["lic_scav", "unrelated"]), catalog),
    ["scavengers"],
  );
  assert.deepEqual(getLicensedFactionIds(allLicenses, catalog), [
    "scavengers",
    "mercenaries",
    "explorers",
  ]);
});

test("store reputation curve starts conservatively and keeps growing beyond its table", () => {
  assert.equal(getStoreRepPool(-10), 20);
  assert.equal(getStoreRepPool(0), 20);
  assert.equal(getStoreRepPool(10), 25);
  assert.equal(getStoreRepPool(100), 50);
  assert.ok(getStoreRepPool(1000) > getStoreRepPool(100));
});

test("faction reputation multiplier is gradual and bounded", () => {
  assert.equal(getFactionRepMultiplier(0), 1);
  assert.equal(getFactionRepMultiplier(250), 2);
  assert.equal(getFactionRepMultiplier(-250), 0.5);
  assert.equal(getFactionRepMultiplier(10000), 2);
  assert.equal(getFactionRepMultiplier(-10000), 0.5);
});

test("employee scaler has diminishing returns and remains neutral with no employees", () => {
  assert.equal(getEmployeeScaler(0), 1);
  assert.ok(getEmployeeScaler(2) > getEmployeeScaler(1));
  assert.ok(getEmployeeScaler(10) < 2);
});

test("every active faction gets one visitor even with no faction shelf assortment", () => {
  const pool = createCustomerPool({
    storeReputation: 2,
    factionReputation: neutralReputation,
    activeFactions: allFactions,
    shelfPlacements: [],
    getItem,
  });
  assert.equal(pool.totalCustomers, 21);
  assert.deepEqual(pool.factionCounts, {
    scavengers: 1,
    mercenaries: 1,
    explorers: 1,
  });
  assert.equal(pool.neutralCount, 18);
  assert.equal(pool.calculation.storeReputation, 2);
  assert.equal(pool.calculation.employeeScaler, 1);
  assert.equal(pool.calculation.shelfStockUnits, 0);
  assert.equal(pool.calculation.calculatedPool, pool.totalCustomers);
  assert.equal(pool.calculation.groups[1].assortmentScore, 0);
  assert.equal(pool.calculation.groups[1].repMultiplier, 1);
});

test("active factions with no matching shelf items get only their reserved visitors", () => {
  const pool = createCustomerPool({
    storeReputation: 50,
    factionReputation: { scavengers: 250, mercenaries: 250, explorers: 250 },
    activeFactions: allFactions,
    shelfPlacements: [{ itemId: "neutral_apparel", quantity: 0 }],
    getItem,
  });
  assert.deepEqual(pool.factionCounts, {
    scavengers: 1,
    mercenaries: 1,
    explorers: 1,
  });
});

test("maxed faction factors leave a meaningful non-faction share in a large pool", () => {
  const shelfPlacements = catalog.map(({ id }) => ({ itemId: id, quantity: 10000 }));
  const pool = createCustomerPool({
    storeReputation: 1e50,
    factionReputation: { scavengers: 250, mercenaries: 250, explorers: 250 },
    activeFactions: allFactions,
    shelfPlacements,
    getItem,
  });
  const factionCount = Object.values(pool.factionCounts)
    .reduce((sum, count) => sum + count, 0);
  const factionShare = factionCount / pool.totalCustomers;
  assert.ok(factionShare > 0.85);
  assert.ok(factionShare < 0.87);
  assert.equal(pool.totalCustomers, pool.customerFactionIds.length);
  assert.equal(pool.totalCustomers, factionCount + pool.neutralCount);
});

test("arrival schedule preserves every customer and varies their evenly spaced times", () => {
  const customers = ["scavengers", null, "explorers", "mercenaries"];
  const values = [0.1, 0.8, 0.3, 0.6, 0.2, 0.9, 0.4, 0.7];
  let index = 0;
  const schedule = createCustomerArrivalSchedule(customers, SHIFT_DURATION_MS, () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  });

  assert.deepEqual(
    schedule.map(({ factionId }) => factionId).sort(),
    customers.sort(),
  );
  assert.ok(schedule.every(({ atMs }) => atMs > 0 && atMs < SHIFT_DURATION_MS));
  assert.ok(schedule.every((arrival, arrivalIndex) =>
    arrivalIndex === 0 || arrival.atMs > schedule[arrivalIndex - 1].atMs,
  ));
  const intervals = schedule.slice(1).map((arrival, index) =>
    arrival.atMs - schedule[index].atMs,
  );
  assert.ok(new Set(intervals).size > 1);
});

test("five-minute shifts halve arrival delays without changing the customer pool", () => {
  const customers = Array.from({ length: 18 }, (_, index) =>
    [null, "scavengers", "mercenaries", "explorers"][index % 4],
  );
  const previous = createCustomerArrivalSchedule(customers, 600_000, () => 0.5);
  const current = createCustomerArrivalSchedule(customers, SHIFT_DURATION_MS, () => 0.5);

  assert.equal(SHIFT_DURATION_MS, 300_000);
  assert.equal(current.length, 18);
  assert.deepEqual(current, previous.map((arrival) => ({
    ...arrival, atMs: arrival.atMs / 2,
  })));
});

test("stocking shelves mid-shift grows the pool over the remaining shift only", () => {
  const poolFor = (shelfPlacements) => createCustomerPool({
    storeReputation: 2,
    factionReputation: neutralReputation,
    activeFactions: new Set(),
    shelfPlacements,
    getItem,
  });
  const emptyPool = poolFor([]);
  const stockedPool = poolFor([{ itemId: "neutral_apparel", quantity: 80 }]);
  assert.ok(stockedPool.totalCustomers > emptyPool.totalCustomers);

  const schedule = createCustomerArrivalSchedule(emptyPool.customerFactionIds, SHIFT_DURATION_MS, () => 0.5);
  const halfway = SHIFT_DURATION_MS / 2;
  const result = growCustomerArrivalSchedule({
    schedule,
    currentPool: emptyPool,
    nextPool: stockedPool,
    elapsedMs: halfway,
    shiftDurationMs: SHIFT_DURATION_MS,
    random: () => 0.5,
  });
  const growth = stockedPool.totalCustomers - emptyPool.totalCustomers;
  assert.equal(result.addedFactionIds.length, Math.round(growth / 2));
  assert.equal(result.pool, stockedPool);
  assert.equal(result.schedule.length, schedule.length + result.addedFactionIds.length);
  assert.deepEqual(
    result.schedule.filter((arrival) => arrival.atMs <= halfway),
    schedule.filter((arrival) => arrival.atMs <= halfway),
  );
  for (let index = 1; index < result.schedule.length; index += 1) {
    assert.ok(result.schedule[index].atMs >= result.schedule[index - 1].atMs);
  }
  assert.ok(result.schedule.every((arrival) => arrival.atMs < SHIFT_DURATION_MS));
});

test("pool never shrinks mid-shift and tiny late growth is held until it adds a customer", () => {
  const shrink = growCustomerArrivalSchedule({
    schedule: [],
    currentPool: { totalCustomers: 10, customerFactionIds: Array(10).fill(null) },
    nextPool: { totalCustomers: 5, customerFactionIds: Array(5).fill(null) },
    elapsedMs: 0,
    shiftDurationMs: SHIFT_DURATION_MS,
  });
  assert.equal(shrink.addedFactionIds.length, 0);
  assert.equal(shrink.pool.totalCustomers, 10);

  const tiny = growCustomerArrivalSchedule({
    schedule: [],
    currentPool: { totalCustomers: 10, customerFactionIds: Array(10).fill(null) },
    nextPool: { totalCustomers: 11, customerFactionIds: Array(11).fill(null) },
    elapsedMs: SHIFT_DURATION_MS * 5 / 6,
    shiftDurationMs: SHIFT_DURATION_MS,
  });
  assert.equal(tiny.addedFactionIds.length, 0);
  assert.equal(tiny.pool.totalCustomers, 10);
});
