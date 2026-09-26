/**
 * ContractRenderer.js
 * Handles rendering the Supplier Contracts view inside the Manager's Tablet.
 */
export class ContractRenderer {
  /**
   * Renders the licenses array into the container element.
   * @param {HTMLElement} container - Target container for cards.
   * @param {Array} licenses - Array of license data objects.
   * @param {Object} playerState - Central PlayerState instance.
   * @param {Function} onSign - Callback invoked with the selected license.
   */
  static render(container, licenses, playerState, onSign) {
    container.innerHTML = "";

    const grid = document.createElement("div");
    grid.className = "contracts-grid";

    licenses.forEach((license) => {
      const card = document.createElement("div");
      card.className = "item-card";

      const isOwned = playerState.hasLicense(license.id);
      const hasGlobalRep =
        playerState.globalReputation >= license.reqReputation;
      const hasFunds = playerState.credits >= license.baseCost;

      // Faction evaluation
      let hasFactionRep = true;
      let factionNameFormatted = "";
      if (license.reqFaction && license.reqFactionRep > 0) {
        const currentFactionRep = playerState.getFactionReputation(
          license.reqFaction,
        );
        hasFactionRep = currentFactionRep >= license.reqFactionRep;
        factionNameFormatted =
          license.reqFaction.charAt(0).toUpperCase() +
          license.reqFaction.slice(1);
      }

      const meetsAllRep = hasGlobalRep && hasFactionRep;

      // Strict Button States
      let btnText = "SIGN CONTRACT";
      let btnDisabled = false;
      let btnClass = "retro-tab-btn active";

      if (isOwned) {
        btnText = "[ PURCHASED ]";
        btnDisabled = true;
        btnClass = "retro-tab-btn disabled";
      } else if (!meetsAllRep) {
        btnText = "LOCKED";
        btnDisabled = true;
        btnClass = "retro-tab-btn disabled";
      } else if (!hasFunds) {
        btnText = "INSUFFICIENT FUNDS";
        btnDisabled = true;
        btnClass = "retro-tab-btn disabled";
      }

      card.innerHTML = `
                <div class="card-header">
                    <span class="card-title">${license.name}</span>
                    <span class="card-tier">TIER ${license.tier}</span>
                </div>
                <div class="card-desc">${license.description}</div>
                <div class="card-reqs">
                    <span class="req-item cost">Cost: ${license.baseCost.toLocaleString()} CR</span>
                    <span class="divider">|</span>
                    <span class="req-item ${hasGlobalRep ? "met-rep" : "unmet"}">
                        Req Rep: ${license.reqReputation}
                    </span>
                    ${
                      license.reqFaction && license.reqFactionRep > 0
                        ? `
                        <span class="divider">|</span>
                        <span class="req-item ${hasFactionRep ? "met-faction" : "unmet"}">
                            Req ${factionNameFormatted}:${license.reqFactionRep}
                        </span>
                    `
                        : ""
                    }
                </div>
                <div class="card-footer">
                    <button class="${btnClass}" ${btnDisabled ? "disabled" : ""}>${btnText}</button>
                </div>
            `;

      if (!btnDisabled) {
        const button = card.querySelector("button");
        button.addEventListener("click", () => {
          if (typeof onSign === "function") {
            onSign(license);
          }
        });
      }

      grid.appendChild(card);
    });

    container.appendChild(grid);
  }
}

export default ContractRenderer;
