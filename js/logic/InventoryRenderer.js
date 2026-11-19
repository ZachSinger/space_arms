// ==========================================
// FILE: InventoryRenderer.js
// ==========================================
// Escaped HTML for the Manager Tablet's Inventory tab.
// See also: InventoryTab.js (controls and list navigation).
import { html, raw } from "../core/html.js";
import { formatMoneyAmount, roundMoney } from "./Money.js";

export class InventoryRenderer {
  /**
   * @param {number} storePrice
   * @param {number} unitCost
   * @returns {string}
   */
  static generateProfitHTML(storePrice, unitCost) {
    const profit = roundMoney(storePrice - unitCost);
    const profitClass = profit > 0 ? "positive" : profit < 0 ? "negative" : "neutral";
    return String(html`<span class="inventory-profit ${profitClass}" data-inventory-profit title="Profit per item: your price minus the cost of one item in a supply crate. Delivery fees are not included.">${formatMoneyAmount(profit)}</span>`);
  }

  /**
   * Render just the Inventory tab's content; the hosting window owns the tab chrome.
   * @param {{ item: object, stock: number, offShelves: number, unitCost: number, storePrice: number }[]} entries - stock is on shelves, offShelves is in crates; prices in credits
   * @returns {string}
   */
  static generateHTML(entries) {
    const rows = entries.map(({ item, stock, offShelves = 0, unitCost, storePrice }, index) => {
      const icon = item.image
        ? html`<img class="item-icon" src="${item.image}" alt="" />`
        : html`<div class="item-icon"></div>`;
      return html`
        <div class="item-card inventory-item-card" data-index="${index}" data-item-id="${item.id}">
          <div class="inventory-name">${icon}<span class="item-card-title">${item.name}</span></div>
          <span class="inventory-quantity" data-inventory-stock title="${item.name} on your shop's shelves">${stock}</span>
          <span class="inventory-quantity" data-inventory-crates title="${item.name} still packed in crates (floor, backroom, loading pad, or being carried)">${offShelves}</span>
          <div class="inventory-price-controls">
            <input class="inventory-price-input" type="number" min="1" step="0.01" value="${storePrice}"
              data-price-item-id="${item.id}" aria-label="Store price for ${item.name}" />
            <div class="inventory-price-buttons">
              <button type="button" data-price-action="decrease" data-price-item-id="${item.id}"
                aria-label="Decrease price by 10% for ${item.name}, at least 1 when possible"
                title="Decrease by 10%, or by at least 1. The price never drops below 1.">-10%</button>
              <button type="button" data-price-action="increase" data-price-item-id="${item.id}"
                aria-label="Increase price by 10% for ${item.name}, at least 1"
                title="Increase by 10%, or by at least 1.">+10%</button>
              <button type="button" data-price-action="market" data-price-item-id="${item.id}"
                aria-label="Set price to market for ${item.name}" title="Set price to current market price">MKT</button>
            </div>
          </div>
          ${raw(this.generateProfitHTML(storePrice, unitCost))}
        </div>
      `;
    });

    const emptyMessage = rows.length > 0
      ? null
      : html`<div class="fixture-empty-hint">No inventory owned yet -- order items from Supply.</div>`;
    return String(html`
      <div class="inventory-column-header">
        <h3 class="type-h3">Name</h3>
        <h3 class="type-h3">On Shelves</h3>
        <h3 class="type-h3">In Crates</h3>
        <h3 class="type-h3">Price</h3>
        <h3 class="type-h3">Profit</h3>
      </div>
      <div class="retro-slot custom-scrollbar inventory-list" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow-y: auto;">
        ${emptyMessage}
        ${rows}
      </div>
    `);
  }
}
