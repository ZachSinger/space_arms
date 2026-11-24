import { roundMoney } from "./Money.js";

export const REMOTE_ORDER_TUNING = Object.freeze({
  // Remote orders come from people outside the store, so they roll on the shift clock.
  chancePerShiftHour: 0.15,
  // An offer waits at the terminal for this many shifts, counting the one it arrived in.
  // Letting it lapse or declining it never costs reputation.
  offerShifts: 2,
  // Once accepted, the order must ship within this many shifts, counting the one it was accepted in.
  fillShifts: 3,
  minProductTypes: 2,
  // The most product types any store level allows; see remoteOrderScaling.
  maxProductTypes: 6,
  minUnitsPerProduct: 3,
  maxUnitsPerProduct: 8,
  payoutMarkup: 0.3,
  reputationPerProductType: 1,
});

/**
 * Every 10 store levels, one more offer can wait at the terminal and orders can hold one more
 * product type. Levels 1-10: 1 offer, 2-3 types; 11-20: 2 offers, 2-4 types; and so on.
 * @param {number} shopLevel
 */
export function remoteOrderScaling(shopLevel) {
  const step = Math.max(0, Math.floor((shopLevel - 1) / 10));
  return {
    maxOffers: 1 + step,
    maxProductTypes: Math.min(REMOTE_ORDER_TUNING.maxProductTypes, 3 + step),
  };
}

function randomInt(random, min, max) {
  return min + Math.floor(Math.max(0, Math.min(1 - Number.EPSILON, random())) * (max - min + 1));
}

/**
 * Builds an order offer from items whose supplier contract the store's level allows buying,
 * whether or not the store owns that contract yet.
 * @param {{ items: object[], day: number, shopLevel: number, random: () => number,
 *   licenseLevel: (licenseId: string) => number | undefined,
 *   marketPrice: (itemId: string) => number }} options
 */
export function createRemoteOrder({
  items,
  day,
  shopLevel,
  random,
  licenseLevel,
  marketPrice,
}) {
  const available = items.filter((item) => {
    const level = item.license ? licenseLevel(item.license) : undefined;
    return level !== undefined && level <= shopLevel;
  });
  if (available.length < REMOTE_ORDER_TUNING.minProductTypes) return null;

  const shuffled = [...available];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = randomInt(random, 0, index);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  const count = randomInt(
    random,
    REMOTE_ORDER_TUNING.minProductTypes,
    Math.min(remoteOrderScaling(shopLevel).maxProductTypes, shuffled.length),
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
    offerEndsDay: day + REMOTE_ORDER_TUNING.offerShifts - 1,
    items: itemsRequired,
    payout: roundMoney(marketTotal * (1 + REMOTE_ORDER_TUNING.payoutMarkup)),
    reputation: count * REMOTE_ORDER_TUNING.reputationPerProductType,
  };
}

/**
 * Turns an accepted offer into the open order the store must ship.
 * @param {object} offer
 * @param {number} day - the day it was accepted
 */
export function acceptRemoteOffer(offer, day) {
  const { offerEndsDay: _offerEndsDay, ...order } = offer;
  return { ...order, acceptedDay: day, expiresOnDay: day + REMOTE_ORDER_TUNING.fillShifts - 1 };
}