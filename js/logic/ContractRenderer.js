// ==========================================
// FILE: ContractRenderer.js
// ==========================================
// HTML for the Contracts tab: one card per supplier license with its requirements, cost,
// fixture unlocks, and a buy button reflecting locked/affordable/owned state.
import { html } from "../core/html.js";
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
    const cards = !licenses || licenses.length === 0
      ? html`<p class="type-description contracts-empty">No contracts are available.</p>`
      : ContractRenderer.sortLicenses(licenses, gameState).map((license) => {
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

        const actionButton = isOwned
          ? html`<button type="button" class="retro-tab-btn" disabled>PURCHASED</button>`
          : !isUnlocked
            ? html`<button type="button" class="retro-tab-btn" disabled>LOCKED</button>`
            : !canAfford
              ? html`<button type="button" class="action-btn danger" disabled>INSUFFICIENT FUNDS</button>`
              : html`<button type="button" class="action-btn" data-license-id="${license.id}">SIGN CONTRACT</button>`;
        const fixtureNames = license.unlocksFixtures
          .map((typeId) => getFixtureType(typeId)?.name)
          .filter(Boolean);
        const fixtureUnlocks = fixtureNames.length
          ? html`<p class="type-description contracts-details">Unlocks fixtures: ${fixtureNames.join(", ")}</p>`
          : null;

        const globalRepColor = isGlobalRepMet
          ? "var(--color-text-muted)"
          : "#ef4444";
        const levelColor = isShopLevelMet ? "var(--color-text-muted)" : "#ef4444";
        const levelRequirement = license.requiredShopLevel > 1
          ? html`<span style="color: ${levelColor};">Requires Shop Level ${license.requiredShopLevel}</span>`
          : null;
        const globalRequirement = license.reqReputation !== null
          ? html`<span style="color: ${globalRepColor};">Store reputation: ${license.reqReputation}</span>`
          : null;
        let factionRequirement = null;
        if (license.reqFaction) {
          const factionRepColor = isFactionRepMet
            ? "var(--color-text-muted)"
            : "#ef4444";
          const factionName =
            license.reqFaction.charAt(0).toUpperCase() +
            license.reqFaction.slice(1);
          factionRequirement = html`<span style="color: ${factionRepColor};">${factionName} reputation: ${license.reqFactionRep}</span>`;
        }
        const requirementParts = isOwned
          ? ["Purchased; stays available."]
          : [levelRequirement, globalRequirement, factionRequirement].filter(Boolean)
            .flatMap((part, index) => index === 0 ? [part] : [html` | `, part]);
        const requirements = requirementParts.length
          ? html`<p class="type-description contract-requirements">${requirementParts}</p>`
          : null;

        return html`
          <div class="item-card contract-card">
            <div class="contract-information">
              <h3 class="type-h3">${license.name}</h3>
              <p class="type-description contracts-details">${license.description}</p>
              ${fixtureUnlocks}
              ${requirements}
            </div>
            <div class="contract-action">
              <p class="type-description">Tier ${license.tier}</p>
              <p class="type-description">Cost: ${license.baseCost.toLocaleString()}</p>
              ${actionButton}
            </div>
          </div>
        `;
      });

    return String(html`
      <div class="contracts-panel">
        <h2 class="type-h2">Supplier Contracts</h2>
        <hr class="divider-thick">
        <div class="contracts-list custom-scrollbar">
          ${cards}
        </div>
      </div>
    `);
  }
}
