// The Equipment tab's hovercart upgrades.
import { getNextHovercartUpgrade } from "./Hovercart.js";
import { formatMoney } from "./Money.js";

export class EquipmentRenderer {
  static generateHTML(playerState, notice = "") {
    const { hovercart, credits, shopLevel } = playerState;
    const upgrade = getNextHovercartUpgrade(hovercart.capacity);
    const levelMet = upgrade && shopLevel >= upgrade.requiredShopLevel;
    const affordable = upgrade && credits >= upgrade.price;
    let upgradeStatus = "";
    if (upgrade && !levelMet) {
      upgradeStatus = `Reach Shop Level ${upgrade.requiredShopLevel} to buy this upgrade.`;
    } else if (upgrade && !affordable) {
      upgradeStatus = "Not enough credits for this upgrade.";
    }
    return `
      <div class="fixture-stock-meta">A larger hovercart lets you carry more stock between
        shelves and lockers. Some items take more space than others.</div>
      <div class="fixture-section-divider">HOVERCART</div>
      ${notice ? `<p class="layout-purchase-notice" role="status">${notice}</p>` : ""}
      <div class="fixture-stock-row">
        <div>
          <strong>Current capacity: ${hovercart.capacity} spaces</strong>
          <div class="fixture-stock-meta">Currently carrying: ${hovercart.usedCapacity()} of ${hovercart.capacity} spaces.</div>
          ${upgrade
            ? `<div class="fixture-stock-meta">Next upgrade: ${upgrade.capacity} spaces for ${formatMoney(upgrade.price)}.</div>
               ${upgradeStatus ? `<div class="fixture-stock-meta">${upgradeStatus}</div>` : ""}`
            : `<div class="fixture-stock-meta">Your hovercart is at its maximum capacity.</div>`}
        </div>
        ${upgrade ? `<button type="button" class="action-btn" data-upgrade-hovercart
          ${levelMet && affordable ? "" : "disabled"}>UPGRADE</button>` : ""}
      </div>
    `;
  }
}
