import { isRecord, requireSave } from "../saveHelpers.js";
import { isMoney, roundMoney } from "../../logic/Money.js";
import { MIN_BASE_RATIO, MAX_BASE_RATIO } from "../../logic/Market.js";

const ITEM_ID = "wpn_pis_02";
const PREVIOUS_BASE_COST = 50;
// The price it was cut to; the later money rebalance step scales it from there.
const REPRICED_BASE_COST = 25;

export function repriceScrapAutopistol(data) {
  if (!isRecord(data.market) || !isRecord(data.market.prices)) return data;
  const price = data.market.prices[ITEM_ID];
  requireSave(isMoney(price) && price >= PREVIOUS_BASE_COST * MIN_BASE_RATIO &&
    price <= PREVIOUS_BASE_COST * MAX_BASE_RATIO, `invalid market price for ${ITEM_ID}.`);
  return {
    ...data,
    market: {
      ...data.market,
      prices: {
        ...data.market.prices,
        [ITEM_ID]: roundMoney(price * REPRICED_BASE_COST / PREVIOUS_BASE_COST),
      },
    },
  };
}
