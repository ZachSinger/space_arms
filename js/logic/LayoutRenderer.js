// ==========================================
// FILE: LayoutRenderer.js
// ==========================================
// HTML for the fixture layout panel: placed fixtures with MOVE / CRATE UP buttons, plus
// (optionally) the fixture purchase list.
import { getFixtureType } from "./FixtureLayout.js";

const FIXTURE_PURPOSES = {
  shelf: "SHELVING - displays items for customers",
  storage: "STORAGE - holds stock for restocking",
  register: "CHECKOUT - serves customers",
};

export class LayoutRenderer {
  /**
   * @param {GameScene} scene
   * @param {boolean} includePurchases - also show buying and crating (the full Layout tab)
   * @returns {string} HTML
   */
  static generateHTML(scene, includePurchases = false) {
    const enabled = scene.canRearrangeFixtures();
    const { fixtures } = scene;
    const purchaseHTML = includePurchases ? `
      <h3 class="fixture-section-title">AVAILABLE FIXTURES</h3>
      <div class="fixture-purchase-list">
        ${scene.getFixturePurchaseOptions().map(({ spec, license, licensed, canAfford, uniqueAlreadyPlaced, hasDeliverySpace }) => {
          const disabled = !licensed || !canAfford || uniqueAlreadyPlaced || !hasDeliverySpace;
          const label = uniqueAlreadyPlaced
            ? "ALREADY PLACED"
            : !licensed
              ? "LOCKED"
              : !canAfford
                ? "INSUFFICIENT FUNDS"
                : !hasDeliverySpace
                  ? "LOADING PAD FULL"
                : "BUY";
          return `
            <div class="layout-fixture-row">
              <span>${spec.name}
                <small>${FIXTURE_PURPOSES[spec.kind]} | ${spec.w} x ${spec.h} floor tiles</small>
                <small>PRICE ${spec.price} credits | ${licensed ? "LICENSED" : `NEEDS CONTRACT: ${license.name} (Contracts tab)`}</small>
              </span>
              <button type="button" class="action-btn" data-buy-fixture-id="${spec.id}"
                ${disabled ? "disabled" : ""}>${label}</button>
            </div>
          `;
        }).join("")}
      </div>
      <h3 class="fixture-section-title">PLACED FIXTURES</h3>
    ` : "";
    return `
      ${purchaseHTML}
      <div class="fixture-stock-meta">${includePurchases
        ? "Move or crate empty fixtures while the store is closed."
        : "Move existing fixtures while the store is closed."}
        Stock stays on the fixture. Doors, access aisles, and the register queue must stay clear.</div>
      <p class="layout-save-status" data-save-status role="status"></p>
      <div class="retro-slot custom-scrollbar layout-fixture-list">
        ${fixtures.all().map((fixture) => `
          <div class="layout-fixture-row" data-fixture-row-id="${fixture.id}">
            <span>${fixtures.displayName(fixture)}
              <small>${FIXTURE_PURPOSES[getFixtureType(fixture.type).kind]}</small>
              <small>(${fixture.gx}, ${fixture.gy})</small>
            </span>
            ${includePurchases ? `
              <span class="layout-fixture-actions">
                <button type="button" class="action-btn" data-move-fixture-id="${fixture.id}"
                  ${enabled ? "" : "disabled"}>MOVE</button>
                <button type="button" class="action-btn danger" data-crate-fixture-id="${fixture.id}"
                  title="${scene.getFixtureCrateBlockReason(fixture) || "Create a fixture crate"}"
                  ${scene.canCrateFixture(fixture) ? "" : "disabled"}>CRATE UP</button>
              </span>
            ` : `
              <button type="button" class="action-btn" data-move-fixture-id="${fixture.id}"
                ${enabled ? "" : "disabled"}>MOVE</button>
            `}
          </div>
        `).join("")}
      </div>
      <p class="fixture-stock-meta">${enabled
        ? includePurchases
          ? "Buy fixtures to receive a crate at the Loading Pad. Empty fixtures can be crated and carried to the back."
          : "Choose MOVE, then click a green position on the shop floor."
        : "Rearranging is available before a shift or after all customers have left."}</p>
    `;
  }
}
