import assert from "node:assert/strict";
import test from "node:test";
import {
  EMERGENCY_LOAN_TARGET_BALANCE,
  getDailyLoanRepayment,
  getEmergencyLoanOffer,
} from "../js/logic/EmergencyLoan.js";
import { FinancesRenderer } from "../js/logic/FinancesRenderer.js";
import { summarizeReceipt } from "../js/logic/DayLedger.js";

const stuck = { credits: -200, hasLoan: false, shiftRunning: false, ownsSellableStock: false, cheapestOrderCost: 50 };

test("the emergency loan is only offered to a stuck shop between shifts", () => {
  assert.deepEqual(getEmergencyLoanOffer(stuck), { available: true, amount: 1200, repayTotal: 1500 });
  assert.equal(getEmergencyLoanOffer({ ...stuck, credits: 49.5 }).available, true);
  assert.equal(getEmergencyLoanOffer({ ...stuck, credits: 50 }).available, false, "can afford an order");
  assert.equal(getEmergencyLoanOffer({ ...stuck, ownsSellableStock: true }).available, false);
  assert.equal(getEmergencyLoanOffer({ ...stuck, hasLoan: true }).available, false);
  assert.equal(getEmergencyLoanOffer({ ...stuck, shiftRunning: true }).available, false);
  assert.equal(getEmergencyLoanOffer({ ...stuck, credits: 20, cheapestOrderCost: null }).available, true);
  assert.equal(getEmergencyLoanOffer({ ...stuck, credits: 20, cheapestOrderCost: 5000 }).amount,
    EMERGENCY_LOAN_TARGET_BALANCE - 20);
});

test("daily repayment is a share of sales and never more than is owed", () => {
  assert.equal(getDailyLoanRepayment(1500, 0), 0);
  assert.equal(getDailyLoanRepayment(1500, 401), 100.25);
  assert.equal(getDailyLoanRepayment(30, 401), 30);
  assert.equal(getDailyLoanRepayment(0, 401), 0);
});

test("the Finances tab offers the loan, shows what is owed, and labels the receipt lines", () => {
  const today = summarizeReceipt({ day: 1, openingCredits: -200, openingReputation: 0, shift: null,
    lines: [{ category: "loans", label: "Emergency loan", amount: 500, quantity: 1 }] }, 300, 0);
  const base = { day: 1, shiftRunning: false, awaitingEndDay: false, canEndDay: false,
    pendingReputationChange: null, today, lastDay: null };

  const offered = FinancesRenderer.generateHTML({ ...base, emergencyLoan: {
    offer: { available: true, amount: 1200, repayTotal: 1500 }, balance: 0, canPayOff: false } });
  assert.match(offered, /data-take-emergency-loan/);
  assert.match(offered, /lend you 1,200 credits/);
  assert.match(offered, /Emergency loan received/);

  const owed = FinancesRenderer.generateHTML({ ...base, emergencyLoan: {
    offer: { available: false, amount: 0, repayTotal: 0 }, balance: 625, canPayOff: false } });
  assert.match(owed, /still owe 625 credits/);
  assert.match(owed, /data-pay-off-emergency-loan\s+disabled/);
  assert.doesNotMatch(owed, /data-take-emergency-loan/);

  const hidden = FinancesRenderer.generateHTML({ ...base, emergencyLoan: {
    offer: { available: false, amount: 0, repayTotal: 0 }, balance: 0, canPayOff: false } });
  assert.doesNotMatch(hidden, /EMERGENCY LOAN/);
});
