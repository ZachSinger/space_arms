import assert from "node:assert/strict";
import test from "node:test";
import {
  createCustomerArrivalSchedule,
  createCustomerPool,
  getEmployeeScaler,
  getFactionRepMultiplier,
  getLicensedFactionIds,
  getStoreRepPool,
} from "../js/logic/CustomerPooling.js";

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
  assert.equal(getStoreRepPool(-10), 8);
  assert.equal(getStoreRepPool(0), 8);
  assert.equal(getStoreRepPool(10), 10);
  assert.equal(getStoreRepPool(100), 20);
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
  assert.equal(pool.totalCustomers, 4);
  assert.deepEqual(pool.factionCounts, {
    scavengers: 1,
    mercenaries: 1,
    explorers: 1,
  });
  assert.equal(pool.neutralCount, 1);
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
  const schedule = createCustomerArrivalSchedule(customers, 600_000, () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  });

  assert.deepEqual(
    schedule.map(({ factionId }) => factionId).sort(),
    customers.sort(),
  );
  assert.ok(schedule.every(({ atMs }) => atMs > 0 && atMs < 600_000));
  assert.ok(schedule.every((arrival, arrivalIndex) =>
    arrivalIndex === 0 || arrival.atMs > schedule[arrivalIndex - 1].atMs,
  ));
  const intervals = schedule.slice(1).map((arrival, index) =>
    arrival.atMs - schedule[index].atMs,
  );
  assert.ok(new Set(intervals).size > 1);
});
