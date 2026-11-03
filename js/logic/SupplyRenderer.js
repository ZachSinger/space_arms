// ==========================================
// FILE: SupplyRenderer.js
// ==========================================
export class SupplyRenderer {
  /**
   * Generates the Supply tab's own content (the tab bar/chrome around it is owned by
   * whatever window hosts this -- see ManagerTablet.js). Lets the player order more stock
   * for any item they currently have a signed Supplier License for (bible Step 29/48 --
   * see GameScene.getRestockableItems); ordering spawns a physical crate at the Loading
   * Pad that has to be hauled in by hand (see GameScene.handleInteract), not an instant
   * restock.
   * @param {GameScene} scene
   */
  static generateHTML(scene) {
    const entries = scene.getRestockableItems();

    let html = `
      <div class="retro-slot custom-scrollbar" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow-y: auto;">
    `;

    if (entries.length === 0) {
      html += `<div style="color: var(--color-text-muted); text-align: center; padding: 20px;">No Supplier Licenses signed yet -- sign one in the Contracts tab first.</div>`;
    } else {
      entries.forEach(({ item, quantity, cost }) => {
        const canAfford = scene.playerState.credits >= cost;
        const iconHTML = item.image
          ? `<img class="item-icon" src="${item.image}" alt="" />`
          : `<div class="item-icon"></div>`;

        const actionButtonHTML = canAfford
          ? `<button class="action-btn" data-order-item-id="${item.id}" style="width: 100%; font-size: var(--font-size-12);">ORDER +5 (${cost}c)</button>`
          : `<button class="action-btn danger" disabled style="opacity: 0.7; cursor: not-allowed; width: 100%; font-size: var(--font-size-11);">INSUFFICIENT FUNDS</button>`;

        html += `
          <div class="item-card">
            ${iconHTML}
            <div class="item-details">
              <div class="item-card-header">
                <span class="item-card-title">${item.name}</span>
                <span class="item-card-cost">In stock: ${quantity}</span>
              </div>
              <div style="margin-top: 8px;">
                ${actionButtonHTML}
              </div>
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;
    return html;
  }
}
