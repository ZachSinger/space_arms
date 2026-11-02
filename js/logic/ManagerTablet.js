// ==========================================
// FILE: ManagerTablet.js
// ==========================================
import { UIWindow } from "./UIWindow.js";
import { InventoryRenderer } from "./InventoryRenderer.js";
import { ContractRenderer } from "./ContractRenderer.js";
import { SupplyRenderer } from "./SupplyRenderer.js";
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

// The bible's full Step 40 tab list (Part 8). Only Inventory and Contracts have a real
// system behind them so far -- the rest render a "COMING SOON" placeholder instead of
// being omitted entirely, so the Tablet's shape already matches the eventual design. See
// TODO.md for what's still unbuilt behind each placeholder.
const TAB_DEFS = [
  { id: "inventory", label: "Inventory" },
  { id: "employee", label: "Employee" },
  { id: "contracts", label: "Contracts" },
  { id: "supply", label: "Supply" },
  { id: "fixtures", label: "Fixtures" },
  { id: "layout", label: "Layout" },
  { id: "finances", label: "Finances" },
  { id: "handbook", label: "Handbook" },
];

// The single unified Manager's Tablet window (bible Part 8), replacing the old
// standalone Inventory-only window. Owns tab-switching and the Contracts tab's
// buy/sign interaction; each tab's actual content still comes from its own renderer
// (InventoryRenderer, ContractRenderer, ...) -- this class only owns the shared chrome
// around them.
export class ManagerTablet {
  constructor(windowManager, playerState, scene) {
    this.playerState = playerState;
    this.scene = scene; // needed by the Supply tab to read/order fixture stock

    const tabBarHTML = TAB_DEFS.map(
      ({ id, label }, index) =>
        `<button class="retro-tab-btn tablet-tab-btn${index === 0 ? " active" : ""}" data-tab="${id}">${label}</button>`,
    ).join("");

    const panelsHTML = TAB_DEFS.map(({ id }, index) => {
      const hiddenClass = index === 0 ? "" : " hidden";
      return `<div class="tablet-tab-panel${hiddenClass}" data-tab-panel="${id}">${this.renderPanelContent(id)}</div>`;
    }).join("");

    this.uiWindow = new UIWindow(
      {
        id: "manager-tablet",
        title: "MANAGER'S TABLET",
        contentHTML: `
          <div class="tablet-tab-bar">${tabBarHTML}</div>
          <div class="tablet-tab-content">${panelsHTML}</div>
        `,
        width: "40vw",
        height: "60vh",
        x: 60,
        y: 60,
      },
      windowManager,
    );

    this.bodyElement = this.uiWindow.element.querySelector(".retro-window-body");
    this.disableInventoryNavigation = InventoryRenderer.enableListNavigation(
      this.uiWindow.element,
    );

    this.bodyElement.querySelector(".tablet-tab-bar").addEventListener("click", (event) => {
      const button = event.target.closest("[data-tab]");
      if (button) this.switchTab(button.dataset.tab);
    });

    // Delegated (rather than bound per-card) since the Contracts panel's innerHTML gets
    // fully replaced every time playerState changes -- see refreshContractsPanel().
    this.bodyElement.addEventListener("click", (event) => {
      const signButton = event.target.closest("[data-license-id]");
      if (signButton) this.handleSignContract(signButton.dataset.licenseId);

      const orderButton = event.target.closest("[data-order-item-id]");
      if (orderButton) this.handleOrderRestock(orderButton.dataset.orderItemId);
    });

    // Licenses can flip between locked/unaffordable/available purely because credits or
    // reputation changed elsewhere (a sale completing, reputation gained/lost) -- re-render
    // the Contracts panel on every state change so it never goes stale while the Tablet
    // happens to be open. (Fires once immediately on subscribe -- harmless, just an extra
    // render of a tiny list before the window is even shown.) The Supply tab's afford-
    // ability (and its "on shelf" counts, which change on every sale too) needs the exact
    // same live refresh, for the same reason.
    this.playerState.subscribe(() => {
      this.refreshContractsPanel();
      this.refreshSupplyPanel();
    });
  }

  renderPanelContent(tabId) {
    if (tabId === "inventory") return InventoryRenderer.generateHTML(database);
    if (tabId === "contracts") {
      return ContractRenderer.generateHTML(database.getAllLicenses(), this.playerState);
    }
    if (tabId === "supply") return SupplyRenderer.generateHTML(this.scene);
    return `<div class="tablet-placeholder">COMING SOON</div>`;
  }

  switchTab(tabId) {
    this.bodyElement.querySelectorAll(".tablet-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    });
    this.bodyElement.querySelectorAll(".tablet-tab-panel").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.tabPanel !== tabId);
    });
  }

  refreshContractsPanel() {
    const panel = this.bodyElement.querySelector('[data-tab-panel="contracts"]');
    if (panel) panel.innerHTML = this.renderPanelContent("contracts");
  }

  refreshSupplyPanel() {
    const panel = this.bodyElement.querySelector('[data-tab-panel="supply"]');
    if (panel) panel.innerHTML = this.renderPanelContent("supply");
  }

  handleSignContract(licenseId) {
    const license = database.getLicense(licenseId);
    if (!license) return;
    if (this.playerState.activeLicenses.has(licenseId)) return; // already owned
    if (!license.isUnlocked(this.playerState)) return; // reputation requirement not met
    if (!license.canAfford(this.playerState)) return; // can't afford it

    this.playerState.spendCredits(license.baseCost);
    this.playerState.signLicense(licenseId);
    // Both of the above call notifyListeners(), which triggers refreshContractsPanel()
    // via the subscribe() in the constructor -- no explicit re-render needed here.
  }

  handleOrderRestock(itemId) {
    this.scene.orderRestockCrate(itemId);
    // orderRestockCrate() calls playerState.spendCredits() on success, which triggers
    // refreshSupplyPanel() via the subscribe() in the constructor -- but only on success;
    // explicitly refresh too so a no-op (e.g. clicked just as funds became insufficient)
    // doesn't leave a stale button state.
    this.refreshSupplyPanel();
  }

  openWindow() {
    this.uiWindow.openWindow();
  }
}
