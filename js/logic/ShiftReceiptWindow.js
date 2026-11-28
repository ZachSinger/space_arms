import { UIWindow } from "./UIWindow.js";
import { renderReceipt } from "./FinancesRenderer.js";

export class ShiftReceiptWindow {
  constructor(shop) {
    this.shop = shop;
    this.background = [];
    this.endingDay = false;
    this.dayEnded = false;
    this.shade = document.createElement("div");
    this.shade.className = "shift-receipt-shade hidden";
    document.getElementById("ui-layer").append(this.shade);
    this.uiWindow = new UIWindow({
      id: "shift-receipt", title: "SHOP CLOSED", width: "1120px", height: "auto",
      closable: false, shouldCloseOtherWindows: true, contentHTML: "",
    }, shop.windowManager);
    this.uiWindow.element.setAttribute("role", "dialog");
    this.uiWindow.element.setAttribute("aria-modal", "true");
    this.uiWindow.element.setAttribute("aria-label", "Today's receipt");
    this.uiWindow.element.addEventListener("click", (event) => {
      if (event.target.closest("[data-end-day]")) void this.finishDay();
    });
  }

  get isOpen() { return this.uiWindow.isOpen; }

  open() {
    this.dayEnded = false;
    const view = this.shop.shift.financesView();
    this.uiWindow.element.querySelector(".retro-window-title").textContent = `SHOP CLOSED - DAY ${view.day}`;
    this.uiWindow.element.querySelector(".retro-window-body").innerHTML = `
      <div class="shift-receipt-scroll custom-scrollbar">
        <h2 class="type-h2">TODAY'S RECEIPT</h2>
        ${renderReceipt(view.today, { final: true })}
      </div>
      <div class="shift-receipt-footer">
        <p>Review today's sales and spending before ending the day.</p>
        <p data-receipt-save-status role="status" aria-live="polite"></p>
        <button type="button" class="action-btn" data-end-day data-pad-autofocus
          ${view.canEndDay ? "" : "disabled"}>END DAY ${view.day}</button>
      </div>`;
    this.shop.windowManager.currentMaxZ = Math.max(this.shop.windowManager.currentMaxZ, 1000);
    this.uiWindow.openWindow();
    this.shade.classList.remove("hidden");
    this.shade.style.zIndex = String(Number(this.uiWindow.element.style.zIndex) - 1);
    for (const element of document.getElementById("ui-layer").children) {
      if (element === this.shade || element === this.uiWindow.element || element.inert) continue;
      element.inert = true;
      this.background.push(element);
    }
    this.shop.setGamePaused(true);
    this.uiWindow.element.querySelector("[data-end-day]").focus();
  }

  async finishDay() {
    if (this.endingDay) return;
    this.endingDay = true;
    const button = this.uiWindow.element.querySelector("[data-end-day]");
    const status = this.uiWindow.element.querySelector("[data-receipt-save-status]");
    button.disabled = true;
    status.textContent = "";
    try {
      if (!this.dayEnded) {
        if (!this.shop.shift.endDay()) return;
        this.dayEnded = true;
      }
      status.textContent = "Autosaving...";
      await this.shop.saves.autosave();
      this.close();
    } catch (error) {
      console.error("End-of-day autosave failed:", error);
      status.textContent = `Autosave failed: ${error.message} Try again before continuing.`;
      button.textContent = "RETRY AUTOSAVE";
    } finally {
      button.disabled = false;
      this.endingDay = false;
    }
  }

  close() {
    this.uiWindow.close();
    this.shade.classList.add("hidden");
    for (const element of this.background) element.inert = false;
    this.background = [];
    this.shop.setGamePaused(Boolean(this.shop.pauseMenu?.isOpen));
  }

  destroy() {
    for (const element of this.background) element.inert = false;
    this.background = [];
    this.shade.remove();
    this.uiWindow.element.remove();
  }
}
