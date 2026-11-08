// Unlimited placeholder drawer. Payment and change are counted in integer cents.
import { fromCents, toCents } from "./Money.js";

export const CASH_DENOMINATIONS = Object.freeze([
  ...[1, 5, 10, 20].map((credits) => Object.freeze({
    cents: credits * 100, kind: "bill", label: `${credits} ${credits === 1 ? "credit" : "credits"}`,
  })),
  ...[1, 5, 10, 25, 50].map((cents) => Object.freeze({
    cents, kind: "coin", label: `${cents} ${cents === 1 ? "cent" : "cents"}`,
  })),
]);

export function splitCash(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new TypeError(`Invalid cash amount: ${cents}.`);
  let remaining = cents;
  return [...CASH_DENOMINATIONS].sort((a, b) => b.cents - a.cents)
    .map((denomination) => {
      const count = Math.floor(remaining / denomination.cents);
      remaining -= count * denomination.cents;
      return { ...denomination, count };
    }).filter(({ count }) => count > 0);
}

export class CashPayment {
  constructor(total, tender) {
    this.totalCents = toCents(total);
    if (this.totalCents < 0) throw new TypeError("A cash sale cannot have a negative total.");
    // Customers offer whole bills, rounding the last part up to a drawer denomination.
    const twenties = Math.floor(this.totalCents / 2000) * 2000;
    const remainder = this.totalCents - twenties;
    const lastBill = [0, 100, 500, 1000, 2000].find((bill) => bill >= remainder);
    this.tenderCents = tender === undefined ? twenties + lastBill : toCents(tender);
    if (this.tenderCents < this.totalCents) throw new TypeError("Cash offered must cover the total.");
    this.changeDueCents = this.tenderCents - this.totalCents;
    // One entry per physical bill or coin the customer hands over; each must be taken.
    this.tenderPieces = splitCash(this.tenderCents).flatMap(({ count, ...denomination }) =>
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

  get changeCents() {
    return [...this.change].reduce((sum, [cents, count]) => sum + cents * count, 0);
  }

  adjustChange(cents, direction) {
    if (!CASH_DENOMINATIONS.some((denomination) => denomination.cents === cents) ||
      ![1, -1].includes(direction)) throw new TypeError("Invalid drawer selection.");
    if (this.completed) return;
    const count = Math.max(0, (this.change.get(cents) ?? 0) + direction);
    if (!Number.isSafeInteger(this.changeCents + (count - (this.change.get(cents) ?? 0)) * cents)) {
      throw new RangeError("Selected change is too large.");
    }
    if (count === 0) this.change.delete(cents);
    else this.change.set(cents, count);
  }

  handOver() {
    if (this.completed) return { accepted: false, penalty: false };
    if (this.changeCents === this.changeDueCents) {
      this.completed = true;
      return { accepted: true, penalty: false };
    }
    this.mistakes += 1;
    return { accepted: false, penalty: this.mistakes > 1 };
  }

  get tender() {
    return fromCents(this.tenderCents);
  }
}
