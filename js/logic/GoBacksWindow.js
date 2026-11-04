// ==========================================
// FILE: GoBacksWindow.js
// ==========================================
// Window for the register's Go-Backs bin, where abandoned carts pile up. The only way out
// is clicking an item to load 1 unit into the hovercart, then stocking it elsewhere.
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
    this.bodyElement.addEventListener("contextmenu", (event) => this.handleLoad(event));
    playerState.subscribe(() => {
      if (this.uiWindow.isOpen) this.render();
    });
  }

  open() {
    this.render();
    this.uiWindow.openWindow();
  }

  /**
   * Load 1 unit of the clicked bin row into the hovercart (left or right click).
   * @param {MouseEvent} event
   */
  handleLoad(event) {
    const row = event.target.closest("[data-go-backs-item-id]");
    if (!row) return;
    event.preventDefault();
    if (!this.playerState.loadGoBacksItem(row.dataset.goBacksItemId)) {
      showPopupText(event.clientX, event.clientY, "No Space In Hovercart");
    }
  }

  render() {
    const binRows = this.playerState.goBacks.stock
      .filter((entry) => entry.quantity > 0)
      .map((entry) => {
        const item = database.getItem(entry.itemId);
        const iconHTML = item.image
          ? `<img class="item-icon" src="${item.image}" alt="" />`
          : `<div class="item-icon"></div>`;
        return `
          <div class="item-card fixture-stock-row go-backs-row" data-go-backs-item-id="${item.id}" title="Load 1 into your hovercart">
            ${iconHTML}
            <div class="item-details">
              <div class="item-card-header">
                <span class="item-card-title">${item.name}</span>
                <span class="item-card-cost">x${entry.quantity}</span>
              </div>
              <div class="fixture-stock-meta">${item.slots} hovercart slot${item.slots === 1 ? "" : "s"} each</div>
            </div>
          </div>
        `;
      })
      .join("");
    const hovercartRows = FixtureRenderer.poolStockRowsHTML(
      this.playerState.hovercart.stock,
      null,
      database,
      null,
    );

    this.bodyElement.innerHTML = `
      <div class="fixture-empty-hint">Click an item to load 1 into your hovercart.</div>
      <div class="retro-slot custom-scrollbar fixture-stock-list" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto;">
        ${binRows || `<div class="fixture-empty-hint">The bin is empty.</div>`}
      </div>
      ${FixtureRenderer.hovercartSectionHTML(this.playerState.hovercart, hovercartRows)}
    `;
  }
}
