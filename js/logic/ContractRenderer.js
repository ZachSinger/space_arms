// ==========================================
// FILE: ContractRenderer.js
// ==========================================
// HTML for the Contracts tab: one card per supplier license with its requirements, cost,
// fixture unlocks, and a buy button reflecting locked/affordable/owned state.
import { getFixtureType } from "./FixtureLayout.js";

export class ContractRenderer {
  /** Signable contracts first, locked ones next, already-signed ones last; original order within each group. */
  static sortLicenses(licenses, gameState) {
    const group = (license) => {
      if (gameState.catalog.owns(license.id)) return 2;
      return license.isUnlocked(gameState) ? 0 : 1;
    };
    return licenses
      .map((license, index) => ({ license, index, group: group(license) }))
      .sort((a, b) => a.group - b.group || a.index - b.index)
      .map((entry) => entry.license);
  }

  /**
   * Build the tab's content only; the hosting window (ManagerTablet.js) owns the tab chrome.
   * @param {Array<SupplierLicense>} licenses
   * @param {import('../state/GameState.js').GameState} gameState
   * @returns {string} HTML
   */
  static generateHTML(licenses, gameState) {
    let html = `
      <div class="contracts-panel">
        <h2 class="type-h2">Supplier Contracts</h2>
        <hr class="divider-thick">
        <div class="contracts-list custom-scrollbar">
    `;

    if (!licenses || licenses.length === 0) {
      html += `<p class="type-description contracts-empty">No contracts are available.</p>`;
    } else {
      ContractRenderer.sortLicenses(licenses, gameState).forEach((license) => {
        const isShopLevelMet =
          gameState.reputation.shopLevel >= license.requiredShopLevel;
        const isGlobalRepMet =
          license.reqReputation === null ||
          gameState.reputation.global >= license.reqReputation;
        const isFactionRepMet =
          !license.reqFaction ||
          gameState.reputation.factions[license.reqFaction] >=
            license.reqFactionRep;
        const isUnlocked = license.isUnlocked(gameState);
        const canAfford = license.canAfford(gameState);
        const isOwned = gameState.catalog.owns(license.id);

        let actionButtonHTML = "";
        const fixtureNames = license.unlocksFixtures
          .map((typeId) => getFixtureType(typeId)?.name)
          .filter(Boolean);
        const fixtureUnlocksHTML = fixtureNames.length
          ? `<p class="type-description contracts-details">Unlocks fixtures: ${fixtureNames.join(", ")}</p>`
          : "";

        if (isOwned) {
          actionButtonHTML = `<button type="button" class="retro-tab-btn" disabled>PURCHASED</button>`;
        } else if (!isUnlocked) {
          actionButtonHTML = `<button type="button" class="retro-tab-btn" disabled>LOCKED</button>`;
        } else if (!canAfford) {
          actionButtonHTML = `<button type="button" class="action-btn danger" disabled>INSUFFICIENT FUNDS</button>`;
        } else {
          actionButtonHTML = `<button type="button" class="action-btn" data-license-id="${license.id}">SIGN CONTRACT</button>`;
        }

        const globalRepColor = isGlobalRepMet
          ? "var(--color-text-muted)"
          : "#ef4444";
        const levelColor = isShopLevelMet ? "var(--color-text-muted)" : "#ef4444";
        const levelHtml = license.requiredShopLevel > 1
          ? `<span style="color: ${levelColor};">Requires Shop Level ${license.requiredShopLevel}</span>`
          : "";
        const globalHtml = license.reqReputation !== null
          ? `<span style="color: ${globalRepColor};">Store reputation: ${license.reqReputation}</span>`
          : "";
        let factionHtml = "";

        if (license.reqFaction) {
          const factionRepColor = isFactionRepMet
            ? "var(--color-text-muted)"
            : "#ef4444";
          const factionName =
            license.reqFaction.charAt(0).toUpperCase() +
            license.reqFaction.slice(1);
          factionHtml = `<span style="color: ${factionRepColor};">${factionName} reputation: ${license.reqFactionRep}</span>`;
        }
        const requirementsHtml = isOwned
          ? "Purchased; stays available."
          : [levelHtml, globalHtml, factionHtml].filter(Boolean).join(" | ");

        html += `
          <div class="item-card contract-card">
            <div class="contract-information">
              <h3 class="type-h3">${license.name}</h3>
              <p class="type-description contracts-details">${license.description}</p>
              ${fixtureUnlocksHTML}
              ${requirementsHtml ? `<p class="type-description contract-requirements">${requirementsHtml}</p>` : ""}
            </div>
            <div class="contract-action">
              <p class="type-description">Tier ${license.tier}</p>
              <p class="type-description">Cost: ${license.baseCost.toLocaleString()}</p>
              ${actionButtonHTML}
            </div>
          </div>
        `;
      });
    }

    html += `</div></div>`;
    return html;
  }
}
