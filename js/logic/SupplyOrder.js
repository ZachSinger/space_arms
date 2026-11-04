// ==========================================
// FILE: SupplyOrder.js
// ==========================================
// Stock is ordered as one finite delivery: the player fills an order with crates, then
// places it. Each delivery pays one flat fee, so batching crates into one order is cheaper
// than ordering a single crate every time something runs low.

export const DELIVERY_FEE = 25;
// The Loading Pad has a 3x3 grid of crate spots (see GameScene.getLoadingPadSpawnPositions).
export const LOADING_PAD_SPOTS = 9;
// One order can always fill an empty loading pad.
export const MAX_CRATES_PER_ORDER = LOADING_PAD_SPOTS;

/**
 * @param {Map<string, number>} order item id -> number of crates
 * @param {{ getCrateCost: (itemId: string) => number, credits: number, freePadSpots: number }} context
 */
export function summarizeSupplyOrder(order, { getCrateCost, credits, freePadSpots }) {
  let crates = 0;
  let stockCost = 0;
  for (const [itemId, count] of order) {
    if (count <= 0) continue;
    crates += count;
    stockCost += getCrateCost(itemId) * count;
  }

  const maxCrates = Math.max(0, Math.min(MAX_CRATES_PER_ORDER, freePadSpots));
  const deliveryFee = crates > 0 ? DELIVERY_FEE : 0;
  const total = stockCost + deliveryFee;

  let problem = null;
  if (crates === 0) {
    problem = freePadSpots <= 0
      ? "The loading pad is full. Carry some crates off it before ordering."
      : null;
  } else if (crates > MAX_CRATES_PER_ORDER) {
    problem = `One delivery holds at most ${MAX_CRATES_PER_ORDER} crates.`;
  } else if (crates > freePadSpots) {
    problem = `Only ${freePadSpots} crate ${freePadSpots === 1 ? "spot is" : "spots are"} free on the loading pad. Remove crates from this order or clear the pad.`;
  } else if (total > credits) {
    problem = `Not enough credits. This order costs ${total} credits and you have ${credits}.`;
  }

  return { crates, maxCrates, stockCost, deliveryFee, total, problem, canPlace: crates > 0 && !problem };
}
