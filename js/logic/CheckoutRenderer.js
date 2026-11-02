// ==========================================
// FILE: CheckoutRenderer.js
// ==========================================
export class CheckoutRenderer {
  /**
   * Generates the HTML layout for the register's checkout window: a scatter
   * zone of unpositioned item cards (CheckoutWindow places them randomly
   * after insertion, once real container dimensions are known), a bag/total
   * readout, and a numpad payment section that stays hidden until every item
   * is scanned.
   * @param {Array<{itemId: string, price: number}>} cart - Snapshot of items the customer grabbed
   * @param {DatabaseManager} databaseManager
   */
  static generateHTML(cart, databaseManager) {
    const itemsHTML = cart
      .map((entry, index) => {
        const item = databaseManager.getItem(entry.itemId);
        const iconHTML = item.image
          ? `<img class="item-icon" src="${item.image}" alt="" />`
          : `<div class="item-icon"></div>`;
        return `
          <div class="item-card checkout-item-card" data-index="${index}" data-scanned="false">
            ${iconHTML}
            <div class="checkout-item-text">
              <span class="item-card-title">${item.name}</span>
              <span class="item-card-cost">${entry.price}c</span>
            </div>
          </div>
        `;
      })
      .join("");

    const digitButtons = [7, 8, 9, 4, 5, 6, 1, 2, 3]
      .map((digit) => `<button class="numpad-btn" data-digit="${digit}">${digit}</button>`)
      .join("");

    return `
      <div class="checkout-scatter-zone" id="checkout-scatter-zone">
        ${itemsHTML}
        <div class="checkout-bag" id="checkout-bag"></div>
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
