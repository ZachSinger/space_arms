// The money rebalance put every item on one steady price curve by unlock level. Market
// prices and the player's own shelf prices are scaled by each item's change in base price,
// so the market keeps its daily drift and the player keeps the same markup.
import { isRecord } from "../saveHelpers.js";
import { isMoney, roundMoney } from "../../logic/Money.js";
import { MIN_BASE_RATIO, MAX_BASE_RATIO } from "../../logic/Market.js";
import previousBaseCosts from "./moneyRebalancePreviousPrices.json" with { type: "json" };

function rescale(prices, newBaseCosts, clampToMarketBand) {
  return Object.fromEntries(Object.entries(prices).map(([itemId, price]) => {
    const previous = previousBaseCosts[itemId];
    const next = newBaseCosts.get(itemId);
    if (!isMoney(price) || !previous || !next) return [itemId, price];
    let scaled = roundMoney(price * next / previous);
    if (clampToMarketBand) {
      scaled = Math.min(roundMoney(next * MAX_BASE_RATIO), Math.max(roundMoney(next * MIN_BASE_RATIO), scaled));
    }
    return [itemId, Math.max(1, scaled)];
  }));
}

export function rebalanceItemPrices(data, database) {
  const newBaseCosts = new Map(database.getAllItems().map((item) => [item.id, item.baseCost]));
  const market = isRecord(data.market) && isRecord(data.market.prices)
    ? { ...data.market, prices: rescale(data.market.prices, newBaseCosts, true) }
    : data.market;
  const player = isRecord(data.playerState) && isRecord(data.playerState.storePrices)
    ? { ...data.playerState, storePrices: rescale(data.playerState.storePrices, newBaseCosts, false) }
    : data.playerState;
  return { ...data, market, playerState: player };
}
