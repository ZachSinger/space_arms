// ==========================================
// FILE: InventoryRenderer.js
// ==========================================
export class InventoryRenderer {
  static generateHTML(databaseManager) {
    const items = databaseManager.getAllItems();

    let html = `
        <div style="display: flex; gap: 4px; margin-bottom: 10px;">
            <button class="retro-tab-btn">Shift</button>
            <button class="retro-tab-btn active">Inventory DB</button>
            <button class="retro-tab-btn">Finances</button>
        </div>
        <div class="retro-slot custom-scrollbar" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; overflow-y: auto;">
    `;

    items.forEach((item) => {
      // Map the tags array into HTML pills
      const tagHTML = item.tags
        .map((t) => `<span class="tag-badge">${t}</span>`)
        .join("");

      // Conditionally generate the extra data row ONLY if ammo or count exist
      let extraDataHTML = "";
      if (item.ammo || item.count) {
        const ammoSpan = item.ammo
          ? `<span>Uses: ${item.ammo}</span>`
          : `<span></span>`;
        const countSpan = item.count
          ? `<span>Qty: ${item.count}</span>`
          : `<span></span>`;

        // This ensures the optional row stays perfectly formatted and independent
        extraDataHTML = `
                <div style="display: flex; justify-content: space-between; margin-top: 4px; color: #eab308;">
                    ${ammoSpan}
                    ${countSpan}
                </div>
            `;
      }

      // Build the card layout (Footer is now strictly separated into rows)
      html += `
            <div class="item-card">
                <div class="item-card-header">
                    <span class="item-card-title">${item.name}</span>
                    <span class="item-card-cost">${item.baseCost}c</span>
                </div>
                <div class="item-card-flavor">"${item.flavor}"</div>
                <div style="display:flex; gap: 6px; flex-wrap:wrap; margin: 4px 0;">
                    ${tagHTML}
                </div>
                <div class="item-card-footer">
                    <div style="display: flex; justify-content: space-between;">
                        <span>Dim: [${item.dimensions.w}x${item.dimensions.h}]</span>
                        <span>Stack: x${item.stackSize}</span>
                    </div>
                    ${extraDataHTML}
                </div>
            </div>
        `;
    });

    html += `</div>`;
    return html;
  }
}
