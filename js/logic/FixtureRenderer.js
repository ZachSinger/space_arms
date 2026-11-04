// ==========================================
// FILE: FixtureRenderer.js
// ==========================================
// Builds the HTML for the fixture window: storage fixture stock lists, sales shelf
// placement grids, the hovercart section, and the shelf item picker.
// See also: FixtureWindow.js (owns the window and handles clicks on this markup).
export class FixtureRenderer {
  // Size of one shelf grid cell, px.
  static SHELF_GRID_CELL_PX = 48;

  // --- Storage Fixture (shared capacity pool, see InventoryPool.js) ---

  /**
   * Storage fixture stock (each row can TAKE 1 into the hovercart) above the hovercart
   * (each row can STOCK 1 back into the fixture).
   * @param {StorageFixture} storageFixture
   * @param {InventoryPool} hovercart
   * @param {DatabaseManager} databaseManager
   */
  static generateStorageHTML(storageFixture, hovercart, databaseManager) {
    const fixtureRows = this.poolStockRowsHTML(
      storageFixture.stock,
      hovercart,
      databaseManager,
      "data-take-item-id",
    );
    const hovercartRows = this.poolStockRowsHTML(
      hovercart.stock,
      storageFixture,
      databaseManager,
      "data-deposit-item-id",
    );

    return `
      ${this.capacityBarHTML(storageFixture)}
      <div class="retro-slot custom-scrollbar fixture-stock-list" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto;">
        ${fixtureRows || `<div class="fixture-empty-hint">Nothing stocked here yet -- order it from the Supply tab, then haul it over.</div>`}
      </div>
      ${this.hovercartSectionHTML(hovercart, hovercartRows, databaseManager)}
    `;
  }

  static capacityBarHTML(pool) {
    const used = pool.usedCapacity();
    const percent = pool.capacity > 0 ? Math.min(100, (used / pool.capacity) * 100) : 0;
    return `
      <div class="fixture-capacity-bar-wrap">
        <div class="fixture-capacity-bar">
          <div class="fixture-capacity-bar-fill" style="width: ${percent}%;"></div>
        </div>
        <div class="fixture-capacity-label">${used} / ${pool.capacity} slots used</div>
      </div>
    `;
  }

  static hovercartSectionHTML(hovercart, hovercartRows) {
    return `
      <div class="fixture-section-divider">YOUR HOVERCART</div>
      ${this.capacityBarHTML(hovercart)}
      <div class="retro-slot custom-scrollbar fixture-stock-list" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto;">
        ${hovercartRows || `<div class="fixture-empty-hint">Nothing in your hovercart right now.</div>`}
      </div>
    `;
  }

  /**
   * Rows for a flat {itemId, quantity} pool list (storage fixture or hovercart).
   * @param {{itemId: string, quantity: number}[]} entries
   * @param {InventoryPool} otherPool - pool the transfer button moves INTO (disables when full)
   * @param {DatabaseManager} databaseManager
   * @param {string | null} transferAttr - transfer button's data attribute; null for none
   */
  static poolStockRowsHTML(entries, otherPool, databaseManager, transferAttr) {
    return entries
      .filter((entry) => entry.quantity > 0)
      .map((entry) => {
        const item = databaseManager.getItem(entry.itemId);
        const slotsUsed = entry.quantity * item.slots;
        const metaHTML = `${slotsUsed} slots total (${item.slots} each)`;
        return this.transferRowHTML(item, entry.quantity, metaHTML, otherPool, transferAttr);
      })
      .join("");
  }

  static transferRowHTML(item, quantity, metaHTML, otherPool, transferAttr) {
    const iconHTML = item.image
      ? `<img class="item-icon" src="${item.image}" alt="" />`
      : `<div class="item-icon"></div>`;
    const canTransfer = transferAttr && otherPool.getRemainingUnitsFor(item.id) > 0;
    const buttonHTML = transferAttr
      ? `<button
          class="action-btn fixture-transfer-btn"
          ${transferAttr}="${item.id}"
          ${canTransfer ? "" : "disabled"}
          title="${canTransfer ? "Move 1 unit" : "No room on the other side"}"
        >${transferAttr === "data-take-item-id" ? "TAKE" : "STOCK"}</button>`
      : "";

    return `
      <div class="item-card fixture-stock-row">
        ${iconHTML}
        <div class="item-details">
          <div class="item-card-header">
            <span class="item-card-title">${item.name}</span>
            <span class="item-card-cost">x${quantity}</span>
          </div>
          <div class="fixture-stock-meta">${metaHTML}</div>
        </div>
        ${buttonHTML}
      </div>
    `;
  }

  // --- Sales Shelf (manual grid placement, see ShelfFixture.js) ---

  /**
   * Sales shelf grid with a "+ ADD ITEM" button, or, while placing an item, the grid
   * with a rotate/cancel toolbar instead.
   * @param {ShelfFixture} shelfFixture
   * @param {InventoryPool} hovercart
   * @param {DatabaseManager} databaseManager
   * @param {{itemId: string, rotated: boolean}|null} pendingPlacement
   */
  static generateShelfHTML(shelfFixture, hovercart, databaseManager, pendingPlacement) {
    const topHTML = pendingPlacement
      ? this.placementToolbarHTML(pendingPlacement, databaseManager)
      : `<button class="action-btn fixture-add-item-btn" data-add-item>+ ADD ITEM</button>`;

    const hovercartRows = this.poolStockRowsHTML(
      hovercart.stock,
      shelfFixture,
      databaseManager,
      null,
    );

    return `
      ${topHTML}
      ${this.placementGridHTML(shelfFixture, pendingPlacement, databaseManager)}
      ${pendingPlacement ? "" : this.hovercartSectionHTML(hovercart, hovercartRows)}
    `;
  }

  static placementToolbarHTML(pendingPlacement, databaseManager) {
    const item = databaseManager.getItem(pendingPlacement.itemId);
    return `
      <div class="fixture-placement-toolbar">
        <span class="fixture-placement-label">${pendingPlacement.moving ? "Moving" : "Placing"}: ${item.name}${pendingPlacement.rotated ? " (rotated)" : ""}</span>
        <button class="action-btn" data-rotate-placement>ROTATE</button>
        <button class="action-btn danger" data-cancel-placement>CANCEL</button>
      </div>
    `;
  }

  /**
   * Every cell gets an explicit grid-column/grid-row so multi-cell placements and single
   * empty cells never rely on CSS auto-placement. While placing, empty cells are only
   * hover targets; FixtureWindow draws the real item-footprint preview at the cursor.
   * @param {ShelfFixture} shelfFixture
   * @param {{itemId: string, rotated: boolean}|null} pendingPlacement
   * @param {DatabaseManager} databaseManager
   */
  static placementGridHTML(shelfFixture, pendingPlacement, databaseManager) {
    const { w, h } = shelfFixture.displayGrid;

    const cells = [];
    for (let gy = 0; gy < h; gy += 1) {
      for (let gx = 0; gx < w; gx += 1) {
        const placement = shelfFixture.placements.find(
          (p) => gx >= p.gx && gx < p.gx + p.w && gy >= p.gy && gy < p.gy + p.h,
        );

        if (placement) {
          // Render only on the anchor (top-left) cell; its span covers the rest.
          if (gx === placement.gx && gy === placement.gy) {
            cells.push(this.occupiedCellHTML(shelfFixture, placement, databaseManager, pendingPlacement));
          }
          continue;
        }

        const hoverAttr = pendingPlacement ? `data-grid-cell="${gx},${gy}"` : "";
        cells.push(`
          <div class="fixture-cell fixture-cell-empty" style="grid-column: ${gx + 1} / span 1; grid-row: ${gy + 1} / span 1;"
            ${hoverAttr}></div>
        `);
      }
    }

    return `
      <div class="fixture-placement-grid" style="grid-template-columns: repeat(${w}, ${this.SHELF_GRID_CELL_PX}px); grid-template-rows: repeat(${h}, ${this.SHELF_GRID_CELL_PX}px);">
        ${cells.join("")}
      </div>
    `;
  }

  /**
   * Outside placement mode every placement is interactive: left-click stocks 1 from the
   * hovercart, drag moves the stack, right-click pulls 1 into the hovercart (FixtureWindow).
   * @param {ShelfFixture} shelfFixture
   * @param {object} placement
   * @param {DatabaseManager} databaseManager
   * @param {object|null} pendingPlacement
   */
  static occupiedCellHTML(shelfFixture, placement, databaseManager, pendingPlacement) {
    const item = databaseManager.getItem(placement.itemId);
    const capacity = shelfFixture.getPlacementCapacity(placement);
    const imageHTML = item.image
      ? `<img class="fixture-cell-image" src="${item.image}" alt="" />`
      : `<div class="fixture-cell-image"></div>`;
    const index = shelfFixture.placements.indexOf(placement);
    const interactiveAttr = pendingPlacement ? "" : `data-placement-index="${index}"`;
    const interactiveClass = pendingPlacement ? "" : " fixture-cell-interactive";
    const emptyClass = placement.quantity <= 0 ? " fixture-cell-sold-out" : "";

    return `
      <div class="fixture-cell fixture-cell-occupied${interactiveClass}${emptyClass}"
        style="grid-column: ${placement.gx + 1} / span ${placement.w}; grid-row: ${placement.gy + 1} / span ${placement.h};"
        ${interactiveAttr}>
        ${imageHTML}
        <span class="fixture-cell-badge">${placement.quantity}/${capacity}</span>
      </div>
    `;
  }

  /**
   * Item picker shown after "+ ADD ITEM". Offers only items in the hovercart: you can't
   * place stock you aren't carrying.
   * @param {DatabaseManager} databaseManager
   * @param {InventoryPool} hovercart
   * @param {ShelfFixture} shelfFixture
   */
  static itemPickerHTML(databaseManager, hovercart, shelfFixture) {
    const availableEntries = hovercart.stock.filter((entry) => entry.quantity > 0);

    const rowsHTML = availableEntries
      .map((entry) => {
        const item = databaseManager.getItem(entry.itemId);
        const perSlot = shelfFixture.getPlacementCapacity({ itemId: item.id });
        const fitHTML = perSlot > 0
          ? `Fits ${perSlot} per slot`
          : `<span class="fixture-too-bulky">Too bulky for this shelf</span>`;
        const iconHTML = item.image
          ? `<img class="item-icon" src="${item.image}" alt="" />`
          : `<div class="item-icon"></div>`;
        return `
          <div class="item-card fixture-picker-row" data-pick-item-id="${item.id}">
            ${iconHTML}
            <div class="item-details">
              <div class="item-card-header">
                <span class="item-card-title">${item.name}</span>
                <span class="item-card-cost">x${entry.quantity} in cart</span>
              </div>
              <div class="fixture-stock-meta">Dim: ${item.dimensions.w}x${item.dimensions.h} | ${fitHTML}</div>
            </div>
          </div>
        `;
      })
      .join("");

    const emptyHTML =
      availableEntries.length === 0
        ? `<div class="fixture-empty-hint">Nothing in your hovercart to place -- take something from a fixture first.</div>`
        : "";

    return `
      <button class="action-btn fixture-picker-back" data-picker-back>&lt; BACK</button>
      <div class="retro-slot custom-scrollbar fixture-picker-list" style="padding: 10px; display: flex; flex-direction: column; gap: 6px; flex: 1; min-height: 0; overflow-y: auto;">
        ${rowsHTML}${emptyHTML}
      </div>
    `;
  }
}
