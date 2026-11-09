// ==========================================
// FILE: ContractRenderer.js
// ==========================================
// HTML for the Contracts tab: one card per supplier license with its requirements, cost,
// fixture unlocks, and a buy button reflecting locked/affordable/owned state.
import { getFixtureType } from "./FixtureLayout.js";

export class ContractRenderer {
  /** Signable contracts first, locked ones next, already-signed ones last; original order within each group. */
  static sortLicenses(licenses, playerState) {
    const group = (license) => {
      if (playerState.activeLicenses?.has(license.id)) return 2;
      return license.isUnlocked(playerState) ? 0 : 1;
    };
    return licenses
      .map((license, index) => ({ license, index, group: group(license) }))
      .sort((a, b) => a.group - b.group || a.index - b.index)
      .map((entry) => entry.license);
  }

  /**
   * Build the tab's content only; the hosting window (ManagerTablet.js) owns the tab chrome.
   * @param {Array<SupplierLicense>} licenses
   * @param {PlayerState} playerState
   * @returns {string} HTML
   */
  static generateHTML(licenses, playerState) {
    let html = `
            <div class="retro-slot custom-scrollbar" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow-y: auto;">
        `;

    if (!licenses || licenses.length === 0) {
      html += `<div style="color: var(--color-text-muted); text-align: center; padding: 20px;">No contracts available in database.</div>`;
    } else {
      ContractRenderer.sortLicenses(licenses, playerState).forEach((license) => {
        const isShopLevelMet =
          playerState.shopLevel >= license.requiredShopLevel;
        const isGlobalRepMet =
          license.reqReputation === null ||
          playerState.globalReputation >= license.reqReputation;
        const isFactionRepMet =
          !license.reqFaction ||
          playerState.factionReputation[license.reqFaction] >=
            license.reqFactionRep;
        const isUnlocked = license.isUnlocked(playerState);
        const canAfford = license.canAfford(playerState);
        const isOwned =
          playerState.activeLicenses &&
          playerState.activeLicenses.has(license.id);

        let actionButtonHTML = "";
        const fixtureNames = license.unlocksFixtures
          .map((typeId) => getFixtureType(typeId)?.name)
          .filter(Boolean);
        const fixtureUnlocksHTML = fixtureNames.length
          ? `<div class="fixture-stock-meta">Unlocks fixtures: ${fixtureNames.join(", ")}</div>`
          : "";

        if (isOwned) {
          actionButtonHTML = `<button class="retro-tab-btn" disabled style="opacity: 0.6; cursor: not-allowed; width: 100%; text-align: center;">[ PURCHASED ]</button>`;
        } else if (!isUnlocked) {
          actionButtonHTML = `<button class="retro-tab-btn" disabled style="opacity: 0.5; cursor: not-allowed; width: 100%; text-align: center; color: var(--color-text-muted);">LOCKED</button>`;
        } else if (!canAfford) {
          actionButtonHTML = `<button class="action-btn danger" disabled style="opacity: 0.7; cursor: not-allowed; width: 100%; font-size: var(--font-size-11);">INSUFFICIENT FUNDS</button>`;
        } else {
          actionButtonHTML = `<button class="action-btn" data-license-id="${license.id}" style="width: 100%; font-size: var(--font-size-12);">SIGN CONTRACT</button>`;
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
                    <div class="item-card">
                        <div class="item-details">
                            <div class="item-card-header">
                                <span class="item-card-title">${license.name}</span>
                                <span class="item-card-cost" style="color: var(--color-text-main); font-size: var(--font-size-11); padding: 2px 6px; background: rgba(255,255,255,0.1); border-radius: 2px;">Tier ${license.tier}</span>
                            </div>
                            <div class="item-card-flavor">"${license.description}"</div>
                            ${fixtureUnlocksHTML}
                            <div style="display: flex; justify-content: space-between; font-size: var(--font-size-11); margin-top: 6px; border-top: 1px dashed var(--color-border-subtle); padding-top: 6px;">
                                <span>${requirementsHtml}</span>
                                <span style="color: var(--color-text-main); font-weight: bold;">Cost: ${license.baseCost.toLocaleString()} credits</span>
                            </div>
                            <div style="margin-top: 8px;">
                                ${actionButtonHTML}
                            </div>
                        </div>
                    </div>
                `;
      });
    }

    html += `</div>`;
    return html;
  }
}
