// ==========================================
// FILE: GoBacksWindow.js
// ==========================================
// Window for the register's Go-Backs bin, where abandoned carts pile up. It works like a
// locker you can only take from: TAKE moves 1 unit into the hovercart.
import { UIWindow } from "./UIWindow.js";
import { FixtureRenderer } from "./FixtureRenderer.js";
import { showPopupText } from "./FixtureWindow.js";
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

export class GoBacksWindow {
  constructor(windowManager, playerState) {
    this.playerState = playerState;
    this.uiWindow = new UIWindow(
      {
        id: "go-backs-window",
        title: "GO-BACKS BIN",
        contentHTML: "",
        width: "28vw",
        height: "56vh",
        x: 24,
        y: 120,
      },
      windowManager,
    );
    this.bodyElement = this.uiWindow.element.querySelector(".retro-window-body");
    this.bodyElement.addEventListener("click", (event) => this.handleLoad(event));
    playerState.subscribe(() => {
      if (this.uiWindow.isOpen) this.render();
    });
  }

  open() {
    this.render();
    this.uiWindow.openWindow();
  }

  /**
   * TAKE moves 1 unit of that item into the hovercart.
   * @param {MouseEvent} event
   */
  handleLoad(event) {
    const button = event.target.closest("[data-go-backs-item-id]");
    if (!button || button.disabled) return;
    if (!this.playerState.loadGoBacksItem(button.dataset.goBacksItemId)) {
      showPopupText(event.clientX, event.clientY, "No Space In Hovercart");
    }
  }

  render() {
    const hovercart = this.playerState.hovercart;
    const binRows = this.playerState.goBacks.stock
      .filter((entry) => entry.quantity > 0)
      .map((entry) => {
        const item = database.getItem(entry.itemId);
        const meta = `${item.slots} hovercart slot${item.slots === 1 ? "" : "s"} each`;
        return FixtureRenderer.transferRowHTML(item, entry.quantity, meta, hovercart, "data-take-item-id")
          .replace("data-take-item-id=", "data-go-backs-item-id=");
      })
      .join("");
    // Nothing goes back into the bin, so the hovercart list has no STOCK buttons.
    const hovercartRows = FixtureRenderer.poolStockRowsHTML(hovercart.stock, null, database, null);

    this.bodyElement.innerHTML = `
      <div class="fixture-section-title">ITEMS LEFT BY CUSTOMERS<span class="fixture-section-hint">Take them out to put back on shelves</span></div>
      <div class="retro-slot custom-scrollbar fixture-stock-list" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto;">
        ${binRows || `<div class="fixture-empty-hint">The bin is empty.</div>`}
      </div>
      ${FixtureRenderer.hovercartSectionHTML(hovercart, hovercartRows)}
    `;
  }
}
