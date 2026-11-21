// ==========================================
// FILE: scripts/balance-audit.mjs
// ==========================================
// Economy and progression audit: reads the real game data and prints, per stage of the
// game, how fast reputation/levels/money grow and where the numbers look unbalanced.
// Run with: node scripts/balance-audit.mjs
// Model assumptions are printed in the report header; tune the PLAYER constants below.
import items from "../data/Items.json" with { type: "json" };
import licenseData from "../data/Licenses.json" with { type: "json" };
import { SHOP_LEVEL_TIERS, STAFF_LIMIT_LEVELS, getStaffLimit } from "../js/logic/ShopProgression.js";
import { getStoreRepPool, CUSTOMER_POOL_TUNING } from "../js/logic/CustomerPooling.js";
import { ZONES } from "../js/logic/RoomLayout.js";
import { getFixtureType, FIXTURE_TYPES, getFixtureResaleValue } from "../js/logic/FixtureLayout.js";
import { getCrateOrderQuantity, DELIVERY_FEE } from "../js/logic/SupplyOrder.js";
import { MIN_SUPPLY_RATIO, MAX_SUPPLY_RATIO } from "../js/logic/Market.js";
import { EMPLOYEE_HIRE_COST, EMPLOYEE_BASE_WAGE } from "../js/logic/EmployeeTraining.js";

// --- Player model (ideal-but-plausible play; every result below depends on these) ---
const STOCK_SCALER = CUSTOMER_POOL_TUNING.stockScalerMaximum; // shelves kept full
const AVG_UNITS_PER_CUSTOMER = 2.5; // between neutral (2) and faction (3-3.5) buyers
const AVG_SUPPLY_RATIO = (MIN_SUPPLY_RATIO + MAX_SUPPLY_RATIO) / 2; // avg crate cost vs base
const SELL_AT = 1.0; // player prices at market, which hovers around base cost

const money = (value) => Math.round(value).toLocaleString("en-US");
const maximumLevel = SHOP_LEVEL_TIERS[SHOP_LEVEL_TIERS.length - 1].level;

// --- Reputation / level timeline ---------------------------------------------------
function simulateDays(maxDays = 365) {
  const rows = [];
  let reputation = 0;
  let cash = 1500;
  const levelReachedOnDay = new Map([[1, 1]]);
  for (let day = 1; day <= maxDays; day += 1) {
    const level = [...SHOP_LEVEL_TIERS].reverse().find((tier) => reputation >= tier.reputation).level;
    const staff = getStaffLimit(level);
    const pool = Math.round(getStoreRepPool(reputation) * STOCK_SCALER);
    const served = pool;
    // Revenue model: units sold at ~base price; goods cost the supply ratio of base.
    const assortment = affordableAssortment(level);
    const unitsSold = served * AVG_UNITS_PER_CUSTOMER;
    const revenue = unitsSold * assortment.avgBase * SELL_AT;
    const goods = unitsSold * assortment.avgBase * AVG_SUPPLY_RATIO;
    const wages = staff * EMPLOYEE_BASE_WAGE;
    const profit = revenue - goods - wages - DELIVERY_FEE;
    cash += profit;
    reputation += served;
    const newLevel = [...SHOP_LEVEL_TIERS].reverse().find((tier) => reputation >= tier.reputation).level;
    for (let reached = level + 1; reached <= newLevel; reached += 1) {
      if (!levelReachedOnDay.has(reached)) levelReachedOnDay.set(reached, day);
    }
    rows.push({ day, level: newLevel, reputation, pool, served, profit, cash });
    if (newLevel >= maximumLevel && rows.length > 1 && rows.at(-2).level >= maximumLevel) break;
  }
  return { rows, levelReachedOnDay };
}

// The average base cost of items the player can plausibly be selling at a level:
// everything whose license is unlocked by then (requirement met), weighted evenly.
const licenses = licenseData;
function licensesAtLevel(level) {
  return licenses.filter((license) => (license.requiredShopLevel ?? 1) <= level);
}
function affordableAssortment(level) {
  const ids = new Set(licensesAtLevel(level).map((license) => license.id));
  const sellable = items.filter((item) => item.license && ids.has(item.license));
  const costs = sellable.map((item) => item.baseCost).sort((a, b) => a - b);
  // Median, not mean: a few very expensive guns shouldn't define the typical sale.
  const avgBase = costs.length ? costs[Math.floor(costs.length / 2)] : 10;
  return { count: sellable.length, avgBase };
}

// --- Report ------------------------------------------------------------------------
const { rows, levelReachedOnDay } = simulateDays();

console.log("SPACE ARMS DEALER - BALANCE AUDIT");
console.log("Model: every arriving customer served, no reputation losses, shelves full, " +
  AVG_UNITS_PER_CUSTOMER + " items/customer, selling at market (~base), " +
  "goods cost " + Math.round(AVG_SUPPLY_RATIO * 100) + "% of base, median-priced assortment.");
console.log("");

console.log("=== LEVEL TIMELINE (first four clean shifts: one level each; later levels: several shifts) ===");
console.log("level | rep needed | day reached | money on that day | unlocks");
for (const tier of SHOP_LEVEL_TIERS) {
  const day = levelReachedOnDay.get(tier.level);
  const row = day ? rows[Math.min(day - 1, rows.length - 1)] : null;
  const unlocks = [];
  for (const license of licenses) {
    if ((license.requiredShopLevel ?? 1) === tier.level && tier.level > 1) {
      unlocks.push(`${license.name} (${money(license.baseCost)})`);
    }
  }
  for (const zone of ZONES) {
    if (zone.requiredShopLevel === tier.level) unlocks.push(`${zone.name} (${money(zone.cost)})`);
  }
  if (STAFF_LIMIT_LEVELS.includes(tier.level)) unlocks.push("staff +1");
  console.log(
    String(tier.level).padStart(5) + " | " + String(tier.reputation).padStart(10) + " | " +
    String(day ?? "never").padStart(11) + " | " + String(row ? money(row.cash) : "-").padStart(17) +
    " | " + (unlocks.join("; ") || "-"),
  );
}

const maximumLevelDay = levelReachedOnDay.get(maximumLevel);
console.log("");
console.log(`Level ${maximumLevel} reached on day ${maximumLevelDay ?? "NEVER (within a year)"}.`);
console.log("");

console.log("=== DAILY SNAPSHOT (every 5 days) ===");
console.log("day | level |  rep | customer pool | served | day profit | cash");
for (const row of rows.filter((entry) => entry.day === 1 || entry.day % 5 === 0)) {
  console.log(
    String(row.day).padStart(3) + " | " + String(row.level).padStart(5) + " | " +
    String(row.reputation).padStart(4) + " | " + String(row.pool).padStart(13) + " | " +
    String(row.served).padStart(6) + " | " + money(row.profit).padStart(10) + " | " + money(row.cash),
  );
}
console.log("");

console.log("=== LICENSES (cost vs the day you can buy them) ===");
console.log("license | tier | lvl req | rep req | cost | items | base cost range | profit/crate (median item)");
for (const license of licenses) {
  const owned = items.filter((item) => item.license === license.id);
  const costs = owned.map((item) => item.baseCost).sort((a, b) => a - b);
  const median = costs.length ? costs[Math.floor(costs.length / 2)] : 0;
  const medianItem = owned.find((item) => item.baseCost === median) ?? owned[0];
  const crateQty = medianItem ? getCrateOrderQuantity(medianItem) : 0;
  const crateProfit = medianItem ? crateQty * median * (SELL_AT - AVG_SUPPLY_RATIO) : 0;
  console.log(
    license.name.padEnd(34) + " | " + String(license.tier ?? "-").padStart(4) + " | " +
    String(license.requiredShopLevel ?? 1).padStart(7) + " | " +
    String(license.reqReputation ?? 0).padStart(7) + " | " +
    money(license.baseCost).padStart(6) + " | " + String(owned.length).padStart(5) + " | " +
    (costs.length ? `${money(costs[0])}-${money(costs.at(-1))}` : "-").padStart(15) + " | " +
    money(crateProfit).padStart(6),
  );
}
console.log("");

console.log("=== FIXTURES (price vs what a full shelf is worth) ===");
console.log("fixture | price | slots | capacity sample (boxSize 1/2/4) | resale");
for (const spec of Object.values(FIXTURE_TYPES)) {
  if (spec.kind !== "shelf") {
    console.log(spec.name.padEnd(22) + " | " + money(spec.price).padStart(6) + " |     - | - | " +
      money(getFixtureResaleValue(spec.id)));
    continue;
  }
  const slots = spec.shelfRows * spec.shelfColumns;
  const caps = [1, 2, 4].map((boxSize) =>
    getCrateOrderQuantity({ boxSize }));
  console.log(
    spec.name.padEnd(22) + " | " + money(spec.price).padStart(6) + " | " + String(slots).padStart(5) +
    " | " + caps.join("/") + " per slot | " + money(getFixtureResaleValue(spec.id)),
  );
}
console.log("");

console.log("=== MONEY SINKS vs MONEY EARNED ===");
const totalLicenses = licenses.reduce((sum, license) => sum + license.baseCost, 0);
const totalExpansions = ZONES.reduce((sum, zone) => sum + (zone.cost ?? 0), 0);
const totalStaff = STAFF_LIMIT_LEVELS.length * EMPLOYEE_HIRE_COST;
const sampleShelves = 12 * getFixtureType("shelf_budget_3x4").price;
const allSinks = totalLicenses + totalExpansions + totalStaff + sampleShelves;
console.log(`All licenses: ${money(totalLicenses)}`);
console.log(`All expansions: ${money(totalExpansions)}`);
console.log(`All staff hires (${STAFF_LIMIT_LEVELS.length}): ${money(totalStaff)}`);
console.log(`~12 big shelves: ${money(sampleShelves)}`);
console.log(`TOTAL spendable: ~${money(allSinks)}`);
const atMaximumLevel = rows.find((row) => row.day === (maximumLevelDay ?? rows.at(-1).day)) ?? rows.at(-1);
console.log(`Cash when hitting max level (model): ${money(atMaximumLevel.cash)}`);
console.log("");

console.log("=== DATA SMELLS ===");
for (const license of licenses) {
  const owned = items.filter((item) => item.license === license.id);
  if (owned.length === 0 && license.unlocksFixtures?.length === 0) {
    console.log(`- ${license.name}: unlocks no items and no fixtures.`);
  }
  if (!license.unlocksFixtures?.length && owned.length === 0) continue;
}
const noLicense = items.filter((item) => !item.license);
if (noLicense.length) console.log(`- ${noLicense.length} items have no license (can never be sold).`);
const zeroQty = items.filter((item) => getCrateOrderQuantity(item) <= 0);
if (zeroQty.length) console.log(`- ${zeroQty.length} items fit 0 per crate: ${zeroQty.slice(0, 5).map((item) => item.name).join(", ")}...`);
const sortedTiers = [...licenses].sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0));
for (let index = 1; index < sortedTiers.length; index += 1) {
  const prev = sortedTiers[index - 1];
  const next = sortedTiers[index];
  if ((next.tier ?? 0) > (prev.tier ?? 0) && next.baseCost < prev.baseCost) {
    console.log(`- Tier order vs price order mismatch: ${next.name} (tier ${next.tier}, ${money(next.baseCost)}) is cheaper than ${prev.name} (tier ${prev.tier}, ${money(prev.baseCost)}).`);
  }
}
