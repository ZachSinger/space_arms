// ==========================================
// FILE: CheckoutRenderer.js
// ==========================================
// HTML for the register checkout window.
import {
  creditCentsToScrips, formatCashAmount, getCashDenominations,
} from "./CashPayment.js";
import { formatMoney, toCents } from "./Money.js";

// The number printed on a bill or coin; its shape shows which it is.
export function cashFaceValue({ kind, units }, currency = "credits") {
  return String(kind === "bill"
    ? currency === "m-scrips" ? units.toLocaleString("en-US") : units / 100
    : units);
}

function renderDrawer(kind, currency) {
  return getCashDenominations(currency).filter((denomination) => denomination.kind === kind)
    .map(({ units, label }) => `
      <button type="button" class="cash-denomination cash-${kind}" data-cash-units="${units}"
        aria-label="Add ${label} to change; right-click to remove" title="Click to add ${label}. Right-click to remove one.">
        <span class="cash-art"><span>${cashFaceValue({ kind, units }, currency)}</span></span>
        <span class="cash-count" data-cash-count="${units}">0 in change</span>
      </button>`).join("");
}

function formatCheckoutTotal(total, currency) {
  const cents = toCents(total);
  return currency === "m-scrips"
    ? formatCashAmount(creditCentsToScrips(cents), currency)
    : formatCashAmount(cents, "credits");
}

function renderChit(chitPayment) {
  if (!chitPayment) return "";
  return `
    <div class="checkout-chit hidden" id="checkout-chit">
      <div class="chit-card">
        <div class="chit-screen">
          <span class="chit-title">EXPLORER TRAVEL CHIT</span>
          <span>VALUE: <strong>${formatMoney(chitPayment.total)}</strong></span>
          <span>ACCESS CODE: <strong class="chit-code">${chitPayment.code.split("").join(" ")}</strong></span>
        </div>
      </div>
      <div class="chit-input-help kbd-only">Enter the code with the arrow keys or click a key.</div>
      <div class="chit-input-help pad-only">Enter the code with the D-pad.</div>
      <div class="chit-progress" id="checkout-chit-progress">CODE: _ _ _ _</div>
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
          ? `<img class="checkout-item-image" src="${item.image}" alt="" />`
          : `<div class="checkout-item-image"></div>`;
        return `
          <div class="checkout-item-card" data-index="${index}" data-scanned="false">
            ${imageHTML}
          </div>
        `;
      })
      .join("");

    const digitButtons = [7, 8, 9, 4, 5, 6, 1, 2, 3]
      .map((digit) => `<button class="numpad-btn" data-digit="${digit}">${digit}</button>`)
      .join("");

    return `
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
        ${cashPayment ? `
          <div class="cash-checkout hidden" id="checkout-cash">
            <div class="cash-summary">
              <div><span>CURRENT CHANGE</span><strong id="checkout-change-selected">${formatCashAmount(0, currency)}</strong></div>
              <div><span>CHANGE OWED</span><strong>${formatCashAmount(cashPayment.changeDueUnits, currency)}</strong></div>
            </div>
            <button type="button" class="action-btn cash-hand-over" id="cash-hand-over">HAND OVER CHANGE<span class="kbd-only"> (SPACE)</span></button>
            <div class="cash-drawer">
              <div class="cash-bills">${renderDrawer("bill", currency)}</div>
              ${currency === "credits" ? `<div class="cash-coins">${renderDrawer("coin", currency)}</div>` : ""}
            </div>
            <div class="cash-change-pile" id="checkout-change-pile">No change selected.</div>
            <div class="cash-instructions kbd-only">Click a bill or coin to add it. Right-click to remove one.</div>
            <div class="cash-instructions pad-only">Press A on a bill or coin to add it. Press X to remove one.</div>
          </div>` : ""}
        ${renderChit(chitPayment)}
      </div>
    `;
  }
}
