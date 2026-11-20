// ==========================================
// FILE: CheckoutRenderer.js
// ==========================================
// HTML for the register checkout window.
import {
  creditCentsToScrips, formatCashAmount, getCashDenominations,
} from "./CashPayment.js";
import { formatTransactionTotal, toCents } from "./Money.js";
import { html } from "../core/html.js";

// The number printed on a bill or coin; its shape shows which it is.
export function cashFaceValue({ kind, units }, currency = "credits") {
  return String(kind === "bill"
    ? currency === "m-scrips" ? units.toLocaleString("en-US") : units / 100
    : units);
}

function changeMarkup(units, currency) {
  if (currency === "credits") return html`${(units / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
  const [amount, currencyName] = formatCashAmount(units, currency).split(" ");
  return html`${amount} <small>${currencyName}</small>`;
}

export function renderCurrentChange(units, currency) {
  return String(changeMarkup(units, currency));
}

function renderDrawer(kind, currency) {
  return html`${getCashDenominations(currency).filter((denomination) => denomination.kind === kind)
    .map(({ units, label }) => html`
      <button type="button" class="cash-denomination cash-${kind}" data-cash-units="${units}"
        aria-label="Add ${label} to change; right-click to remove" title="Click to add ${label}. Right-click to remove one.">
        <span class="cash-art"><span>${cashFaceValue({ kind, units }, currency)}</span></span>
        <span class="cash-count" data-cash-count="${units}">0 in change</span>
      </button>`)}`;
}

function formatCheckoutTotal(total, currency) {
  if (currency === "m-scrips") return formatCashAmount(creditCentsToScrips(toCents(total)), currency);
  return formatTransactionTotal(total);
}

function renderChit(chitPayment) {
  if (!chitPayment) return null;
  return html`
    <div class="checkout-chit hidden" id="checkout-chit">
      <div class="chit-card">
        <div class="chit-screen">
          <span class="chit-title">EXPLORER TRAVEL CHIT</span>
          <span>VALUE: <strong>${formatTransactionTotal(chitPayment.total)}</strong></span>
          <span>ACCESS CODE: <strong class="chit-code">${chitPayment.code.split("").join(" ")}</strong></span>
        </div>
      </div>
      <div class="chit-input-help kbd-only">Enter the code with the arrow keys or click a key.</div>
      <div class="chit-input-help pad-only">Enter the code with the D-pad.</div>
      <div class="chit-progress" id="checkout-chit-progress">INPUT: ${Array.from(chitPayment.code, () => "_").join(" ")}</div>
      <div class="chit-timer" id="checkout-chit-timer">
        <div class="chit-timer-label"><span>TIME LEFT</span><span id="checkout-chit-time-left">10.0s</span></div>
        <div class="chit-timer-track"><div class="chit-timer-fill" id="checkout-chit-timer-fill"></div></div>
      </div>
      <div class="chit-keypad">
        <button type="button" data-chit-digit="1" aria-label="Up, key 1">↑ <span>1</span></button>
        <button type="button" data-chit-digit="2" aria-label="Down, key 2">↓ <span>2</span></button>
        <button type="button" data-chit-digit="3" aria-label="Left, key 3">← <span>3</span></button>
        <button type="button" data-chit-digit="4" aria-label="Right, key 4">→ <span>4</span></button>
      </div>
      <div class="checkout-payment-feedback" id="checkout-chit-feedback" role="status"></div>
    </div>`;
}

export class CheckoutRenderer {
  /**
   * Register scan window: a conveyor belt carrying the cart toward a red scanner bar,
   * a running total, and a numpad that stays hidden until every item is scanned.
   * CheckoutWindow positions and animates the cards after insertion.
   * @param {Array<{itemId: string, price: number}>} cart - snapshot of items the customer grabbed
   * @param {DatabaseManager} databaseManager
   */
  static generateHTML(cart, databaseManager, cashPayment = null, chitPayment = null) {
    const currency = cashPayment?.currency ?? "credits";
    const itemsHTML = cart
      .map((entry, index) => {
        const item = databaseManager.getItem(entry.itemId);
        const imageHTML = item.image
          ? html`<img class="checkout-item-image" src="${item.image}" alt="" />`
          : html`<div class="checkout-item-image"></div>`;
        return html`
          <div class="checkout-item-card" data-index="${index}" data-scanned="false">
            ${imageHTML}
          </div>
        `;
      });

    const digitButtons = [7, 8, 9, 4, 5, 6, 1, 2, 3]
      .map((digit) => html`<button class="numpad-btn" data-digit="${digit}">${digit}</button>`);

    return String(html`
      <div class="checkout-belt" id="checkout-belt">
        ${itemsHTML}
        <div class="checkout-scanner" id="checkout-scanner"></div>
      </div>
      <div class="checkout-footer">
        <span class="checkout-total">TOTAL: <span id="checkout-total-value">${formatCheckoutTotal(0, currency)}</span></span>
      </div>
      <div class="checkout-payment hidden" id="checkout-payment">
        <div class="checkout-payment-prompt">${chitPayment ? "EXPLORER CHIT" : cashPayment ? "CASH PAYMENT" : "CARD PAYMENT - ENTER TOTAL"}</div>
        <div class="checkout-payment-display" id="checkout-payment-display">0</div>
        <div class="checkout-numpad">
          ${digitButtons}
          <button class="numpad-btn" data-digit=".">.</button>
          <button class="numpad-btn" data-digit="0">0</button>
          <button class="numpad-btn numpad-clear" id="numpad-clear">CLEAR</button>
          <button class="action-btn numpad-confirm" id="numpad-confirm">CONFIRM TOTAL</button>
        </div>
        <div class="checkout-payment-feedback" id="checkout-payment-feedback" role="status"></div>
        ${cashPayment ? html`
          <div class="cash-checkout hidden" id="checkout-cash">
            <div class="cash-summary">
              <div class="cash-current-change" id="checkout-change-current"><span>CURRENT CHANGE</span><strong id="checkout-change-selected">${changeMarkup(0, currency)}</strong></div>
              <div class="cash-change-owed"><span>CHANGE OWED</span><strong>${changeMarkup(cashPayment.changeDueUnits, currency)}</strong></div>
            </div>
            <div class="cash-drawer">
              <div class="cash-bills">${renderDrawer("bill", currency)}</div>
              ${currency === "credits" ? html`<div class="cash-coins">${renderDrawer("coin", currency)}</div>` : ""}
            </div>
            <div class="cash-change-pile" id="checkout-change-pile">No change selected.</div>
            <div class="cash-instructions kbd-only">Click a bill or coin to add it. Right-click to remove one.</div>
            <div class="cash-instructions pad-only">Press A on a bill or coin to add it. Press X to remove one.</div>
          </div>` : ""}
        ${renderChit(chitPayment)}
      </div>
    `);
  }
}
