// ==========================================
// FILE: FixtureRenderer.js
// ==========================================
export class FixtureRenderer {
  // --- Storage Fixture (shared capacity pool, see InventoryPool.js) ---

  /**
   * Renders a Storage Fixture's own stock (capacity bar + stock list, each row with a
   * "take 1 into the hovercart" button) plus the player's hovercart (its own capacity bar
   * + stock list, each row with a "deposit 1 back into this fixture" button).
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

  // Shared by a Storage Fixture's own list and the hovercart's list -- both are flat
  // {itemId, quantity} entries backed by InventoryPool's shared-pool model (unlike a
  // ShelfFixture's placements). `transferAttr` is which data attribute the transfer
  // button gets (null = no button at all, e.g. the shelf's hovercart list, where stocking
  // is done by clicking grid slots instead), and `otherPool` is whichever pool the button
  // would be moving the unit INTO, so it can disable itself the moment that side has no
  // room left for one more.
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
   * Renders a sales shelf: either its normal grid view (with a "+ ADD ITEM" button; the
   * placements themselves are moved/taken via mouse clicks on the grid), or,
   * while `pendingPlacement` is set, the same grid with valid placement cells highlighted
   * and a small toolbar (rotate/cancel) instead of the placement list.
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

  // The item-placement grid itself. Every rendered cell gets an explicit grid-column/
  // grid-row so occupied (multi-cell) placements and single empty cells can coexist
  // without CSS grid's implicit auto-placement getting involved at all. While placing an
  // item, empty cells are no longer pre-highlighted as one solid block of "every valid
  // anchor" (confusing -- looked like the item itself was that whole shape, e.g. a 2x1
  // item showing 6 highlighted cells on a 4x2 grid read as "taking up 1x4" or "2x3"
  // depending on rotation). Instead each empty cell just gets a hover target
  // (data-grid-cell); FixtureWindow shows a real preview -- the item's own image, at its
  // actual w x h footprint -- anchored wherever the cursor currently is, via
  // showPlacementPreview().
  static placementGridHTML(shelfFixture, pendingPlacement, databaseManager) {
    const { w, h } = shelfFixture.displayGrid;

    const cells = [];
    for (let gy = 0; gy < h; gy += 1) {
      for (let gx = 0; gx < w; gx += 1) {
        const placement = shelfFixture.placements.find(
          (p) => gx >= p.gx && gx < p.gx + p.w && gy >= p.gy && gy < p.gy + p.h,
        );

        if (placement) {
          // Only render content on the placement's own anchor (top-left) cell -- the
          // other cells it spans are covered by this one div's own grid-column/row span,
          // so nothing separate needs to render there at all.
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
      <div class="fixture-placement-grid" style="grid-template-columns: repeat(${w}, 68px); grid-template-rows: repeat(${h}, 68px);">
        ${cells.join("")}
      </div>
    `;
  }

  // Outside placement mode every placement is interactive: left-click stocks 1 from the
  // hovercart, drag lifts the whole stack to move it, right-click pulls 1 into the
  // hovercart (see FixtureWindow).
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
    const rightClickHint = placement.quantity <= 0 ? "remove empty slot" : "take 1";

    return `
      <div class="fixture-cell fixture-cell-occupied${interactiveClass}${emptyClass}"
        style="grid-column: ${placement.gx + 1} / span ${placement.w}; grid-row: ${placement.gy + 1} / span ${placement.h};"
        ${interactiveAttr}
        title="${item.name}${pendingPlacement ? "" : ` (click: stock 1, drag: move stack, right-click: ${rightClickHint})`}">
        ${imageHTML}
        <span class="fixture-cell-badge">${placement.quantity}/${capacity}</span>
      </div>
    `;
  }

  // --- Shared: the item picker shown after clicking "+ ADD ITEM" -- only items actually
  // in the player's hovercart are offered, since those are the only ones there's
  // anything physical to put on the shelf. (An earlier version of this showed the whole
  // catalog, which isn't correct -- you can't place an item you aren't carrying.)
  static itemPickerHTML(databaseManager, hovercart) {
    const availableEntries = hovercart.stock.filter((entry) => entry.quantity > 0);

    const rowsHTML = availableEntries
      .map((entry) => {
        const item = databaseManager.getItem(entry.itemId);
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
              <div class="fixture-stock-meta">Dim: ${item.dimensions.w}x${item.dimensions.h}</div>
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
