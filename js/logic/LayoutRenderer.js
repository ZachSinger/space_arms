// ==========================================
// FILE: LayoutRenderer.js
// ==========================================
// HTML for the fixture layout panel: placed fixtures with MOVE / CRATE UP buttons, plus
// (optionally) the fixture purchase list.
import { getFixtureResaleValue, getFixtureType } from "./FixtureLayout.js";
import { formatMoney } from "./Money.js";
import { LOADING_PAD_SPOTS } from "./SupplyOrder.js";

const FIXTURE_PURPOSES = {
  shelf: "SHELVING - displays items for customers",
  storage: "STORAGE - holds stock for restocking",
  register: "CHECKOUT - serves customers",
};

export class LayoutRenderer {
  /**
   * @param {GameScene} scene
   * @param {boolean} includePurchases - also show buying, crating, and selling (the Fixtures tab)
   * @param {string} [purchaseNotice] - confirmation of the fixture just bought
   * @param {{ name: string, value: number } | null} [saleConfirmation]
   * @returns {string} HTML
   */
  static generateHTML(scene, includePurchases = false, purchaseNotice = "", saleConfirmation = null) {
    const enabled = scene.canRearrangeFixtures();
    const { fixtures } = scene;
    const waitingNames = (scene.restockCrates ?? [])
      .filter((crate) => crate.kind === "fixture" && crate.lockedToPad)
      .map((crate) => getFixtureType(crate.typeId).name);
    const freeSpots = scene.getLoadingPadSpawnPositions?.().length ?? LOADING_PAD_SPOTS;
    const fixtureCrates = (scene.restockCrates ?? [])
      .map((crate, index) => ({ crate, key: String(index) }))
      .filter(({ crate }) => crate.kind === "fixture");
    if (scene.carriedCrate?.kind === "fixture") {
      fixtureCrates.push({ crate: scene.carriedCrate, key: "carried" });
    }
    const purchaseHTML = includePurchases ? `
      <h3 class="fixture-section-title">AVAILABLE FIXTURES</h3>
      <p class="fixture-stock-meta layout-pad-status">Loading Pad: ${freeSpots} of ${LOADING_PAD_SPOTS} spots free.
        ${waitingNames.length
          ? `Fixture crates waiting there: ${waitingNames.join(", ")}.`
          : "No fixture crates waiting there."}</p>
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
      ${includePurchases && purchaseNotice ? `<p class="layout-purchase-notice" role="status">${purchaseNotice}</p>` : ""}
      ${includePurchases && saleConfirmation ? `
        <div class="layout-sale-confirmation" role="status">
          <span>Sell ${saleConfirmation.name} for ${formatMoney(saleConfirmation.value)}?
            You will no longer own it.</span>
          <span class="layout-fixture-actions">
            <button type="button" class="action-btn danger" data-confirm-fixture-sale>SELL</button>
            <button type="button" class="action-btn" data-cancel-fixture-sale>CANCEL</button>
          </span>
        </div>
      ` : ""}
      ${includePurchases ? `<div class="fixture-management-scroll custom-scrollbar">` : ""}
      ${purchaseHTML}
      <div class="fixture-stock-meta">${includePurchases
        ? "Move fixtures, or crate or sell empty fixtures, while the store is closed."
        : "Move existing fixtures while the store is closed."}
        Stock stays on a moved fixture. Doors, access aisles, and the register queue must stay clear.</div>
      <p class="layout-save-status" data-save-status role="status"></p>
      <div class="retro-slot custom-scrollbar layout-fixture-list">
        ${fixtures.all().map((fixture) => {
          const saleBlockReason = includePurchases ? scene.getFixtureSaleBlockReason(fixture) : null;
          return `
          <div class="layout-fixture-row" data-fixture-row-id="${fixture.id}">
            <span>${fixtures.displayName(fixture)}
              <small>${FIXTURE_PURPOSES[getFixtureType(fixture.type).kind]}</small>
              <small>(${fixture.gx}, ${fixture.gy})</small>
              ${includePurchases ? `<small>Resale value: ${formatMoney(getFixtureResaleValue(fixture.type))}</small>` : ""}
              ${enabled && saleBlockReason ? `<small>${saleBlockReason}</small>` : ""}
            </span>
            ${includePurchases ? `
              <span class="layout-fixture-actions">
                <button type="button" class="action-btn" data-move-fixture-id="${fixture.id}"
                  ${enabled ? "" : "disabled"}>MOVE</button>
                <button type="button" class="action-btn danger" data-crate-fixture-id="${fixture.id}"
                  title="${scene.getFixtureCrateBlockReason(fixture) || "Create a fixture crate"}"
                  ${scene.canCrateFixture(fixture) ? "" : "disabled"}>CRATE UP</button>
                <button type="button" class="action-btn danger" data-sell-fixture-id="${fixture.id}"
                  title="${saleBlockReason || "Sell this empty fixture"}"
                  ${saleBlockReason ? "disabled" : ""}>SELL</button>
              </span>
            ` : `
              <button type="button" class="action-btn" data-move-fixture-id="${fixture.id}"
                ${enabled ? "" : "disabled"}>MOVE</button>
            `}
          </div>
        `;
        }).join("")}
        ${includePurchases && fixtureCrates.length ? `
          <h3 class="fixture-section-title">FIXTURE CRATES</h3>
          ${fixtureCrates.map(({ crate, key }) => {
            const name = getFixtureType(crate.typeId).name;
            const location = key === "carried" ? "Being carried" : crate.lockedToPad ? "Loading Pad" : "On the floor";
            const reason = scene.getFixtureCrateSaleBlockReason(crate);
            return `
              <div class="layout-fixture-row">
                <span>${name} crate
                  <small>${location} | Resale value: ${formatMoney(getFixtureResaleValue(crate.typeId))}</small>
                </span>
                <button type="button" class="action-btn danger" data-sell-fixture-crate="${key}"
                  title="${reason || "Sell this fixture crate"}" ${reason ? "disabled" : ""}>SELL</button>
              </div>
            `;
          }).join("")}
        ` : ""}
      </div>
      <p class="fixture-stock-meta">${enabled
        ? includePurchases
          ? "Buy fixtures to receive a crate at the Loading Pad. Sell an empty fixture or fixture crate for half its price."
          : "Choose MOVE, then click a green position on the shop floor."
        : includePurchases
          ? "Moving, crating, and selling fixtures are available before a shift or after all customers have left."
          : "Rearranging is available before a shift or after all customers have left."}</p>
      ${includePurchases ? "</div>" : ""}
    `;
  }
}
