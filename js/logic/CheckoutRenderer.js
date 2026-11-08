// ==========================================
// FILE: CheckoutRenderer.js
// ==========================================
// HTML for the register checkout window.
import { CASH_DENOMINATIONS } from "./CashPayment.js";
import { formatMoney } from "./Money.js";

function renderDrawer(kind) {
  return CASH_DENOMINATIONS.filter((denomination) => denomination.kind === kind)
    .map(({ cents, label }) => `
      <button type="button" class="cash-denomination cash-${kind}" data-cash-cents="${cents}"
        aria-label="Add ${label} to change; right-click to remove" title="Click to add ${label}. Right-click to remove one.">
        <span class="cash-art"><span>${label}</span></span>
        <span class="cash-count" data-cash-count="${cents}">0 in change</span>
      </button>`).join("");
}

export class CheckoutRenderer {
  /**
   * Register scan window: a conveyor belt carrying the cart toward a red scanner bar,
   * a running total, and a numpad that stays hidden until every item is scanned.
   * CheckoutWindow positions and animates the cards after insertion.
   * @param {Array<{itemId: string, price: number}>} cart - snapshot of items the customer grabbed
   * @param {DatabaseManager} databaseManager
   */
  static generateHTML(cart, databaseManager, cashPayment = null) {
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
        <span class="checkout-total">TOTAL: <span id="checkout-total-value">0 credits</span></span>
      </div>
      <div class="checkout-payment hidden" id="checkout-payment">
        <div class="checkout-payment-prompt">ENTER EXACT AMOUNT DUE</div>
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
              <div><span>CUSTOMER PAYS</span><strong>${formatMoney(cashPayment.tender)}</strong></div>
              <div><span>CHANGE OWED</span><strong>${formatMoney(cashPayment.changeDueCents / 100)}</strong></div>
              <div><span>CHANGE SELECTED</span><strong id="checkout-change-selected">0 credits</strong></div>
            </div>
            <button type="button" class="action-btn cash-hand-over" id="cash-hand-over">HAND OVER CHANGE (SPACE)</button>
            <div class="cash-drawer">
              <div class="cash-row-label">BILLS - CREDITS</div>
              <div class="cash-bills">${renderDrawer("bill")}</div>
              <div class="cash-row-label">COINS - CENTS (100 CENTS = 1 CREDIT)</div>
              <div class="cash-coins">${renderDrawer("coin")}</div>
            </div>
            <div class="cash-change-pile" id="checkout-change-pile">No change selected.</div>
            <div class="cash-instructions">Click a bill or coin to add it. Right-click to remove one.</div>
          </div>` : ""}
      </div>
    `;
  }
}
