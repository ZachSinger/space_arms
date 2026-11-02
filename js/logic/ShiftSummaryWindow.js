// ==========================================
// FILE: ShiftSummaryWindow.js
// ==========================================
import { UIWindow } from "./UIWindow.js";

// Stand-in for the bible's Step 43 Finances Tab / "End Day" receipt -- there's no real
// finances system (wages, calendar, market fluctuation) yet, so this just reports what the
// vertical slice actually tracks and lets the player start the next shift.
export class ShiftSummaryWindow {
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

  show(stats) {
    this.bodyElement.innerHTML = `
      <div class="shift-summary">
        <div class="shift-summary-row">
          <span>Credits earned</span>
          <span class="shift-summary-value">${stats.creditsEarned.toLocaleString()}c</span>
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

  // The very first thing the player sees: the store hasn't opened for business at all yet
  // (bible: "the game should start with the store closed"), not mid-shift-summary with
  // zeroed-out stats that don't mean anything yet. Reuses the same window/button-wiring as
  // show() above since both are really the same "the day isn't running, press a button to
  // begin one" screen -- just with nothing to report yet.
  showPreShift() {
    this.uiWindow.element.querySelector(".retro-window-title").textContent = "STORE CLOSED";

    this.bodyElement.innerHTML = `
      <div class="shift-summary">
        <div class="shift-summary-row">
          <span>The store is closed for the day.</span>
        </div>
        <button id="shift-summary-start-next" class="shift-summary-button">
          START SHIFT
        </button>
      </div>
    `;

    this.bodyElement
      .querySelector("#shift-summary-start-next")
      .addEventListener("click", () => {
        this.uiWindow.close();
        this.uiWindow.element.querySelector(".retro-window-title").textContent = "END OF SHIFT";
        this.onStartNextShift?.();
      });

    this.uiWindow.openWindow();
  }
}
