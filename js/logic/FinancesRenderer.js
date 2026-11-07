// ==========================================
// FILE: FinancesRenderer.js
// ==========================================
// Finances tab HTML (bible Step 43): today's itemized receipt, the End Day button, and
// the previous day's final receipt.

const credits = (amount) => `${amount.toLocaleString()} credits`;
const signed = (amount) => (amount === 0 ? credits(0) : `${amount > 0 ? "+" : "-"}${credits(Math.abs(amount))}`);
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// What each receipt line says, so a player reading it knows exactly what the money was for.
function describeLine({ category, label, quantity }) {
  switch (category) {
    case "sales": return `Sold ${label} (${plural(quantity, "item", "items")})`;
    case "stock_orders": return `Ordered ${label} (${plural(quantity, "crate", "crates")})`;
    case "delivery_fees": return `Delivery fees (${plural(quantity, "order", "orders")})`;
    case "fixtures": return `Bought fixture: ${label}${quantity > 1 ? ` (${quantity})` : ""}`;
    case "licenses": return `Signed supplier license: ${label}`;
    case "hiring": return `Hired ${label}`;
    case "wages": return `Wages paid to ${label}${quantity > 1 ? ` (${plural(quantity, "shift", "shifts")})` : ""}`;
    default: throw new Error(`Unknown receipt category: ${category}`);
  }
}

const row = (label, value, className = "") =>
  `<div class="finances-row ${className}"><span>${label}</span><span class="finances-value">${value}</span></div>`;

function renderReceipt(receipt, { final }) {
  const lines = (entries) => entries.map((line) =>
    row(describeLine(line), signed(line.amount), line.amount >= 0 ? "earned" : "spent")).join("");
  const shift = receipt.shift;
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
        ${row(final ? "Credits at the end of the day" : "Credits right now", credits(receipt.closingCredits), "finances-balance")}
        ${row("Store reputation change", receipt.reputationChange === 0 ? "No change"
          : `${receipt.reputationChange > 0 ? "+" : ""}${receipt.reputationChange}`)}
        ${shift ? row("Customers served", shift.customersServed) : ""}
        ${shift ? row("Customers turned away (store was full)", shift.customersTurnedAway, shift.customersTurnedAway > 0 ? "spent" : "") : ""}
      </div>
    </div>
  `;
}

export const FinancesRenderer = {
  /**
   * @param {{ day: number, shiftRunning: boolean, awaitingEndDay: boolean, canEndDay: boolean,
   *   today: object, lastDay: object | null }} view - from GameScene.getFinancesView()
   * @returns {string}
   */
  generateHTML(view) {
    let status;
    let action = "";
    if (view.shiftRunning) {
      status = "The shift is running. This receipt updates as you earn and spend credits.";
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
        <div class="finances-heading">DAY ${view.today.day} RECEIPT${view.awaitingEndDay ? "" : " (SO FAR)"}</div>
        ${renderReceipt(view.today, { final: false })}
        ${view.lastDay ? `
          <div class="finances-heading">DAY ${view.lastDay.day} RECEIPT (FINAL)</div>
          ${renderReceipt(view.lastDay, { final: true })}
        ` : ""}
      </div>
    `;
  },
};
