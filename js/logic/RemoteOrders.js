import { roundMoney } from "./Money.js";

export const REMOTE_ORDER_TUNING = Object.freeze({
  chancePerCustomer: 0.01,
  minProductTypes: 2,
  maxProductTypes: 4,
  minUnitsPerProduct: 3,
  maxUnitsPerProduct: 8,
  payoutMarkup: 0.3,
  daysUntilExpiry: 1,
  reputationPerProductType: 1,
});

function randomInt(random, min, max) {
  return min + Math.floor(Math.max(0, Math.min(1 - Number.EPSILON, random())) * (max - min + 1));
}

/**
 * Builds an order from items the shop has a license to sell.
 * @param {{ items: object[], day: number, random: () => number,
 *   ownsLicense: (licenseId: string) => boolean, marketPrice: (itemId: string) => number }} options
 */
export function createRemoteOrder({
  items,
  day,
  random,
  ownsLicense,
  marketPrice,
}) {
  const available = items.filter((item) => item.license && ownsLicense(item.license));
  if (available.length < REMOTE_ORDER_TUNING.minProductTypes) return null;

  const shuffled = [...available];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = randomInt(random, 0, index);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  const count = randomInt(
    random,
    REMOTE_ORDER_TUNING.minProductTypes,
    Math.min(REMOTE_ORDER_TUNING.maxProductTypes, shuffled.length),
  );
  const itemsRequired = shuffled.slice(0, count).map((item) => ({
    itemId: item.id,
    quantity: randomInt(
      random,
      REMOTE_ORDER_TUNING.minUnitsPerProduct,
      REMOTE_ORDER_TUNING.maxUnitsPerProduct,
    ),
  }));
  const marketTotal = itemsRequired.reduce(
    (sum, line) => sum + marketPrice(line.itemId) * line.quantity,
    0,
  );

  return {
    receivedDay: day,
    expiresOnDay: day + REMOTE_ORDER_TUNING.daysUntilExpiry,
    items: itemsRequired,
    payout: roundMoney(marketTotal * (1 + REMOTE_ORDER_TUNING.payoutMarkup)),
    reputation: count * REMOTE_ORDER_TUNING.reputationPerProductType,
  };
}
