// Money stays in credits in saves; arithmetic uses integer cents to avoid rounding drift.
export function isMoney(value) {
  if (!Number.isFinite(value)) return false;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) < 0.000001;
}

export function toCents(value) {
  if (!isMoney(value)) throw new TypeError(`Money must have at most two decimal places: ${value}.`);
  return Math.round(value * 100);
}

export function fromCents(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`Invalid cent amount: ${value}.`);
  return value / 100;
}

export function roundMoney(value) {
  return fromCents(Math.round(value * 100));
}

/**
 * A store price after a price-control button: roughly ±10% (at least 1 credit, never
 * below 1 credit), or the market price.
 * @param {number} currentPrice - credits
 * @param {number} marketPrice - credits
 * @param {"decrease" | "increase" | "market"} action
 * @returns {number | null} credits, or null for an unknown action
 */
export function adjustStorePrice(currentPrice, marketPrice, action) {
  if (action === "decrease") {
    return Math.max(1, Math.min(roundMoney(currentPrice - 1), roundMoney(currentPrice * 0.9)));
  }
  if (action === "increase") return Math.max(roundMoney(currentPrice + 1), roundMoney(currentPrice * 1.1));
  if (action === "market") return marketPrice;
  return null;
}

export function sumMoney(values) {
  return fromCents(values.reduce((sum, value) => sum + toCents(value), 0));
}

export function formatMoney(value) {
  const normalized = fromCents(toCents(value));
  return `${normalized.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(normalized) ? 0 : 2,
    maximumFractionDigits: 2,
  })} credits`;
}
