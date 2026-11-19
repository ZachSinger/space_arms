// ==========================================
// FILE: Economy.js
// ==========================================
// Money: the balance, today's itemized receipt, past receipts, and the emergency loan.
import { Slice } from "../Slice.js";
import { DayLedger } from "../../logic/DayLedger.js";
import { isMoney, sumMoney } from "../../logic/Money.js";
import { getDailyLoanRepayment } from "../../logic/EmergencyLoan.js";

export const STARTING_MONEY = 1500;

function copyReceipt(receipt) {
  return {
    ...receipt,
    lines: receipt.lines.map((line) => ({ ...line })),
    shift: receipt.shift ? { ...receipt.shift } : null,
  };
}

export class Economy extends Slice {
  constructor() {
    super();
    this.credits = STARTING_MONEY;
    // Every amount earned or spent today is itemized here for the End Day receipt.
    this.dayLedger = new DayLedger({ day: 1, openingCredits: this.credits, openingReputation: 0 });
    // Every finished day's closed receipt, oldest first, for the Finances tab history.
    this.dayReceipts = [];
    // Outstanding emergency loan: { balance, takenOnDay }, or null when nothing is owed.
    this.emergencyLoan = null;
  }

  /** @param {number} amount */
  canAfford(amount) {
    return this.credits >= amount;
  }

  /**
   * @param {number} amount - money with up to two decimal places, at least 0
   * @param {{ category: string, label: string, quantity?: number }} entry - receipt line
   */
  add(amount, entry) {
    if (!isMoney(amount) || amount < 0) {
      throw new TypeError(`Money earned must be non-negative with at most two decimal places, got ${amount}.`);
    }
    this.#record(amount, entry);
  }

  /**
   * @param {number} amount - money with up to two decimal places, at least 0
   * @param {{ category: string, label: string, quantity?: number }} entry - receipt line
   */
  spend(amount, entry) {
    if (!isMoney(amount) || amount < 0) {
      throw new TypeError(`Money spent must be non-negative with at most two decimal places, got ${amount}.`);
    }
    this.#record(-amount, entry);
    return true;
  }

  #record(amount, entry) {
    const balance = sumMoney([this.credits, amount]);
    this.dayLedger.record({ ...entry, amount });
    this.credits = balance;
    this.changed();
  }

  /**
   * @param {number} amount - received now
   * @param {number} repayTotal - owed back, fee included
   */
  takeLoan(amount, repayTotal) {
    if (this.emergencyLoan) return false;
    this.emergencyLoan = { balance: repayTotal, takenOnDay: this.dayLedger.day };
    this.add(amount, { category: "loans", label: "Emergency loan" });
    return true;
  }

  // Pay the whole remaining balance at once.
  payOffLoan() {
    if (!this.emergencyLoan || this.credits < this.emergencyLoan.balance) return false;
    const { balance } = this.emergencyLoan;
    this.emergencyLoan = null;
    this.spend(balance, { category: "loan_repayments", label: "Emergency loan" });
    return true;
  }

  // At End Day, a share of today's sales goes toward the loan (not on the day it was taken).
  collectLoanRepayment() {
    const loan = this.emergencyLoan;
    if (!loan || loan.takenOnDay === this.dayLedger.day) return 0;
    const salesToday = sumMoney(this.dayLedger.lines
      .filter((line) => line.category === "sales")
      .map((line) => line.amount));
    const payment = getDailyLoanRepayment(loan.balance, salesToday);
    if (payment <= 0) return 0;
    const balance = sumMoney([loan.balance, -payment]);
    this.emergencyLoan = balance > 0 ? { ...loan, balance } : null;
    this.spend(payment, { category: "loan_repayments", label: "Emergency loan" });
    return payment;
  }

  /** @param {{ customersServed: number, customersTurnedAway: number }} results */
  recordShift(results) {
    this.dayLedger.recordShift(results);
  }

  /**
   * Closes today's receipt and opens a fresh one for the next day.
   * @param {number} nextDay
   * @param {number} reputation - store reputation now
   * @returns {object} the finished day's receipt
   */
  closeDay(nextDay, reputation) {
    this.collectLoanRepayment();
    const receipt = this.dayLedger.close(this.credits, reputation);
    this.dayReceipts.push(receipt);
    this.dayLedger = new DayLedger({ day: nextDay, openingCredits: this.credits, openingReputation: reputation });
    this.changed();
    return receipt;
  }

  toSave() {
    return {
      credits: this.credits,
      dayLedger: this.dayLedger.serialize(),
      dayReceipts: this.dayReceipts.map(copyReceipt),
      emergencyLoan: this.emergencyLoan ? { ...this.emergencyLoan } : null,
    };
  }

  /**
   * @param {object} data - the saved player section
   * @param {{ day: number }} context - today, for saves from before receipts
   */
  static fromSave(data, { day }) {
    const economy = new Economy();
    economy.credits = data.credits;
    // Saves from before receipts start today's receipt from the loaded balance.
    economy.dayLedger = data.dayLedger
      ? DayLedger.fromSave(data.dayLedger)
      : new DayLedger({ day, openingCredits: data.credits, openingReputation: data.globalReputation });
    // Saves from before receipt history kept only yesterday's receipt.
    economy.dayReceipts = (data.dayReceipts ?? (data.lastDayReceipt ? [data.lastDayReceipt] : [])).map(copyReceipt);
    economy.emergencyLoan = data.emergencyLoan ? { ...data.emergencyLoan } : null;
    return economy;
  }
}
