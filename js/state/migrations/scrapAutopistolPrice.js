import { isRecord, requireSave } from "../saveHelpers.js";
import { isMoney, roundMoney } from "../../logic/Money.js";
import { MIN_BASE_RATIO, MAX_BASE_RATIO } from "../../logic/Market.js";

const ITEM_ID = "wpn_pis_02";
const PREVIOUS_BASE_COST = 50;

export function repriceScrapAutopistol(data, database) {
  const item = database.getAllItems().find(({ id }) => id === ITEM_ID);
  if (!item || !isRecord(data.market) || !isRecord(data.market.prices)) return data;
  const price = data.market.prices[ITEM_ID];
  requireSave(isMoney(price) && price >= PREVIOUS_BASE_COST * MIN_BASE_RATIO &&
    price <= PREVIOUS_BASE_COST * MAX_BASE_RATIO, `invalid market price for ${ITEM_ID}.`);
  return {
    ...data,
    market: {
      ...data.market,
      prices: {
        ...data.market.prices,
        [ITEM_ID]: roundMoney(price * item.baseCost / PREVIOUS_BASE_COST),
      },
    },
  };
}
