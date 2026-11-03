// ==========================================
// FILE: FixtureRenderer.js
// ==========================================
export class FixtureRenderer {
  /**
   * Renders a fixture's own stock (capacity bar + stock list, each row with a "take 1 into
   * the hovercart" button) plus the player's hovercart (its own capacity bar + stock list,
   * each row with a "deposit 1 back into this fixture" button). Both sides share the exact
   * same capacity-pool model (see InventoryPool.js) -- moving a unit is just remove() from
   * one pool and add() to the other (see FixtureWindow), capped by whichever side actually
   * has room.
   * @param {Fixture} fixture
   * @param {InventoryPool} hovercart
   * @param {DatabaseManager} databaseManager
   */
  static generateHTML(fixture, hovercart, databaseManager) {
    const fixtureRows = this.stockRowsHTML(fixture, hovercart, databaseManager, "data-take-item-id");
    const hovercartRows = this.stockRowsHTML(hovercart, fixture, databaseManager, "data-deposit-item-id");

    return `
      ${this.capacityBarHTML(fixture)}
      <div class="retro-slot custom-scrollbar fixture-stock-list" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto;">
        ${fixtureRows || `<div class="fixture-empty-hint">Nothing stocked here yet -- order it from the Supply tab, then haul it over.</div>`}
      </div>
      <div class="fixture-section-divider">YOUR HOVERCART</div>
      ${this.capacityBarHTML(hovercart)}
      <div class="retro-slot custom-scrollbar fixture-stock-list" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto;">
        ${hovercartRows || `<div class="fixture-empty-hint">Nothing in your hovercart right now.</div>`}
      </div>
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

  // Shared by both the fixture's own list and the hovercart's list -- `transferAttr` is
  // which data attribute the transfer button gets (data-take-item-id to move into the
  // hovercart, data-deposit-item-id to move back out of it), and `otherPool` is whichever
  // pool the button would be moving the unit INTO, so the button can disable itself the
  // moment that side has no room left for one more.
  static stockRowsHTML(pool, otherPool, databaseManager, transferAttr) {
    return pool.stock
      .filter((entry) => entry.quantity > 0)
      .map((entry) => {
        const item = databaseManager.getItem(entry.itemId);
        const iconHTML = item.image
          ? `<img class="item-icon" src="${item.image}" alt="" />`
          : `<div class="item-icon"></div>`;
        const slotsUsed = entry.quantity * item.slots;
        const canTransfer = otherPool.getRemainingUnitsFor(entry.itemId) > 0;

        return `
          <div class="item-card fixture-stock-row">
            ${iconHTML}
            <div class="item-details">
              <div class="item-card-header">
                <span class="item-card-title">${item.name}</span>
                <span class="item-card-cost">x${entry.quantity}</span>
              </div>
              <div class="fixture-stock-meta">${slotsUsed} slots total (${item.slots} each)</div>
            </div>
            <button
              class="action-btn fixture-transfer-btn"
              ${transferAttr}="${item.id}"
              ${canTransfer ? "" : "disabled"}
              title="${canTransfer ? "Move 1 unit" : "No room on the other side"}"
            >${transferAttr === "data-take-item-id" ? "TAKE" : "STOCK"}</button>
          </div>
        `;
      })
      .join("");
  }
}
