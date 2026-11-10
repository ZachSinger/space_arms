// Unlimited placeholder drawer. Credit amounts use cents; M-Scrip amounts use whole scrips.
import { fromCents, toCents } from "./Money.js";

const CREDIT_DENOMINATIONS = Object.freeze([
  ...[1, 5, 10, 20].map((credits) => Object.freeze({
    units: credits * 100, kind: "bill", label: `${credits} ${credits === 1 ? "credit" : "credits"}`,
  })),
  ...[1, 5, 10, 25, 50].map((units) => Object.freeze({
    units, kind: "coin", label: `${units} ${units === 1 ? "cent" : "cents"}`,
  })),
]);

export const M_SCRIP_DENOMINATIONS = Object.freeze(
  [1, 5, 10, 25, 50, 100, 500, 1000].map((scrips) => Object.freeze({
    units: scrips,
    kind: "bill",
    label: `${scrips.toLocaleString("en-US")} ${scrips === 1 ? "M-Scrip" : "M-Scrips"}`,
  })),
);

export const CASH_DENOMINATIONS = CREDIT_DENOMINATIONS;

export function getCashDenominations(currency = "credits") {
  if (currency === "credits") return CREDIT_DENOMINATIONS;
  if (currency === "m-scrips") return M_SCRIP_DENOMINATIONS;
  throw new TypeError(`Unknown cash currency: ${currency}.`);
}

export function formatCashAmount(amount, currency = "credits") {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new TypeError(`Invalid cash amount: ${amount}.`);
  }
  if (currency === "credits") {
    const credits = fromCents(amount).toLocaleString("en-US", {
      minimumFractionDigits: amount % 100 ? 2 : 0,
      maximumFractionDigits: 2,
    });
    return `${credits} credits`;
  }
  if (currency === "m-scrips") return `${amount.toLocaleString("en-US")} M-Scrips`;
  throw new TypeError(`Unknown cash currency: ${currency}.`);
}

export function creditCentsToScrips(creditCents) {
  if (!Number.isSafeInteger(creditCents) || creditCents < 0) {
    throw new TypeError(`Invalid credit amount: ${creditCents}.`);
  }
  const scrips = Math.floor(creditCents / 5) * 6 + Math.ceil((creditCents % 5) * 6 / 5);
  if (!Number.isSafeInteger(scrips)) throw new RangeError("M-Scrip amount is too large.");
  return scrips;
}

function getDefaultTender(totalUnits, currency) {
  if (totalUnits === 0) return 0;
  if (currency === "credits") {
    // Customers offer whole bills, rounding the last part up to a drawer denomination.
    const twenties = Math.floor(totalUnits / 2000) * 2000;
    const remainder = totalUnits - twenties;
    const lastBill = [0, 100, 500, 1000, 2000].find((bill) => bill >= remainder);
    return twenties + lastBill;
  }
  const tender = (Math.floor(totalUnits / 100) + 1) * 100;
  if (!Number.isSafeInteger(tender)) throw new RangeError("M-Scrip tender is too large.");
  return tender;
}

export function splitCash(amount, currency = "credits") {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError(`Invalid cash amount: ${amount}.`);
  let remaining = amount;
  return [...getCashDenominations(currency)].sort((a, b) => b.units - a.units)
    .map((denomination) => {
      const count = Math.floor(remaining / denomination.units);
      remaining -= count * denomination.units;
      return { ...denomination, count };
    }).filter(({ count }) => count > 0);
}

export class CashPayment {
  constructor(total, tender, currency = "credits") {
    this.currency = currency;
    getCashDenominations(currency);
    this.totalCents = toCents(total);
    if (this.totalCents < 0) throw new TypeError("A cash sale cannot have a negative total.");
    this.totalUnits = currency === "m-scrips"
      ? creditCentsToScrips(this.totalCents)
      : this.totalCents;
    this.tenderUnits = tender === undefined
      ? getDefaultTender(this.totalUnits, currency)
      : currency === "m-scrips"
        ? tender
        : toCents(tender);
    if (!Number.isSafeInteger(this.tenderUnits) || this.tenderUnits < this.totalUnits) {
      throw new TypeError("Cash offered must be a whole amount that covers the total.");
    }
    this.changeDueUnits = this.tenderUnits - this.totalUnits;
    // One entry per physical bill or coin the customer hands over; each must be taken.
    this.tenderPieces = splitCash(this.tenderUnits, currency).flatMap(({ count, ...denomination }) =>
      Array.from({ length: count }, () => ({ ...denomination, taken: false })));
    this.change = new Map();
    this.mistakes = 0;
    this.completed = false;
  }

  get allTenderTaken() {
    return this.tenderPieces.every((piece) => piece.taken);
  }

  /**
   * @param {number} index - into tenderPieces
   * @returns {boolean} whether that was a piece still waiting to be taken
   */
  takeTenderPiece(index) {
    const piece = this.tenderPieces[index];
    if (!piece || piece.taken) return false;
    piece.taken = true;
    return true;
  }

  get changeUnits() {
    return [...this.change].reduce((sum, [amount, count]) => sum + amount * count, 0);
  }

  adjustChange(amount, direction) {
    if (!getCashDenominations(this.currency).some((denomination) => denomination.units === amount) ||
      ![1, -1].includes(direction)) throw new TypeError("Invalid drawer selection.");
    if (this.completed) return;
    const count = Math.max(0, (this.change.get(amount) ?? 0) + direction);
    if (!Number.isSafeInteger(this.changeUnits + (count - (this.change.get(amount) ?? 0)) * amount)) {
      throw new RangeError("Selected change is too large.");
    }
    if (count === 0) this.change.delete(amount);
    else this.change.set(amount, count);
  }

  handOver() {
    if (this.completed) return { accepted: false, penalty: false };
    if (this.changeUnits === this.changeDueUnits) {
      this.completed = true;
      return { accepted: true, penalty: false };
    }
    this.mistakes += 1;
    return { accepted: false, penalty: this.mistakes > 1 };
  }

  get tender() {
    return this.currency === "credits" ? fromCents(this.tenderUnits) : this.tenderUnits;
  }
}
