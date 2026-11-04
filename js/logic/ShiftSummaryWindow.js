// ==========================================
// FILE: ShiftSummaryWindow.js
// ==========================================
// End-of-shift receipt: credits, reputation, and customers served / turned away, with a
// button to start the next shift. A stand-in until a real finances tab exists.
import { UIWindow } from "./UIWindow.js";

export class ShiftSummaryWindow {
  /**
   * @param {WindowManager} windowManager
   * @param {() => void} onStartNextShift
   */
  constructor(windowManager, onStartNextShift) {
    this.onStartNextShift = onStartNextShift;

    this.uiWindow = new UIWindow(
      {
        id: "shift-summary-window",
        title: "END OF SHIFT",
        contentHTML: "",
        width: "320px",
        height: "auto",
        x: 500,
        y: 200,
        shouldCloseOtherWindows: true,
      },
      windowManager,
    );
    this.bodyElement = this.uiWindow.element.querySelector(".retro-window-body");
  }

  /**
   * @param {{creditsEarned: number, reputationGained: number, customersServed: number,
   *   customersTurnedAway: number}} stats
   */
  show(stats) {
    this.bodyElement.innerHTML = `
      <div class="shift-summary">
        <div class="shift-summary-row">
          <span>Credits earned</span>
          <span class="shift-summary-value">${stats.creditsEarned.toLocaleString()} credits</span>
        </div>
        <div class="shift-summary-row">
          <span>Reputation gained</span>
          <span class="shift-summary-value">+${stats.reputationGained}</span>
        </div>
        <div class="shift-summary-row">
          <span>Customers served</span>
          <span class="shift-summary-value">${stats.customersServed}</span>
        </div>
        <div class="shift-summary-row shift-summary-warning">
          <span>Customers turned away</span>
          <span class="shift-summary-value">${stats.customersTurnedAway}</span>
        </div>
        <button id="shift-summary-start-next" class="shift-summary-button">
          START NEXT SHIFT
        </button>
      </div>
    `;

    this.bodyElement
      .querySelector("#shift-summary-start-next")
      .addEventListener("click", () => {
        this.uiWindow.close();
        this.onStartNextShift?.();
      });

    this.uiWindow.openWindow();
  }
}
