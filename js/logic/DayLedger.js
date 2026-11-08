// ==========================================
// FILE: DayLedger.js
// ==========================================
// One day's money record (bible Step 43), from one End Day to the next: every credit
// earned or spent, grouped into receipt lines, plus how the day's shift went.
import { isMoney, sumMoney } from "./Money.js";

// Receipt sections, in display order.
export const LEDGER_CATEGORIES = Object.freeze([
  "sales",
  "stock_orders",
  "delivery_fees",
  "fixtures",
  "fixture_sales",
  "equipment",
  "licenses",
  "hiring",
  "wages",
]);

const isWholeNumber = (value, minimum = Number.MIN_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= minimum;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function isValidLine(line) {
  return isRecord(line) && LEDGER_CATEGORIES.includes(line.category) &&
    typeof line.label === "string" && line.label.length > 0 &&
    isWholeNumber(line.quantity, 1) && isMoney(line.amount);
}

function isValidShift(shift) {
  return shift === null || (isRecord(shift) &&
    isWholeNumber(shift.customersServed, 0) && isWholeNumber(shift.customersTurnedAway, 0));
}

/**
 * Checks saved ledger data. Closed receipts also carry the day's closing totals.
 * @param {unknown} data
 * @param {{ closed?: boolean }} [options]
 * @returns {boolean}
 */
export function isValidLedgerData(data, { closed = false } = {}) {
  if (!isRecord(data) || !isWholeNumber(data.day, 1) ||
    !isMoney(data.openingCredits) || !isWholeNumber(data.openingReputation) ||
    !Array.isArray(data.lines) || !data.lines.every(isValidLine) ||
    !isValidShift(data.shift ?? null)) return false;
  const keys = data.lines.map((line) => `${line.category}\u0000${line.label}`);
  if (new Set(keys).size !== keys.length) return false;
  return !closed || (isMoney(data.closingCredits) && isWholeNumber(data.closingReputation));
}

export class DayLedger {
  /**
   * @param {{ day: number, openingCredits: number, openingReputation: number }} start
   */
  constructor({ day, openingCredits, openingReputation }) {
    if (!isWholeNumber(day, 1) || !isMoney(openingCredits) ||
      !isWholeNumber(openingReputation)) {
      throw new TypeError("A day ledger needs valid opening credits and whole-number day and reputation.");
    }
    this.day = day;
    this.openingCredits = openingCredits;
    this.openingReputation = openingReputation;
    this.lines = [];
    this.shift = null;
  }

  /**
   * Adds credits to a receipt line, merging with any line of the same category and label.
   * @param {{ category: string, label: string, amount: number, quantity?: number }} entry
   *   amount is positive for credits earned and negative for credits spent
   */
  record({ category, label, amount, quantity = 1 }) {
    const line = { category, label, amount, quantity };
    if (!isValidLine(line)) {
      throw new TypeError(`Invalid receipt entry: ${JSON.stringify(line)}`);
    }
    const existing = this.lines.find((candidate) =>
      candidate.category === category && candidate.label === label);
    if (existing) {
      existing.amount = sumMoney([existing.amount, amount]);
      existing.quantity += quantity;
    } else {
      this.lines.push(line);
    }
  }

  /**
   * @param {{ customersServed: number, customersTurnedAway: number }} results
   */
  recordShift({ customersServed, customersTurnedAway }) {
    const shift = { customersServed, customersTurnedAway };
    if (!isValidShift(shift)) throw new TypeError("Invalid shift results.");
    this.shift = shift;
  }

  /**
   * The finished day's receipt.
   * @param {number} closingCredits
   * @param {number} closingReputation
   */
  close(closingCredits, closingReputation) {
    return { ...this.serialize(), closingCredits, closingReputation };
  }

  serialize() {
    return {
      day: this.day,
      openingCredits: this.openingCredits,
      openingReputation: this.openingReputation,
      lines: this.lines.map((line) => ({ ...line })),
      shift: this.shift ? { ...this.shift } : null,
    };
  }

  static fromSave(data) {
    if (!isValidLedgerData(data)) throw new TypeError("Invalid saved day ledger.");
    const ledger = new DayLedger(data);
    ledger.lines = data.lines.map((line) => ({ ...line }));
    ledger.shift = data.shift ? { ...data.shift } : null;
    return ledger;
  }
}

/**
 * Splits receipt data into earned/spent lines in section order, with totals.
 * @param {object} data - ledger or closed receipt data
 * @param {number} currentCredits - closing credits, or the current balance for an open day
 * @param {number} currentReputation
 */
export function summarizeReceipt(data, currentCredits, currentReputation) {
  const ordered = [...data.lines].sort((a, b) =>
    LEDGER_CATEGORIES.indexOf(a.category) - LEDGER_CATEGORIES.indexOf(b.category));
  const earned = ordered.filter((line) => line.amount > 0);
  const spent = ordered.filter((line) => line.amount < 0);
  return {
    day: data.day,
    openingCredits: data.openingCredits,
    closingCredits: currentCredits,
    reputationChange: currentReputation - data.openingReputation,
    earned,
    spent,
    totalEarned: sumMoney(earned.map((line) => line.amount)),
    totalSpent: -sumMoney(spent.map((line) => line.amount)),
    shift: data.shift ?? null,
  };
}
