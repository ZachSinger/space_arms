// ==========================================
// FILE: scripts/balance-audit.mjs
// ==========================================
// Economy and progression audit: reads the real game data and prints, per stage of the
// game, how fast reputation/levels/money grow and where the numbers look unbalanced.
// Run with: node scripts/balance-audit.mjs
// Model assumptions are printed in the report header; tune the PLAYER constants below.
import items from "../data/Items.json" with { type: "json" };
import licenseData from "../data/Licenses.json" with { type: "json" };
import { SHOP_LEVEL_TIERS, STAFF_LIMIT_LEVELS } from "../js/logic/ShopProgression.js";
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
// The player keeps only their most valuable item kinds on the shelves.
const STOCKED_ITEM_KINDS = 24;
const STARTING_SHELVES = 2; // big shelves bought before the first shift
const SHELVES_PER_EXPANSION = 3; // big shelves bought to fill each new sales floor area

const money = (value) => Math.round(value).toLocaleString("en-US");
const maximumLevel = SHOP_LEVEL_TIERS[SHOP_LEVEL_TIERS.length - 1].level;
const levelFor = (reputation) =>
  [...SHOP_LEVEL_TIERS].reverse().find((tier) => reputation >= tier.reputation).level;
const BIG_SHELF_PRICE = getFixtureType("shelf_budget_3x4").price;

// --- Reputation / level / money timeline ---------------------------------------------
// The player buys everything a level unlocks (licenses, expansions plus shelves for them,
// the extra hire) in unlock order, each as soon as the money is there.
function simulateDays(maxDays = 365) {
  const rows = [];
  let reputation = 0;
  let cash = 1500 - STARTING_SHELVES * BIG_SHELF_PRICE;
  const levelReachedOnDay = new Map([[1, 1]]);
  const ownedLicenses = new Set();
  let hired = 0;
  const queue = [];
  const purchases = [];
  const unlock = (level, day) => {
    for (const license of licenses) {
      if ((license.requiredShopLevel ?? 1) === level && items.some((item) => item.license === license.id)) {
        queue.push({ name: license.name, cost: license.baseCost, level, day, apply: () => ownedLicenses.add(license.id) });
      }
    }
    for (const zone of ZONES) {
      if (zone.requiredShopLevel !== level || !zone.cost) continue;
      const shelves = zone.name.startsWith("Sales Floor") ? SHELVES_PER_EXPANSION : 0;
      queue.push({ name: zone.name + (shelves ? ` + ${shelves} shelves` : ""), cost: zone.cost + shelves * BIG_SHELF_PRICE, level, day, apply: () => {} });
    }
    if (STAFF_LIMIT_LEVELS.includes(level)) {
      queue.push({ name: "Hire an employee", cost: EMPLOYEE_HIRE_COST, level, day, apply: () => { hired += 1; } });
    }
  };
  const buyWhatYouCan = (day) => {
    while (queue.length && queue[0].cost <= cash) {
      const purchase = queue.shift();
      cash -= purchase.cost;
      purchase.apply();
      purchases.push({ ...purchase, boughtOnDay: day });
    }
  };
  unlock(1, 1);
  buyWhatYouCan(1);
  for (let day = 1; day <= maxDays; day += 1) {
    const level = levelFor(reputation);
    const pool = Math.round(getStoreRepPool(reputation) * STOCK_SCALER);
    const served = pool;
    // Revenue model: units sold at ~base price; goods cost the supply ratio of base.
    const assortment = stockedAssortment(ownedLicenses);
    const unitsSold = served * AVG_UNITS_PER_CUSTOMER;
    const revenue = unitsSold * assortment.avgBase * SELL_AT;
    const goods = unitsSold * assortment.avgBase * AVG_SUPPLY_RATIO;
    const wages = hired * EMPLOYEE_BASE_WAGE;
    const profit = revenue - goods - wages - DELIVERY_FEE;
    cash += profit;
    reputation += served;
    const newLevel = levelFor(reputation);
    for (let reached = level + 1; reached <= newLevel; reached += 1) {
      if (!levelReachedOnDay.has(reached)) levelReachedOnDay.set(reached, day);
      unlock(reached, day);
    }
    buyWhatYouCan(day);
    rows.push({ day, level: newLevel, reputation, pool, served, profit, cash, waiting: queue.length });
    if (newLevel >= maximumLevel && !queue.length && rows.length > 1 && rows.at(-2).level >= maximumLevel) break;
  }
  return { rows, levelReachedOnDay, purchases };
}

const licenses = licenseData;
// The typical sale: median price of the most valuable item kinds the player owns licenses for.
function stockedAssortment(ownedLicenses) {
  const costs = items
    .filter((item) => item.license && ownedLicenses.has(item.license))
    .map((item) => item.baseCost)
    .sort((a, b) => b - a)
    .slice(0, STOCKED_ITEM_KINDS)
    .sort((a, b) => a - b);
  // Median, not mean: a few very expensive guns shouldn't define the typical sale.
  const avgBase = costs.length ? costs[Math.floor(costs.length / 2)] : 10;
  return { count: costs.length, avgBase };
}

// --- Report ------------------------------------------------------------------------
const { rows, levelReachedOnDay, purchases } = simulateDays();

console.log("SPACE ARMS DEALER - BALANCE AUDIT");
console.log("Model: every arriving customer served, no reputation losses, shelves full, " +
  AVG_UNITS_PER_CUSTOMER + " items/customer, selling at market (~base), " +
  "goods cost " + Math.round(AVG_SUPPLY_RATIO * 100) + "% of base, stocking the " + STOCKED_ITEM_KINDS +
  " most valuable owned item kinds, buying every unlock as soon as it is affordable.");
console.log("");

console.log("=== LEVEL TIMELINE (first four clean shifts: one level each; later levels: several shifts) ===");
console.log("level | rep needed | day reached | money after buying | unlocks");
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
console.log("day | level |  rep | customer pool | served | day profit | cash | unlocks not yet affordable");
for (const row of rows.filter((entry) => entry.day === 1 || entry.day % 5 === 0)) {
  console.log(
    String(row.day).padStart(3) + " | " + String(row.level).padStart(5) + " | " +
    String(row.reputation).padStart(4) + " | " + String(row.pool).padStart(13) + " | " +
    String(row.served).padStart(6) + " | " + money(row.profit).padStart(10) + " | " + money(row.cash) + " | " + row.waiting,
  );
}
console.log("");

console.log("=== NEW ITEM PRICES BY UNLOCK LEVEL (should climb steadily) ===");
console.log("level | cheapest | median | priciest | median vs previous unlock");
let previousMedian = null;
for (const tier of SHOP_LEVEL_TIERS) {
  const ids = new Set(licenses.filter((license) => (license.requiredShopLevel ?? 1) === tier.level).map((license) => license.id));
  const costs = items.filter((item) => ids.has(item.license)).map((item) => item.baseCost).sort((a, b) => a - b);
  if (!costs.length) continue;
  const median = costs[Math.floor(costs.length / 2)];
  const change = previousMedian ? `${median >= previousMedian ? "+" : ""}${Math.round((median / previousMedian - 1) * 100)}%` : "-";
  console.log(String(tier.level).padStart(5) + " | " + money(costs[0]).padStart(8) + " | " + money(median).padStart(6) + " | " + money(costs.at(-1)).padStart(8) + " | " + change);
  previousMedian = median;
}
console.log("");

console.log("=== PURCHASES (shifts of saving between unlocking and affording) ===");
console.log("level | purchase | cost | unlocked day | bought day | shifts waited");
for (const purchase of purchases) {
  console.log(String(purchase.level).padStart(5) + " | " + purchase.name.padEnd(42) + " | " + money(purchase.cost).padStart(7) + " | " + String(purchase.day).padStart(12) + " | " + String(purchase.boughtOnDay).padStart(10) + " | " + (purchase.boughtOnDay - purchase.day));
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
