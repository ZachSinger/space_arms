// ==========================================
// FILE: SupplyRenderer.js
// ==========================================
// HTML for the Supply tab: the player builds one order of crates for licensed items, then
// places it, spawning physical crates on the Loading Pad to haul in by hand.
// See also: SupplyOrder.js (order rules), GameScene.handleInteract (crate hauling).
import { MAX_CRATES_PER_ORDER, LOADING_PAD_SPOTS, DELIVERY_FEE } from "./SupplyOrder.js";

/**
 * How an item is doing on the shop's shelves, for the Supply tab's badge.
 * @param {{ quantity: number, capacity: number } | null} shelf - null if no shelf spot holds it
 * @returns {{ level: "out" | "low" | "ok", rank: number, label: string } | null}
 */
export function getShelfStatus(shelf) {
  if (!shelf) return null;
  if (shelf.quantity <= 0) return { level: "out", rank: 0, label: "SOLD OUT ON YOUR SHELVES" };
  if (shelf.quantity * 2 < shelf.capacity) {
    return { level: "low", rank: 1, label: `RUNNING LOW ON YOUR SHELVES (${shelf.quantity} left)` };
  }
  return { level: "ok", rank: 2, label: `ON YOUR SHELVES (${shelf.quantity})` };
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
    const entries = sortSupplyEntries(scene.getRestockableItems());
    const summary = scene.getSupplyOrderSummary(order);
    const freePadSpots = scene.getLoadingPadSpawnPositions().length;
    const orderFull = summary.crates >= summary.maxCrates;

    let html = `
      <div class="retro-slot custom-scrollbar supply-list" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow-y: auto;">
    `;

    if (entries.length === 0) {
      html += `<div style="color: var(--color-text-muted); text-align: center; padding: 20px;">No Supplier Licenses signed yet -- sign one in the Contracts tab first.</div>`;
    } else {
      entries.forEach(({ item, quantity, shelf, cost }) => {
        const count = order.get(item.id) || 0;
        const status = getShelfStatus(shelf);
        const iconHTML = item.image
          ? `<img class="item-icon" src="${item.image}" alt="" />`
          : `<div class="item-icon"></div>`;

        html += `
          <div class="item-card${count > 0 ? " supply-card-ordered" : ""}${status ? ` supply-card-shelf-${status.level}` : ""}">
            ${iconHTML}
            <div class="item-details">
              ${status ? `<div class="supply-shelf-badge supply-shelf-${status.level}">${status.label}</div>` : ""}
              <div class="item-card-header">
                <span class="item-card-title">${item.name}</span>
                <span class="item-card-cost">Total in shop: ${quantity}</span>
              </div>
              <div class="supply-card-row">
                <span class="supply-crate-price">${cost} credits per crate of 5</span>
                <div class="supply-crate-stepper">
                  <button class="action-btn" data-supply-remove="${item.id}" aria-label="Remove one ${item.name} crate"${count > 0 ? "" : " disabled"}>-</button>
                  <span class="supply-crate-count" aria-label="${item.name} crates in order">${count}</span>
                  <button class="action-btn" data-supply-add="${item.id}" aria-label="Add one ${item.name} crate"${orderFull ? " disabled" : ""}>+</button>
                </div>
              </div>
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;

    html += `
      <div class="supply-order-summary">
        <div class="supply-summary-row"><span>Crates in this order</span><strong>${summary.crates} / ${MAX_CRATES_PER_ORDER}</strong></div>
        <div class="supply-summary-row"><span>Free spots on the loading pad</span><strong>${freePadSpots} / ${LOADING_PAD_SPOTS}</strong></div>
        <div class="supply-summary-row"><span>Stock</span><strong>${summary.stockCost} credits</strong></div>
        <div class="supply-summary-row"><span>Delivery fee (once per order)</span><strong>${DELIVERY_FEE} credits</strong></div>
        <div class="supply-summary-row supply-summary-total"><span>Total</span><strong>${summary.total} credits</strong></div>
        ${summary.problem ? `<div class="supply-order-problem" role="status">${summary.problem}</div>` : ""}
        <div class="supply-order-actions">
          <button class="action-btn" data-supply-clear${summary.crates > 0 ? "" : " disabled"}>CLEAR</button>
          <button class="action-btn" data-supply-place${summary.canPlace ? "" : " disabled"}>PLACE ORDER</button>
        </div>
      </div>
    `;
    return html;
  }
}
