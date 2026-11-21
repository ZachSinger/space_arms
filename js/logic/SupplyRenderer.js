// ==========================================
// FILE: SupplyRenderer.js
// ==========================================
// HTML for the Supply tab: the player builds one order of crates for licensed items, then
// places it, spawning physical crates on the Loading Pad to haul in by hand.
// See also: SupplyOrder.js (order rules), InteractionSystem.handleInteract (crate hauling).
import { html } from "../core/html.js";
import { DELIVERY_FEE, getCrateOrderQuantity } from "./SupplyOrder.js";

/**
 * How an item is doing on the shop's shelves, for the Supply tab's badge.
 * @param {{ quantity: number, capacity: number } | null} shelf - null if no shelf spot holds it
 * @returns {{ level: "out" | "low" | "ok", rank: number, label: string } | null}
 */
export function getShelfStatus(shelf) {
  if (!shelf) return null;
  if (shelf.quantity <= 0) return { level: "out", rank: 0, label: "Sold out on shelves" };
  if (shelf.quantity * 2 < shelf.capacity) {
    return { level: "low", rank: 1, label: `Running low: ${shelf.quantity} left` };
  }
  return { level: "ok", rank: 2, label: `On shelves: ${shelf.quantity}` };
}

// Shelved items first, most urgent at the top; the rest keep their catalog order.
export function sortSupplyEntries(entries) {
  return entries
    .map((entry, index) => ({ entry, index, rank: getShelfStatus(entry.shelf)?.rank ?? 3 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ entry }) => entry);
}

export class SupplyRenderer {
  /**
   * Build the tab's content only; the hosting window (ManagerTablet.js) owns the tab chrome.
   * @param {GameScene} scene
   * @param {Map<string, number>} order - item id -> crates in the order being built
   * @returns {string} HTML
   */
  static generateHTML(scene, order = new Map()) {
    const entries = sortSupplyEntries(scene.supply.restockableItems());
    const summary = scene.supply.orderSummary(order);
    const orderFull = summary.crates >= summary.maxCrates;
    const itemRows = entries.map(({ item, ownedQuantity = 0, shelf, cost }) => {
      const count = order.get(item.id) || 0;
      const status = getShelfStatus(shelf);
      const icon = item.image
        ? html`<img class="item-icon supply-item-icon" src="${item.image}" alt="" />`
        : html`<div class="item-icon supply-item-icon"></div>`;
      const shelfBadge = status
        ? html`<span class="supply-shelf-badge supply-shelf-${status.level}">${status.label}</span>`
        : null;

      return html`
        <div class="item-card supply-item-row${count > 0 ? " supply-card-ordered" : ""}${status ? ` supply-card-shelf-${status.level}` : ""}" data-pad-row="${item.id}">
          <div class="supply-item-name">
            ${icon}
            <div class="supply-item-copy">
              <span class="item-card-title">${item.name}</span>
              ${shelfBadge}
            </div>
          </div>
          <span class="supply-item-stock" title="Total items you own across shelves and crates">Own: ${ownedQuantity}</span>
          <div class="supply-item-crate">
            <strong>${cost.toLocaleString()}</strong>
            <span>${getCrateOrderQuantity(item)} items</span>
          </div>
          <div class="supply-crate-stepper">
            <button type="button" class="action-btn" data-supply-remove="${item.id}" data-pad-x aria-label="Remove one ${item.name} crate"${count > 0 ? "" : " disabled"}>-</button>
            <span class="supply-crate-count" aria-label="${item.name} crates in order">${count}</span>
            <button type="button" class="action-btn" data-supply-add="${item.id}" data-pad-a aria-label="Add one ${item.name} crate"${orderFull ? " disabled" : ""}>+</button>
          </div>
        </div>
      `;
    });
    const emptyMessage = entries.length === 0
      ? html`<p class="type-description supply-empty">No items are available yet. Sign a supplier contract first.</p>`
      : null;
    const problem = summary.problem
      ? html`<div class="supply-order-problem" role="status">${summary.problem}</div>`
      : null;

    return String(html`
      <div class="supply-panel">
        <div class="supply-panel-heading">
          <h2 class="type-h2">Available Items</h2>
        </div>
        <div class="supply-panel-heading">
          <h2 class="type-h2">Your Order</h2>
        </div>
        <hr class="divider-thick supply-divider">
        <section class="supply-catalog">
          <div class="pad-only supply-controller-hint">Press A to add a crate. Press X to remove one.</div>
          <div class="supply-column-header">
            <span></span>
            <span></span>
            <span></span>
            <h3 class="type-h3">Order</h3>
          </div>
          <div class="retro-slot custom-scrollbar supply-list">
            ${emptyMessage}
            ${itemRows}
          </div>
        </section>
        <div class="supply-order-summary">
          <div class="supply-order-details">
            <div class="supply-summary-row"><span>Items:</span><strong>${summary.crates}/${summary.maxCrates}</strong></div>
            <div class="supply-summary-row"><span>Subtotal:</span><strong>${summary.stockCost.toLocaleString()}</strong></div>
            <div class="supply-summary-row"><span>Fee:</span><strong>${DELIVERY_FEE}</strong></div>
            <hr class="divider-thin">
            <div class="supply-summary-row supply-summary-total"><span>Total</span><strong>${summary.total.toLocaleString()}</strong></div>
            ${problem}
          </div>
          <div class="supply-order-actions">
            <button class="action-btn" data-supply-clear${summary.crates > 0 ? "" : " disabled"}>CLEAR</button>
            <button class="action-btn" data-supply-place${summary.canPlace ? "" : " disabled"}>PLACE ORDER</button>
          </div>
        </div>
      </div>
    `);
  }
}
