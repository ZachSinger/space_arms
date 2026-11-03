// ==========================================
// FILE: FixtureRenderer.js
// ==========================================
export class FixtureRenderer {
  /**
   * Renders a fixture (sales shelf or Storage Fixture -- both share the exact same
   * capacity-pool model, see ShopInventory.js) as a capacity bar plus a list of whatever's
   * currently stocked. There's no per-block assignment -- any item can be stocked here as
   * long as there's room; this window is just a view into what's actually in there and how
   * much of the shared pool it's using.
   * @param {Fixture} fixture
   * @param {DatabaseManager} databaseManager
   */
  static generateHTML(fixture, databaseManager) {
    const used = fixture.usedCapacity();
    const percent = fixture.capacity > 0 ? Math.min(100, (used / fixture.capacity) * 100) : 0;

    const rowsHTML = fixture.stock
      .map((entry) => {
        const item = databaseManager.getItem(entry.itemId);
        const iconHTML = item.image
          ? `<img class="item-icon" src="${item.image}" alt="" />`
          : `<div class="item-icon"></div>`;
        const slotsUsed = entry.quantity * item.slots;

        return `
          <div class="item-card fixture-stock-row">
            ${iconHTML}
            <div class="item-details">
              <div class="item-card-header">
                <span class="item-card-title">${item.name}</span>
                <span class="item-card-cost">x${entry.quantity}</span>
              </div>
              <div class="fixture-stock-meta">${slotsUsed} of ${fixture.capacity} slots (${item.slots} each)</div>
            </div>
          </div>
        `;
      })
      .join("");

    const emptyHTML =
      fixture.stock.length === 0
        ? `<div class="fixture-empty-hint">Nothing stocked here yet -- order it from the Supply tab, then haul it over.</div>`
        : "";

    return `
      <div class="fixture-capacity-bar-wrap">
        <div class="fixture-capacity-bar">
          <div class="fixture-capacity-bar-fill" style="width: ${percent}%;"></div>
        </div>
        <div class="fixture-capacity-label">${used} / ${fixture.capacity} slots used</div>
      </div>
      <div class="retro-slot custom-scrollbar" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow-y: auto;">
        ${rowsHTML}${emptyHTML}
      </div>
    `;
  }
}
