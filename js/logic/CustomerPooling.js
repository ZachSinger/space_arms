import { CUSTOMER_FACTION_IDS, factionMatches } from "./CustomerBuyLists.js";

export const CUSTOMER_POOL_TUNING = Object.freeze({
  storeRepCurve: [
    { reputation: 0, customers: 20 },
    { reputation: 10, customers: 25 },
    { reputation: 25, customers: 32 },
    { reputation: 50, customers: 40 },
    { reputation: 100, customers: 50 },
  ],
  storeRepTailGrowth: 10,
  storeRepTailSoftness: 100,
  stockScalerMinimum: 1,
  stockScalerMaximum: 1.25,
  unitsPerCustomer: {
    neutral: 2,
    scavengers: 3.5,
    mercenaries: 3,
    explorers: 2,
  },
  shelfTypesForMaximumAttraction: 3,
  factionRepForDoubleTrafficWeight: 250,
  maximumEmployeeBonus: 1,
  employeeFalloff: 0.8,
  arrivalJitterFraction: 0.35,
});

function randomUnit(random) {
  return Math.max(0, Math.min(1 - Number.EPSILON, random()));
}

export function getLicensedFactionIds(activeLicenses, items) {
  const licenses = activeLicenses instanceof Set
    ? activeLicenses
    : new Set(activeLicenses);
  return CUSTOMER_FACTION_IDS.filter((factionId) =>
    items.some((item) =>
      item.license && licenses.has(item.license) && factionMatches(item, factionId),
    ),
  );
}

export function getStoreRepPool(reputation) {
  const curve = CUSTOMER_POOL_TUNING.storeRepCurve;
  if (reputation <= curve[0].reputation) return curve[0].customers;

  for (let index = 1; index < curve.length; index += 1) {
    const upper = curve[index];
    if (reputation > upper.reputation) continue;

    const lower = curve[index - 1];
    const progress =
      (reputation - lower.reputation) / (upper.reputation - lower.reputation);
    return lower.customers + progress * (upper.customers - lower.customers);
  }

  const last = curve[curve.length - 1];
  return last.customers + CUSTOMER_POOL_TUNING.storeRepTailGrowth *
    Math.log1p((reputation - last.reputation) / CUSTOMER_POOL_TUNING.storeRepTailSoftness);
}

export function getEmployeeScaler(employeeCount = 0) {
  const count = Math.max(0, employeeCount);
  return 1 + CUSTOMER_POOL_TUNING.maximumEmployeeBonus *
    (1 - CUSTOMER_POOL_TUNING.employeeFalloff ** count);
}

export function getFactionRepMultiplier(reputation) {
  const maxRep = CUSTOMER_POOL_TUNING.factionRepForDoubleTrafficWeight;
  const boundedRep = Math.max(-maxRep, Math.min(maxRep, reputation));
  return 2 ** (boundedRep / maxRep);
}

function getShelfAssortmentScore(factionId, shelfPlacements, getItem) {
  const eligibleItemIds = new Set(
    shelfPlacements
      .map((placement) => placement.itemId)
      .filter((itemId) => {
        const item = getItem(itemId);
        return item && factionMatches(item, factionId);
      }),
  );
  return Math.min(
    1,
    eligibleItemIds.size / CUSTOMER_POOL_TUNING.shelfTypesForMaximumAttraction,
  );
}

function apportionRemainder(total, groups, tieBreakOffset) {
  const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0);
  const allocations = groups.map((group, index) => {
    const exactCount = total * group.weight / totalWeight;
    const count = Math.floor(exactCount);
    return {
      factionId: group.factionId,
      count,
      remainder: exactCount - count,
      index,
    };
  });
  let unallocated = total - allocations.reduce((sum, item) => sum + item.count, 0);
  const tieOrder = (index) =>
    (index - tieBreakOffset % groups.length + groups.length) % groups.length;
  const byLargestRemainder = [...allocations].sort((a, b) =>
    b.remainder - a.remainder || tieOrder(a.index) - tieOrder(b.index),
  );

  for (let index = 0; index < unallocated; index += 1) {
    byLargestRemainder[index].count += 1;
  }
  return allocations;
}

function shuffle(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(randomUnit(random) * (index + 1));
    [items[index], items[otherIndex]] = [items[otherIndex], items[index]];
  }
  return items;
}

export function createCustomerPool({
  storeReputation,
  factionReputation,
  activeFactions,
  shelfPlacements,
  getItem,
  employeeCount = 0,
  tieBreakOffset = 0,
}) {
  const factions = CUSTOMER_FACTION_IDS.filter((id) => activeFactions.has(id));
  const baseCustomers = getStoreRepPool(storeReputation);
  const employeeScaler = getEmployeeScaler(employeeCount);
  const preStockPool = baseCustomers * employeeScaler;
  const groups = [{
    factionId: null,
    weight: 1,
    unitsPerCustomer: CUSTOMER_POOL_TUNING.unitsPerCustomer.neutral,
  }];

  for (const factionId of factions) {
    const assortmentScore = getShelfAssortmentScore(factionId, shelfPlacements, getItem);
    const repMultiplier = getFactionRepMultiplier(factionReputation[factionId] ?? 0);
    groups.push({
      factionId,
      reputation: factionReputation[factionId] ?? 0,
      assortmentScore,
      repMultiplier,
      weight: assortmentScore * repMultiplier,
      unitsPerCustomer: CUSTOMER_POOL_TUNING.unitsPerCustomer[factionId],
    });
  }

  const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0);
  const averageUnitsPerCustomer = groups.reduce(
    (sum, group) => sum + group.weight / totalWeight * group.unitsPerCustomer,
    0,
  );
  const expectedDemand = preStockPool * averageUnitsPerCustomer;
  const shelfStockUnits = shelfPlacements.reduce(
    (sum, placement) => sum + Math.max(0, placement.quantity),
    0,
  );
  const coverage = expectedDemand > 0 ? shelfStockUnits / expectedDemand : 0;
  const stockScaler = Math.max(
    CUSTOMER_POOL_TUNING.stockScalerMinimum,
    Math.min(CUSTOMER_POOL_TUNING.stockScalerMaximum, coverage),
  );
  const calculatedPool = Math.round(preStockPool * stockScaler);
  const totalCustomers = Math.max(calculatedPool, factions.length);
  const factionCounts = new Map(factions.map((id) => [id, 1]));
  const remainder = apportionRemainder(
    totalCustomers - factions.length,
    groups,
    tieBreakOffset,
  );
  for (const group of remainder) {
    if (group.factionId) factionCounts.set(group.factionId, factionCounts.get(group.factionId) + group.count);
  }

  const customerFactionIds = [];
  for (const [factionId, count] of factionCounts) {
    for (let index = 0; index < count; index += 1) {
      customerFactionIds.push(factionId);
    }
  }
  const neutralCount = totalCustomers - customerFactionIds.length;
  for (let index = 0; index < neutralCount; index += 1) customerFactionIds.push(null);

  return {
    totalCustomers,
    customerFactionIds,
    factionCounts: Object.fromEntries(factionCounts),
    neutralCount,
    preStockPool,
    stockScaler,
    calculation: {
      storeReputation,
      employeeCount,
      baseCustomers,
      employeeScaler,
      averageUnitsPerCustomer,
      expectedDemand,
      shelfStockUnits,
      coverage,
      calculatedPool,
      tieBreakOffset,
      groups,
    },
  };
}

// Mid-shift restocking can only grow the pool. Only the not-yet-elapsed share of the
// increase is added, spread over the rest of the shift, so stocking late adds fewer.
export function growCustomerArrivalSchedule({
  schedule,
  currentPool,
  nextPool,
  elapsedMs,
  shiftDurationMs,
  random = Math.random,
}) {
  const remainingMs = shiftDurationMs - elapsedMs;
  if (remainingMs <= 0 || nextPool.totalCustomers <= currentPool.totalCustomers) {
    return { schedule, pool: currentPool, addedFactionIds: [] };
  }

  const countIds = (ids) => ids.reduce((counts, id) => {
    counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }, new Map());
  const currentCounts = countIds(currentPool.customerFactionIds);
  const growthIds = [];
  for (const [factionId, count] of countIds(nextPool.customerFactionIds)) {
    for (let index = currentCounts.get(factionId) ?? 0; index < count; index += 1) {
      growthIds.push(factionId);
    }
  }

  const addCount = Math.round(growthIds.length * remainingMs / shiftDurationMs);
  if (addCount === 0) return { schedule, pool: currentPool, addedFactionIds: [] };
  const addedFactionIds = shuffle(growthIds, random).slice(0, addCount);
  const added = createCustomerArrivalSchedule(addedFactionIds, remainingMs, random)
    .map((arrival) => ({ ...arrival, atMs: arrival.atMs + elapsedMs }));
  const elapsed = schedule.filter((arrival) => arrival.atMs <= elapsedMs);
  const upcoming = schedule.filter((arrival) => arrival.atMs > elapsedMs);
  return {
    schedule: [...elapsed, ...[...upcoming, ...added].sort((a, b) => a.atMs - b.atMs)],
    pool: nextPool,
    addedFactionIds,
  };
}

export function createCustomerArrivalSchedule(
  customerFactionIds,
  shiftDurationMs,
  random = Math.random,
) {
  const shuffled = shuffle([...customerFactionIds], random);
  if (shuffled.length === 0) return [];

  const intervalMs = shiftDurationMs / shuffled.length;
  const jitterMs = intervalMs * CUSTOMER_POOL_TUNING.arrivalJitterFraction;
  return shuffled
    .map((factionId, index) => ({
      factionId,
      atMs: Math.max(
        0,
        Math.min(
          shiftDurationMs - 1,
          (index + 0.5) * intervalMs + (randomUnit(random) * 2 - 1) * jitterMs,
        ),
      ),
    }))
    .sort((a, b) => a.atMs - b.atMs);
}
