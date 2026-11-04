// ==========================================
// FILE: CheckoutRenderer.js
// ==========================================
export class CheckoutRenderer {
  /**
   * Register scan window: a conveyor belt carrying the cart toward a red scanner bar,
   * a running total, and a numpad that stays hidden until every item is scanned.
   * CheckoutWindow positions and animates the cards after insertion.
   * @param {Array<{itemId: string, price: number}>} cart - Snapshot of items the customer grabbed
   * @param {DatabaseManager} databaseManager
   */
  static generateHTML(cart, databaseManager) {
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
        <span class="checkout-total">TOTAL: <span id="checkout-total-value">0c</span></span>
      </div>
      <div class="checkout-payment hidden" id="checkout-payment">
        <div class="checkout-payment-prompt">ENTER EXACT AMOUNT DUE</div>
        <div class="checkout-payment-display" id="checkout-payment-display">0</div>
        <div class="checkout-numpad">
          ${digitButtons}
          <button class="numpad-btn numpad-clear" id="numpad-clear">C</button>
          <button class="numpad-btn" data-digit="0">0</button>
          <button class="action-btn numpad-confirm" id="numpad-confirm">CONFIRM</button>
        </div>
        <div class="checkout-payment-feedback" id="checkout-payment-feedback"></div>
      </div>
    `;
  }
}
