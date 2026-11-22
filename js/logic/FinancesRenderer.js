// ==========================================
// FILE: FinancesRenderer.js
// ==========================================
// Finances tab HTML (bible Step 43): one button per day on the left, that day's full
// receipt on the right, plus all-time totals. Today's receipt carries the day's actions
// (start shift / end day) and the emergency loan when it applies.
import { formatMoneyAmount, sumMoney } from "./Money.js";
import { EMERGENCY_LOAN_REPAYMENT_RATE, EMERGENCY_LOAN_TARGET_BALANCE } from "./EmergencyLoan.js";
import { html } from "../core/html.js";

const money = formatMoneyAmount;
const signed = (amount) => (amount === 0 ? money(0) : `${amount > 0 ? "+" : "-"}${money(Math.abs(amount))}`);
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
    case "training": return `Training: ${label}`;
    case "wages": return `Wages paid to ${label}${quantity > 1 ? ` (${plural(quantity, "shift", "shifts")})` : ""}`;
    case "loans": return "Emergency loan received";
    case "loan_repayments": return `Emergency loan repayment${quantity > 1 ? ` (${plural(quantity, "payment", "payments")})` : ""}`;
    case "debug": return `Debug test funds: ${label}`;
    default: throw new Error(`Unknown receipt category: ${category}`);
  }
}

const row = (label, value, className = "") => html`
  <div class="finances-row ${className}"><span>${label}</span><span class="finances-value">${value}</span></div>
`;

const repaymentPercent = `${Math.round(EMERGENCY_LOAN_REPAYMENT_RATE * 100)}%`;

// Only shown when the shop is stuck (nothing to sell, can't afford stock) or still owes money.
function renderEmergencyLoan(loan) {
  if (!loan) return null;
  if (loan.balance > 0) {
    return html`
      <div class="item-card finances-loan-card">
        <h3 class="type-h3">Emergency Loan</h3>
        <p class="type-description">You still owe ${money(loan.balance)} on your emergency loan.
          Each time you end the day, ${repaymentPercent} of that day's sales is paid toward it automatically.</p>
        <button type="button" class="action-btn" data-pay-off-emergency-loan
          ${loan.canPayOff ? "" : html`disabled title="You need ${money(loan.balance)} to pay it all now."`}>PAY IT ALL NOW (${money(loan.balance)})</button>
      </div>
    `;
  }
  if (!loan.offer.available) return null;
  return html`
    <div class="item-card finances-loan-card">
      <h3 class="type-h3">Emergency Loan</h3>
      <p class="type-description">You have nothing left to sell and not enough money to order stock.
        The bank will lend you ${money(loan.offer.amount)}, bringing you to ${money(EMERGENCY_LOAN_TARGET_BALANCE)}.
        You will owe ${money(loan.offer.repayTotal)} in total. Starting the day after you take it,
        ${repaymentPercent} of each day's sales is paid toward it automatically when you end the day.</p>
      <button type="button" class="action-btn warning" data-take-emergency-loan>TAKE LOAN (+${money(loan.offer.amount)})</button>
    </div>
  `;
}

function renderReceipt(receipt, { final, pendingReputationChange = null }) {
  const lines = (entries) => entries.map((line) =>
    row(describeLine(line), signed(line.amount), line.amount >= 0 ? "earned" : "spent"));
  const shift = receipt.shift;
  const reputationChange = pendingReputationChange === null
    ? receipt.reputationChange
    : pendingReputationChange;
  return html`
    <div class="finances-receipt">
      ${row("Money at the start of the day", money(receipt.openingCredits))}
      <h3 class="type-h3 finances-section-title">Earned</h3>
      ${receipt.earned.length ? lines(receipt.earned) : html`<div class="finances-empty">${final ? "Nothing sold." : "Nothing sold yet."}</div>`}
      <h3 class="type-h3 finances-section-title">Spent</h3>
      ${receipt.spent.length ? lines(receipt.spent) : html`<div class="finances-empty">${final ? "Nothing spent." : "Nothing spent yet."}</div>`}
      <div class="finances-totals">
        ${row("Total earned", signed(receipt.totalEarned), receipt.totalEarned > 0 ? "earned" : "")}
        ${row("Total spent", signed(-receipt.totalSpent), receipt.totalSpent > 0 ? "spent" : "")}
        ${row(final ? "Money at the end of the day" : "Money", money(receipt.closingCredits), "finances-balance")}
        ${row(pendingReputationChange === null ? "Store reputation change" : "Reputation change at shift end",
    reputationChange === 0 ? "No change" : `${reputationChange > 0 ? "+" : ""}${reputationChange}`)}
        ${shift ? row("Customers served", shift.customersServed) : ""}
        ${shift ? row("Customers turned away (store was full)", shift.customersTurnedAway, shift.customersTurnedAway > 0 ? "spent" : "") : ""}
        ${shift ? row("Customers pleased by a bargain", shift.priceReactions?.bargain ?? 0) : ""}
        ${shift ? row("Customers who skipped items because of price", shift.priceReactions?.skipped ?? 0) : ""}
        ${shift ? row("Customers who left because prices were outrageous", shift.priceReactions?.disgusted ?? 0) : ""}
      </div>
    </div>
  `;
}

export const FinancesRenderer = {
  /**
   * @param {{ day: number, shiftRunning: boolean, awaitingEndDay: boolean, canEndDay: boolean,
   *   pendingReputationChange: number | null, today: object, receipts: object[],
   *   lifetime: { daysCompleted: number, totalSales: number, customersServed: number } }} view
   * @param {number | null} [selectedDay] - a finished day to show, or null for today
   * @returns {string}
   */
  generateHTML(view, selectedDay = null) {
    const selected = view.receipts.find((receipt) => receipt.day === selectedDay) ?? null;

    let status;
    let action = null;
    if (view.shiftRunning) {
      status = "The shift is running. Money updates now; reputation changes are applied at the end of the shift.";
    } else if (view.awaitingEndDay) {
      status = `The shift is over. Restock and change prices now if you like, then end the day. Ending the day moves to Day ${view.day + 1} and changes market prices.`;
      action = html`<button type="button" class="action-btn finances-end-day-btn" data-end-day
        ${view.canEndDay ? "" : html`disabled title="Finish placing the fixture first."`}>END DAY ${view.day}</button>`;
    } else {
      status = `Day ${view.day} is ready. Anything you buy before the shift counts toward today's receipt.`;
      action = html`<button type="button" class="action-btn finances-start-shift-btn" data-finances-start-shift>START SHIFT</button>`;
    }

    const dayButton = (label, net, dayValue, active) => html`
      <button type="button" class="retro-tab-btn finances-day-btn${active ? " active" : ""}"
        data-finances-day="${dayValue}" aria-pressed="${String(active)}">
        <span>${label}</span>
        <span class="finances-day-net">${net}</span>
      </button>
    `;
    const dayButtons = [
      dayButton(`Today — Day ${view.today.day}`, "", "today", !selected),
      ...[...view.receipts].reverse().map((receipt) => dayButton(
        `Day ${receipt.day}`,
        signed(sumMoney([receipt.totalEarned, -receipt.totalSpent])),
        receipt.day,
        receipt === selected,
      )),
    ];

    const summary = html`
      <div class="item-card finances-summary-card">
        <h3 class="type-h3">All-Time</h3>
        ${row("Days finished", view.lifetime.daysCompleted)}
        ${row("Sales", money(view.lifetime.totalSales))}
        ${row("Customers served", view.lifetime.customersServed)}
      </div>`;

    const rightPanel = selected
      ? html`<div class="retro-slot custom-scrollbar finances-receipt-scroll">
          ${renderReceipt(selected, { final: true })}
        </div>`
      : html`<p class="type-description">${status}</p>
        ${action}
        ${renderEmergencyLoan(view.emergencyLoan)}
        <div class="retro-slot custom-scrollbar finances-receipt-scroll">
          ${renderReceipt(view.today, { final: false, pendingReputationChange: view.pendingReputationChange })}
        </div>`;

    return String(html`
      <div class="finances-panel">
        <div class="fixtures-panel-heading">
          <h2 class="type-h2">Days</h2>
        </div>
        <div class="fixtures-panel-heading">
          <h2 class="type-h2">${selected ? `Day ${selected.day}` : `Today — Day ${view.today.day}`}</h2>
        </div>
        <hr class="divider-thick fixtures-panel-divider">
        <section class="fixtures-section">
          ${summary}
          <nav class="retro-slot custom-scrollbar finances-day-list" aria-label="Daily receipts">${dayButtons}</nav>
        </section>
        <section class="fixtures-section">
          ${rightPanel}
        </section>
      </div>
    `);
  },
};
