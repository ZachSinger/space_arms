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
  // ShelfFixture's placements, see shelfPlacementRowsHTML). `transferAttr` is which data
  // attribute the transfer button gets, and `otherPool` is whichever pool the button
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
    const canTransfer = otherPool.getRemainingUnitsFor(item.id) > 0;

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
        <button
          class="action-btn fixture-transfer-btn"
          ${transferAttr}="${item.id}"
          ${canTransfer ? "" : "disabled"}
          title="${canTransfer ? "Move 1 unit" : "No room on the other side"}"
        >${transferAttr === "data-take-item-id" ? "TAKE" : "STOCK"}</button>
      </div>
    `;
  }

  // --- Sales Shelf (manual grid placement, see ShelfFixture.js) ---

  /**
   * Renders a sales shelf: either its normal grid view (with a "+ ADD ITEM" button and a
   * list of its current placements, each with a "take 1 into the hovercart" button), or,
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

    const placementRows = pendingPlacement
      ? ""
      : this.shelfPlacementRowsHTML(shelfFixture, hovercart, databaseManager);

    const hovercartRows = this.poolStockRowsHTML(
      hovercart.stock,
      shelfFixture,
      databaseManager,
      "data-deposit-item-id",
    );

    return `
      ${topHTML}
      ${this.placementGridHTML(shelfFixture, pendingPlacement, databaseManager)}
      ${
        pendingPlacement
          ? ""
          : `<div class="retro-slot custom-scrollbar fixture-stock-list" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto;">
              ${placementRows || `<div class="fixture-empty-hint">Nothing placed on this shelf yet -- click "+ ADD ITEM" to pick a spot for one.</div>`}
            </div>`
      }
      ${pendingPlacement ? "" : this.hovercartSectionHTML(hovercart, hovercartRows)}
    `;
  }

  static placementToolbarHTML(pendingPlacement, databaseManager) {
    const item = databaseManager.getItem(pendingPlacement.itemId);
    return `
      <div class="fixture-placement-toolbar">
        <span class="fixture-placement-label">Placing: ${item.name}${pendingPlacement.rotated ? " (rotated)" : ""}</span>
        <button class="action-btn" data-rotate-placement>ROTATE</button>
        <button class="action-btn danger" data-cancel-placement>CANCEL</button>
      </div>
    `;
  }

  // The item-placement grid itself. Every rendered cell gets an explicit grid-column/
  // grid-row so occupied (multi-cell) placements and single empty cells can coexist
  // without CSS grid's implicit auto-placement getting involved at all.
  static placementGridHTML(shelfFixture, pendingPlacement, databaseManager) {
    const { w, h } = shelfFixture.displayGrid;
    const validCells = pendingPlacement
      ? new Set(
          shelfFixture
            .getValidPlacementCells(pendingPlacement.itemId, pendingPlacement.rotated)
            .map((c) => `${c.gx},${c.gy}`),
        )
      : null;

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
            cells.push(this.occupiedCellHTML(shelfFixture, placement, databaseManager));
          }
          continue;
        }

        const key = `${gx},${gy}`;
        const isValid = Boolean(validCells?.has(key));
        const classes = isValid ? "fixture-cell fixture-cell-valid" : "fixture-cell fixture-cell-empty";
        cells.push(`
          <div class="${classes}" style="grid-column: ${gx + 1} / span 1; grid-row: ${gy + 1} / span 1;"
            ${isValid ? `data-place-at="${gx},${gy}"` : ""}></div>
        `);
      }
    }

    return `
      <div class="fixture-placement-grid" style="grid-template-columns: repeat(${w}, 68px); grid-template-rows: repeat(${h}, 68px);">
        ${cells.join("")}
      </div>
    `;
  }

  static occupiedCellHTML(shelfFixture, placement, databaseManager) {
    const item = databaseManager.getItem(placement.itemId);
    const capacity = shelfFixture.getPlacementCapacity(placement);
    const imageHTML = item.image
      ? `<img class="fixture-cell-image" src="${item.image}" alt="" />`
      : `<div class="fixture-cell-image"></div>`;
    const index = shelfFixture.placements.indexOf(placement);
    const removableAttr = placement.quantity === 0 ? `data-remove-placement-index="${index}"` : "";
    const unstockedClass = placement.quantity === 0 ? " fixture-cell-unstocked" : "";

    return `
      <div class="fixture-cell fixture-cell-occupied${unstockedClass}"
        style="grid-column: ${placement.gx + 1} / span ${placement.w}; grid-row: ${placement.gy + 1} / span ${placement.h};"
        ${removableAttr}
        title="${item.name}${placement.quantity === 0 ? " (click to remove -- not stocked yet)" : ""}">
        ${imageHTML}
        <span class="fixture-cell-badge">${placement.quantity}/${capacity}</span>
      </div>
    `;
  }

  // One row per placement still holding stock -- a lighter-weight version of
  // transferRowHTML with placement-specific meta (position, per-placement capacity)
  // instead of a shared-pool slot count.
  static shelfPlacementRowsHTML(shelfFixture, hovercart, databaseManager) {
    return shelfFixture.placements
      .filter((p) => p.quantity > 0)
      .map((p) => {
        const item = databaseManager.getItem(p.itemId);
        const capacity = shelfFixture.getPlacementCapacity(p);
        const metaHTML = `${p.quantity}/${capacity} in this slot${p.rotated ? " (rotated)" : ""}`;
        return this.transferRowHTML(item, p.quantity, metaHTML, hovercart, "data-take-item-id");
      })
      .join("");
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
