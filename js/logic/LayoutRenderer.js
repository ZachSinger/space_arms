// ==========================================
// FILE: LayoutRenderer.js
// ==========================================
// HTML for the fixture layout panel: placed fixtures with MOVE / CRATE UP buttons, plus
// (optionally) the fixture purchase list.
import { getFixtureResaleValue, getFixtureType } from "./FixtureLayout.js";

export class LayoutRenderer {
  /**
   * @param {GameScene} scene
   * @param {boolean} includePurchases - also show buying, crating, and selling (the Fixtures tab)
   * @param {string} [purchaseNotice] - confirmation of the fixture just bought
   * @param {{ name: string, value: number } | null} [saleConfirmation]
   * @returns {string} HTML
   */
  static generateHTML(scene, includePurchases = false, purchaseNotice = "", saleConfirmation = null) {
    if (includePurchases) {
      return LayoutRenderer.generateFixturesTabHTML(scene, purchaseNotice, saleConfirmation);
    }
    const enabled = scene.canExpandStore();

    const expansionCards = (options, buyAttribute) => options.map(
      ({ zone, isPurchased, isNext, levelMet, canAfford }) => {
        const canBuy = enabled && !isPurchased && isNext && levelMet && canAfford;
        const status = isPurchased
          ? "OPEN"
          : !levelMet
            ? "LOCKED"
            : !isNext
              ? "BUY PREVIOUS EXPANSION FIRST"
              : !canAfford
                ? "INSUFFICIENT FUNDS"
                : !enabled
                  ? "AVAILABLE WHILE STORE IS CLOSED"
                  : "BUY";
        return `
          <div class="item-card fixture-sale-card">
            <div class="fixture-sale-info">
              <h3 class="type-h3">${zone.name}</h3>
              <p class="type-description">Shop Level ${zone.requiredShopLevel}</p>
            </div>
            <div class="fixture-sale-action">
              <p class="type-description fixture-sale-price">${zone.cost.toLocaleString()}</p>
              <button type="button" class="${!isPurchased && !levelMet ? "retro-tab-btn" : "action-btn"}" ${buyAttribute}="${zone.id}"
                ${canBuy ? "" : "disabled"}>${status}</button>
            </div>
          </div>
        `;
      }).join("");

    return `
      <div class="fixtures-panel fixtures-panel-single">
        <div class="fixtures-panel-heading">
          <h2 class="type-h2">Expansions</h2>
        </div>
        <hr class="divider-thick fixtures-panel-divider">
        <section class="fixtures-section">
          <div class="retro-slot custom-scrollbar layout-expansions-list">
            <h3 class="type-h3 layout-zone-heading">Sales Floor</h3>
            ${expansionCards(scene.getExpansionPurchaseOptions(), "data-buy-expansion-id")}
            <h3 class="type-h3 layout-zone-heading">Backroom</h3>
            ${expansionCards(scene.getBackroomPurchaseOptions(), "data-buy-backroom-id")}
          </div>
        </section>
      </div>
    `;
  }

  /**
   * The redesigned Fixtures tab: fixtures for sale on the left; placed fixtures and
   * fixture crates, with move/crate/sell controls, on the right.
   * @param {GameScene} scene
   * @param {string} purchaseNotice
   * @param {{ name: string, value: number } | null} saleConfirmation
   * @returns {string} HTML
   */
  static generateFixturesTabHTML(scene, purchaseNotice = "", saleConfirmation = null) {
    const enabled = scene.canRearrangeFixtures();
    const { fixtures } = scene;
    const fixtureCrates = (scene.restockCrates ?? [])
      .map((crate, index) => ({ crate, key: String(index) }))
      .filter(({ crate }) => crate.kind === "fixture");
    if (scene.carriedCrate?.kind === "fixture") {
      fixtureCrates.push({ crate: scene.carriedCrate, key: "carried" });
    }

    const saleCards = scene.getFixturePurchaseOptions()
      .map(({ spec, license, licensed, canAfford, hasDeliverySpace }) => {
        const disabled = !licensed || !canAfford || !hasDeliverySpace;
        const label = !licensed
          ? "LOCKED"
          : !canAfford
            ? "INSUFFICIENT FUNDS"
            : !hasDeliverySpace
              ? "LOADING PAD FULL"
              : "BUY";
        return `
          <div class="item-card fixture-sale-card">
            <div class="fixture-sale-info">
              <h3 class="type-h3">${spec.name}</h3>
              ${licensed ? "" : `<p class="type-description fixture-locked-note">Needs contract: ${license.name} (Contracts tab)</p>`}
            </div>
            <div class="fixture-sale-action">
              <p class="type-description fixture-sale-price">${spec.price.toLocaleString()}</p>
              <button type="button" class="action-btn" data-buy-fixture-id="${spec.id}"
                ${disabled ? "disabled" : ""}>${label}</button>
            </div>
          </div>
        `;
      }).join("");

    const placedCards = fixtures.all().map((fixture) => {
      const saleBlockReason = scene.getFixtureSaleBlockReason(fixture);
      const moveBlockReason = scene.getFixtureMoveAreaBlockReason?.(fixture) ?? null;
      const canMove = enabled && !moveBlockReason;
      return `
        <div class="item-card fixture-owned-card" data-fixture-row-id="${fixture.id}">
          <div class="fixture-owned-header">
            <h3 class="type-h3">${fixtures.displayName(fixture)}</h3>
            <span class="type-description">Sells for: ${getFixtureResaleValue(fixture.type).toLocaleString()}</span>
          </div>
          ${enabled && moveBlockReason ? `<p class="type-description fixture-block-reason">${moveBlockReason}</p>` : ""}
          ${enabled && saleBlockReason ? `<p class="type-description fixture-block-reason">${saleBlockReason}</p>` : ""}
          <div class="fixture-owned-actions">
            <button type="button" class="action-btn" data-move-fixture-id="${fixture.id}"
              title="${moveBlockReason || "Move this fixture"}"
              ${canMove ? "" : "disabled"}>MOVE</button>
            <button type="button" class="action-btn danger" data-crate-fixture-id="${fixture.id}"
              title="${scene.getFixtureCrateBlockReason(fixture) || "Create a fixture crate"}"
              ${scene.canCrateFixture(fixture) ? "" : "disabled"}>CRATE UP</button>
            <button type="button" class="action-btn danger" data-sell-fixture-id="${fixture.id}"
              title="${saleBlockReason || "Sell this empty fixture"}"
              ${saleBlockReason ? "disabled" : ""}>SELL</button>
          </div>
        </div>
      `;
    }).join("");

    const crateCards = fixtureCrates.map(({ crate, key }) => {
      const name = getFixtureType(crate.typeId).name;
      const location = key === "carried" ? "Being carried" : crate.lockedToPad ? "On the Loading Pad" : "On the floor";
      const reason = scene.getFixtureCrateSaleBlockReason(crate);
      return `
        <div class="item-card fixture-owned-card fixture-crate-card">
          <div class="fixture-owned-header">
            <h3 class="type-h3">${name} crate</h3>
            <span class="type-description">Sells for: ${getFixtureResaleValue(crate.typeId).toLocaleString()}</span>
          </div>
          <p class="type-description">${location}</p>
          <div class="fixture-owned-actions">
            <button type="button" class="action-btn danger" data-sell-fixture-crate="${key}"
              title="${reason || "Sell this fixture crate"}" ${reason ? "disabled" : ""}>SELL</button>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="fixtures-panel">
        <div class="fixtures-panel-heading">
          <h2 class="type-h2">Fixtures for Sale</h2>
        </div>
        <div class="fixtures-panel-heading">
          <h2 class="type-h2">Your Fixtures</h2>
        </div>
        <hr class="divider-thick fixtures-panel-divider">
        <section class="fixtures-section">
          <div class="retro-slot custom-scrollbar fixtures-catalog-list">
            ${saleCards || `<p class="type-description fixtures-empty">No fixtures are available to buy.</p>`}
          </div>
        </section>
        <section class="fixtures-section fixtures-section-owned">
          ${purchaseNotice ? `<p class="layout-purchase-notice" role="status">${purchaseNotice}</p>` : ""}
          ${saleConfirmation ? `
            <div class="layout-sale-confirmation" role="status">
              <span>Sell ${saleConfirmation.name} for ${saleConfirmation.value.toLocaleString()}?
                You will no longer own it.</span>
              <span class="layout-fixture-actions">
                <button type="button" class="action-btn danger" data-confirm-fixture-sale>SELL</button>
                <button type="button" class="action-btn" data-cancel-fixture-sale>CANCEL</button>
              </span>
            </div>
          ` : ""}
          <div class="retro-slot custom-scrollbar fixtures-owned-list">
            ${placedCards || `<p class="type-description fixtures-empty">No fixtures are placed in your shop.</p>`}
            ${crateCards ? `
              <h3 class="type-h3 fixtures-crates-heading">Fixture Crates</h3>
              ${crateCards}
            ` : ""}
          </div>
        </section>
      </div>
    `;
  }
}
