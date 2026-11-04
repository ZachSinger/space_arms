// ==========================================
// FILE: SupplyRenderer.js
// ==========================================
import { MAX_CRATES_PER_ORDER, LOADING_PAD_SPOTS, DELIVERY_FEE } from "./SupplyOrder.js";

export class SupplyRenderer {
  /**
   * Generates the Supply tab's own content (the tab bar/chrome around it is owned by
   * whatever window hosts this -- see ManagerTablet.js). The player builds one order out
   * of crates for any item they hold a signed Supplier License for (bible Step 29/48 --
   * see GameScene.getRestockableItems), then places it. Placing it spawns physical crates
   * at the Loading Pad that have to be hauled in by hand (see GameScene.handleInteract).
   * @param {GameScene} scene
   * @param {Map<string, number>} order item id -> crates in the order being built
   */
  static generateHTML(scene, order = new Map()) {
    const entries = scene.getRestockableItems();
    const summary = scene.getSupplyOrderSummary(order);
    const freePadSpots = scene.getLoadingPadSpawnPositions().length;
    const orderFull = summary.crates >= summary.maxCrates;

    let html = `
      <div class="retro-slot custom-scrollbar supply-list" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow-y: auto;">
    `;

    if (entries.length === 0) {
      html += `<div style="color: var(--color-text-muted); text-align: center; padding: 20px;">No Supplier Licenses signed yet -- sign one in the Contracts tab first.</div>`;
    } else {
      entries.forEach(({ item, quantity, cost }) => {
        const count = order.get(item.id) || 0;
        const iconHTML = item.image
          ? `<img class="item-icon" src="${item.image}" alt="" />`
          : `<div class="item-icon"></div>`;

        html += `
          <div class="item-card${count > 0 ? " supply-card-ordered" : ""}">
            ${iconHTML}
            <div class="item-details">
              <div class="item-card-header">
                <span class="item-card-title">${item.name}</span>
                <span class="item-card-cost">In stock: ${quantity}</span>
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
