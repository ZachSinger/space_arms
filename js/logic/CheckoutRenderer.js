// ==========================================
// FILE: CheckoutRenderer.js
// ==========================================
export class CheckoutRenderer {
  /**
   * Generates the HTML layout for the register's checkout window.
   * @param {Array<{itemId: string, price: number}>} cart - Snapshot of items the customer grabbed
   * @param {DatabaseManager} databaseManager
   */
  static generateHTML(cart, databaseManager) {
    const itemsHTML = cart
      .map((entry, index) => {
        const item = databaseManager.getItem(entry.itemId);
        return `
          <div class="item-card checkout-item-card" data-index="${index}" data-scanned="false">
            <span class="item-card-title">${item.name}</span>
            <span class="item-card-cost">${entry.price}c</span>
          </div>
        `;
      })
      .join("");

    return `
      <div class="checkout-items custom-scrollbar">
        ${itemsHTML}
      </div>
      <div class="checkout-footer">
        <span class="checkout-total">TOTAL: <span id="checkout-total-value">0c</span></span>
        <button class="action-btn" id="checkout-complete-btn" disabled>COMPLETE SALE</button>
      </div>
    `;
  }
}
