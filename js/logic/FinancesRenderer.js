// ==========================================
// FILE: FinancesRenderer.js
// ==========================================
// Finances tab HTML (bible Step 43): today's itemized receipt, the End Day button, and
// the previous day's final receipt.
import { formatMoney } from "./Money.js";
import { EMERGENCY_LOAN_REPAYMENT_RATE, EMERGENCY_LOAN_TARGET_BALANCE } from "./EmergencyLoan.js";

const credits = formatMoney;
const signed = (amount) => (amount === 0 ? credits(0) : `${amount > 0 ? "+" : "-"}${credits(Math.abs(amount))}`);
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// What each receipt line says, so a player reading it knows exactly what the money was for.
function describeLine({ category, label, quantity }) {
  switch (category) {
    case "sales": return `Sold ${label} (${plural(quantity, "item", "items")})`;
    case "stock_orders": return `Supply: ${label} (${plural(quantity, "crate", "crates")})`;
    case "delivery_fees": return `Delivery fees (${plural(quantity, "order", "orders")})`;
    case "fixtures": return `Fixture: ${label}${quantity > 1 ? ` (${quantity})` : ""}`;
    case "expansions": return `Bought store expansion: ${label}${quantity > 1 ? ` (${quantity})` : ""}`;
    case "fixture_sales": return `Sold fixture: ${label}${quantity > 1 ? ` (${quantity})` : ""}`;
    case "equipment": return `Equipment upgrade: ${label}`;
    case "licenses": return `Signed supplier license: ${label}`;
    case "hiring": return `Hired ${label}`;
    case "wages": return `Wages paid to ${label}${quantity > 1 ? ` (${plural(quantity, "shift", "shifts")})` : ""}`;
    case "loans": return "Emergency loan received";
    case "loan_repayments": return `Emergency loan repayment${quantity > 1 ? ` (${plural(quantity, "payment", "payments")})` : ""}`;
    default: throw new Error(`Unknown receipt category: ${category}`);
  }
}

const row = (label, value, className = "") =>
  `<div class="finances-row ${className}"><span>${label}</span><span class="finances-value">${value}</span></div>`;

const repaymentPercent = `${Math.round(EMERGENCY_LOAN_REPAYMENT_RATE * 100)}%`;

// Only shown when the shop is stuck (nothing to sell, can't afford stock) or still owes money.
function renderEmergencyLoan(loan) {
  if (!loan) return "";
  if (loan.balance > 0) {
    return `
      <div class="finances-heading">EMERGENCY LOAN</div>
      <div class="fixture-stock-meta">You still owe ${credits(loan.balance)} on your emergency loan.
        Each time you end the day, ${repaymentPercent} of that day's sales is paid toward it automatically.</div>
      <button type="button" class="action-btn" data-pay-off-emergency-loan
        ${loan.canPayOff ? "" : `disabled title="You need ${credits(loan.balance)} to pay it all now."`}>PAY IT ALL NOW (${credits(loan.balance)})</button>
    `;
  }
  if (!loan.offer.available) return "";
  return `
    <div class="finances-heading">EMERGENCY LOAN</div>
    <div class="fixture-stock-meta">You have nothing left to sell and not enough credits to order stock.
      The bank will lend you ${credits(loan.offer.amount)}, bringing you to ${credits(EMERGENCY_LOAN_TARGET_BALANCE)}.
      You will owe ${credits(loan.offer.repayTotal)} in total. Starting the day after you take it,
      ${repaymentPercent} of each day's sales is paid toward it automatically when you end the day.</div>
    <button type="button" class="action-btn warning" data-take-emergency-loan>TAKE LOAN (+${credits(loan.offer.amount)})</button>
  `;
}

function renderReceipt(receipt, { final, pendingReputationChange = null }) {
  const lines = (entries) => entries.map((line) =>
    row(describeLine(line), signed(line.amount), line.amount >= 0 ? "earned" : "spent")).join("");
  const shift = receipt.shift;
  const reputationChange = pendingReputationChange === null
    ? receipt.reputationChange
    : pendingReputationChange;
  return `
    <div class="finances-receipt">
      ${row("Credits at the start of the day", credits(receipt.openingCredits))}
      <div class="finances-section-title">EARNED</div>
      ${receipt.earned.length ? lines(receipt.earned) : `<div class="finances-empty">${final ? "Nothing sold." : "Nothing sold yet."}</div>`}
      <div class="finances-section-title">SPENT</div>
      ${receipt.spent.length ? lines(receipt.spent) : `<div class="finances-empty">${final ? "Nothing spent." : "Nothing spent yet."}</div>`}
      <div class="finances-totals">
        ${row("Total earned", signed(receipt.totalEarned), receipt.totalEarned > 0 ? "earned" : "")}
        ${row("Total spent", signed(-receipt.totalSpent), receipt.totalSpent > 0 ? "spent" : "")}
        ${row(final ? "Credits at the end of the day" : "Credits", credits(receipt.closingCredits), "finances-balance")}
        ${row(pendingReputationChange === null ? "Store reputation change" : "Reputation change at shift end",
    reputationChange === 0 ? "No change" : `${reputationChange > 0 ? "+" : ""}${reputationChange}`)}
        ${shift ? row("Customers served", shift.customersServed) : ""}
        ${shift ? row("Customers turned away (store was full)", shift.customersTurnedAway, shift.customersTurnedAway > 0 ? "spent" : "") : ""}
      </div>
    </div>
  `;
}

export const FinancesRenderer = {
  /**
   * @param {{ day: number, shiftRunning: boolean, awaitingEndDay: boolean, canEndDay: boolean,
   *   pendingReputationChange: number | null, today: object, lastDay: object | null }} view
   * @returns {string}
   */
  generateHTML(view) {
    let status;
    let action = "";
    if (view.shiftRunning) {
      status = "The shift is running. Credits update now; reputation changes are applied at the end of the shift.";
    } else if (view.awaitingEndDay) {
      status = `The shift is over. Restock and change prices now if you like, then end the day. Ending the day moves to Day ${view.day + 1} and changes market prices.`;
      action = `<button type="button" class="action-btn finances-end-day-btn" data-end-day
        ${view.canEndDay ? "" : "disabled title=\"Finish placing the fixture first.\""}>END DAY ${view.day}</button>`;
    } else {
      status = `Day ${view.day} is ready. Anything you buy before the shift counts toward today's receipt.`;
      action = `<button type="button" class="action-btn finances-start-shift-btn" data-finances-start-shift>START SHIFT</button>`;
    }
    return `
      <div class="finances-panel">
        <div class="fixture-stock-meta">${status}</div>
        ${action}
        ${renderEmergencyLoan(view.emergencyLoan)}
        <div class="finances-heading">DAY ${view.today.day} RECEIPT${view.awaitingEndDay ? "" : " (SO FAR)"}</div>
        ${renderReceipt(view.today, { final: false, pendingReputationChange: view.pendingReputationChange })}
        ${view.lastDay ? `
          <div class="finances-heading">DAY ${view.lastDay.day} RECEIPT (FINAL)</div>
          ${renderReceipt(view.lastDay, { final: true })}
        ` : ""}
      </div>
    `;
  },
};
