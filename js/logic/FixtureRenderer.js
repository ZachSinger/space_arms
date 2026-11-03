// ==========================================
// FILE: FixtureRenderer.js
// ==========================================
export class FixtureRenderer {
  /**
   * Renders a fixture (sales shelf or Storage Fixture -- both share the exact same slot/
   * capacity model, see ShopInventory.js) as a grid of clickable blocks matching its real
   * gridDimensions. An empty block is a dashed "+" placeholder (bible: "determine what can
   * go on the shelf"); an assigned block shows the item's image and a "current/capacity"
   * badge -- assigned-but-still-empty (0/N) blocks are also clickable, to undo a wrong pick
   * before anything's actually been hauled there.
   * @param {Fixture} fixture
   * @param {DatabaseManager} databaseManager
   */
  static generateGridHTML(fixture, databaseManager) {
    const { w, h } = fixture.gridDimensions;

    const cellsHTML = fixture.slots
      .map((slot, index) => {
        const gridArea = `${slot.y + 1} / ${slot.x + 1} / ${slot.y + 2} / ${slot.x + 2}`;

        if (!slot.itemId) {
          return `
            <div class="fixture-slot fixture-slot-empty" data-slot-index="${index}" style="grid-area: ${gridArea};">
              <span class="fixture-slot-plus">+</span>
            </div>
          `;
        }

        const item = databaseManager.getItem(slot.itemId);
        const capacity = fixture.getSlotCapacity(slot);
        const imageHTML = item.image
          ? `<img class="fixture-slot-image" src="${item.image}" alt="" />`
          : `<div class="fixture-slot-image"></div>`;
        const emptyClass = slot.quantity === 0 ? " fixture-slot-unstocked" : "";

        return `
          <div class="fixture-slot fixture-slot-assigned${emptyClass}" data-slot-index="${index}" title="${item.name}">
            ${imageHTML}
            <span class="fixture-slot-badge">${slot.quantity}/${capacity}</span>
          </div>
        `;
      })
      .join("");

    return `
      <div class="fixture-grid" style="grid-template-columns: repeat(${w}, 1fr); grid-template-rows: repeat(${h}, 1fr);">
        ${cellsHTML}
      </div>
      <div class="fixture-grid-hint">Click an empty block to assign an item to it.</div>
    `;
  }

  /**
   * The item picker shown after clicking an empty block -- every item in the catalog
   * (bible Step 29: Unified Market), not yet filtered by signed supplier contracts (see
   * TODO.md).
   * @param {DatabaseManager} databaseManager
   */
  static generatePickerHTML(databaseManager) {
    const items = databaseManager.getAllItems();

    const rowsHTML = items
      .map((item) => {
        const iconHTML = item.image
          ? `<img class="item-icon" src="${item.image}" alt="" />`
          : `<div class="item-icon"></div>`;
        return `
          <div class="item-card fixture-picker-row" data-item-id="${item.id}">
            ${iconHTML}
            <div class="item-details">
              <div class="item-card-header">
                <span class="item-card-title">${item.name}</span>
                <span class="item-card-cost">${item.baseCost}c</span>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    return `
      <button class="action-btn fixture-picker-back" data-picker-back>&lt; BACK</button>
      <div class="retro-slot custom-scrollbar fixture-picker-list" style="padding: 10px; display: flex; flex-direction: column; gap: 6px; flex: 1; min-height: 0; overflow-y: auto;">
        ${rowsHTML}
      </div>
    `;
  }
}
