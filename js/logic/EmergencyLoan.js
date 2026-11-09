// ==========================================
// FILE: EmergencyLoan.js
// ==========================================
// Safety net for a shop that can no longer continue: no stock left to sell and not enough
// credits for even the cheapest supply order. The loan tops credits up to a fixed balance
// and is repaid automatically from a share of each later day's sales. Numbers are provisional.
import { roundMoney, sumMoney } from "./Money.js";

export const EMERGENCY_LOAN_TARGET_BALANCE = 1000;
export const EMERGENCY_LOAN_FEE_RATE = 0.25;
export const EMERGENCY_LOAN_REPAYMENT_RATE = 0.25;

/**
 * Whether the player can take an emergency loan right now, and its terms.
 * @param {{ credits: number, hasLoan: boolean, shiftRunning: boolean,
 *   ownsSellableStock: boolean, cheapestOrderCost: number | null }} situation
 *   cheapestOrderCost is null when the player holds no supplier license
 * @returns {{ available: boolean, amount: number, repayTotal: number }}
 */
export function getEmergencyLoanOffer({ credits, hasLoan, shiftRunning, ownsSellableStock, cheapestOrderCost }) {
  const stuck = !ownsSellableStock && (cheapestOrderCost === null || credits < cheapestOrderCost);
  const amount = Math.max(0, sumMoney([EMERGENCY_LOAN_TARGET_BALANCE, -credits]));
  const available = stuck && !hasLoan && !shiftRunning && amount > 0;
  return {
    available,
    amount,
    repayTotal: roundMoney(amount * (1 + EMERGENCY_LOAN_FEE_RATE)),
  };
}

/**
 * The repayment taken at End Day: a share of that day's sales, never more than is owed.
 * @param {number} balance - credits still owed
 * @param {number} salesToday - credits earned from customer sales today
 */
export function getDailyLoanRepayment(balance, salesToday) {
  if (balance <= 0 || salesToday <= 0) return 0;
  return Math.min(balance, roundMoney(salesToday * EMERGENCY_LOAN_REPAYMENT_RATE));
}
