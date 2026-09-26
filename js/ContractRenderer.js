import { Debugger } from "./Debugger.js";

export class ContractRenderer {
  /**
   * Generates the HTML layout for the Contracts tab inside the Tablet.
   * @param {Array<SupplierLicense>} licenses - Array of license objects
   * @param {PlayerState} playerState - The central player state instance
   */
  static generateHTML(licenses, playerState) {
    let html = `
            <div style="display: flex; gap: 4px; margin-bottom: 10px;">
                <button class="retro-tab-btn" data-tab="shift">Shift</button>
                <button class="retro-tab-btn" data-tab="inventory">Inventory DB</button>
                <button class="retro-tab-btn active" data-tab="contracts">Contracts</button>
            </div>
            <div class="retro-slot custom-scrollbar" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; overflow-y: auto;">
        `;

    if (!licenses || licenses.length === 0) {
      html += `<div style="color: var(--color-text-muted); text-align: center; padding: 20px;">No contracts available in database.</div>`;
    } else {
      licenses.forEach((license) => {
        const isGlobalRepMet =
          playerState.globalReputation >= license.reqReputation;
        const isFactionRepMet =
          !license.reqFaction ||
          playerState.factionReputation[license.reqFaction] >=
            license.reqFactionRep;
        const isUnlocked = isGlobalRepMet && isFactionRepMet;
        const canAfford = license.canAfford(playerState);
        const isOwned =
          playerState.activeLicenses &&
          playerState.activeLicenses.has(license.id);

        let actionButtonHTML = "";

        if (isOwned) {
          actionButtonHTML = `<button class="retro-tab-btn" disabled style="opacity: 0.6; cursor: not-allowed; width: 100%; text-align: center;">[ PURCHASED ]</button>`;
        } else if (!isUnlocked) {
          actionButtonHTML = `<button class="retro-tab-btn" disabled style="opacity: 0.5; cursor: not-allowed; width: 100%; text-align: center; color: var(--color-text-muted);">LOCKED</button>`;
        } else if (!canAfford) {
          actionButtonHTML = `<button class="action-btn danger" disabled style="opacity: 0.7; cursor: not-allowed; width: 100%; font-size: 11px;">INSUFFICIENT FUNDS</button>`;
        } else {
          actionButtonHTML = `<button class="action-btn" data-license-id="${license.id}" style="width: 100%; font-size: 12px;">SIGN CONTRACT</button>`;
        }

        const globalRepColor = isGlobalRepMet
          ? "var(--color-text-muted)"
          : "#ef4444";
        let factionHtml = "";

        if (license.reqFaction) {
          const factionRepColor = isFactionRepMet
            ? "var(--color-text-muted)"
            : "#ef4444";
          const factionName =
            license.reqFaction.charAt(0).toUpperCase() +
            license.reqFaction.slice(1);
          factionHtml = ` | <span style="color: ${factionRepColor};">Req ${factionName}: ${license.reqFactionRep}</span>`;
        }

        // --- CARD HTML GENERATION ---
        html += `
                    <div class="item-card">
                        <div class="item-details">
                            <div class="item-card-header">
                                <span class="item-card-title">${license.name}</span>
                                <span class="item-card-cost" style="color: var(--color-text-main); font-size: 11px; padding: 2px 6px; background: rgba(255,255,255,0.1); border-radius: 2px;">Tier ${license.tier}</span>
                            </div>
                            <div class="item-card-flavor">"${license.description}"</div>
                            <div style="display: flex; justify-content: space-between; font-size: 11px; margin-top: 6px; border-top: 1px dashed var(--color-border-subtle); padding-top: 6px;">
                                <span><span style="color: ${globalRepColor};">Req Rep: ${license.reqReputation} Pts</span>${factionHtml}</span>
                                <span style="color: var(--color-text-main); font-weight: bold;">Cost: ${license.baseCost.toLocaleString()}c</span>
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
