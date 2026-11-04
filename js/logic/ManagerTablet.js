// ==========================================
// FILE: ManagerTablet.js
// ==========================================
import { UIWindow } from "./UIWindow.js";
import { InventoryRenderer } from "./InventoryRenderer.js";
import { ContractRenderer } from "./ContractRenderer.js";
import { SupplyRenderer } from "./SupplyRenderer.js";
import { LayoutRenderer } from "./LayoutRenderer.js";
import { FixtureHighlight } from "./FixtureHighlight.js";
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

const PRICE_INPUT_SELECTOR = "input[data-price-item-id]";
const PRICE_BUTTON_SELECTOR = "button[data-price-action]";
const PRICE_CONTROL_SELECTOR = `${PRICE_INPUT_SELECTOR}, ${PRICE_BUTTON_SELECTOR}`;

// The single unified Manager's Tablet window (bible Part 8), replacing the old
// standalone Inventory-only window. Owns tab-switching and the Contracts tab's
// buy/sign interaction; each tab's actual content still comes from its own renderer
// (InventoryRenderer, ContractRenderer, ...) -- this class only owns the shared chrome
// around them.
export class ManagerTablet {
  constructor(windowManager, playerState, scene) {
    this.playerState = playerState;
    this.scene = scene; // needed by the Supply tab to read/order fixture stock
    this.supplyOrder = new Map(); // item id -> crates in the order being built

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
    this.fixtureHighlight = new FixtureHighlight(scene, this.uiWindow);
    this.uiWindow.onClose = () => this.fixtureHighlight.reset();
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

      const addCrateButton = event.target.closest("[data-supply-add]");
      if (addCrateButton) this.changeSupplyOrder(addCrateButton.dataset.supplyAdd, 1);
      const removeCrateButton = event.target.closest("[data-supply-remove]");
      if (removeCrateButton) this.changeSupplyOrder(removeCrateButton.dataset.supplyRemove, -1);
      if (event.target.closest("[data-supply-clear]")) {
        this.supplyOrder.clear();
        this.refreshSupplyPanel();
      }
      if (event.target.closest("[data-supply-place]")) this.handlePlaceSupplyOrder();

      const moveButton = event.target.closest("[data-move-fixture-id]");
      if (moveButton) this.scene.fixturePlacement.begin(moveButton.dataset.moveFixtureId);

      const buyFixtureButton = event.target.closest("[data-buy-fixture-id]");
      if (buyFixtureButton && !this.scene.buyFixture(buyFixtureButton.dataset.buyFixtureId)) {
        this.scene.showShopMessage("Fixture purchase is unavailable. Check its license, cost, and requirements.");
      }

      const crateFixtureButton = event.target.closest("[data-crate-fixture-id]");
      if (crateFixtureButton) this.scene.crateFixture(crateFixtureButton.dataset.crateFixtureId);

      const priceButton = event.target.closest(PRICE_BUTTON_SELECTOR);
      if (priceButton) {
        this.handlePriceAdjustment(
          priceButton.dataset.priceItemId,
          priceButton.dataset.priceAction,
        );
      }
    });

    this.bodyElement.addEventListener("change", (event) => {
      const input = event.target.closest(PRICE_INPUT_SELECTOR);
      if (!input) return;
      const itemId = input.dataset.priceItemId;
      if (!this.scene.setStorePrice(itemId, Number(input.value))) {
        input.value = this.scene.getStorePrice(itemId);
      }
    });
    this.bodyElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches(PRICE_INPUT_SELECTOR)) event.target.blur();
    });
    // Price controls must not also drive the player or fire hotkeys (E, Space, I, P...).
    const keyboard = this.scene.input.keyboard;
    this.bodyElement.addEventListener("focusin", (event) => {
      if (!event.target.matches(PRICE_CONTROL_SELECTOR)) return;
      if (event.target.matches(PRICE_INPUT_SELECTOR)) this.editingPrice = true;
      keyboard.enabled = false;
      keyboard.disableGlobalCapture();
      keyboard.resetKeys();
    });
    this.bodyElement.addEventListener("focusout", (event) => {
      if (!event.target.matches(PRICE_CONTROL_SELECTOR)) return;
      if (event.target.matches(PRICE_INPUT_SELECTOR)) this.editingPrice = false;
      if (!event.relatedTarget?.matches?.(PRICE_CONTROL_SELECTOR)) {
        keyboard.enabled = true;
        keyboard.enableGlobalCapture();
      }
      // Keep the button in place until its click if focus moved there from an edited input.
      if (this.inventoryRefreshPending && !event.relatedTarget?.matches?.(PRICE_BUTTON_SELECTOR)) {
        setTimeout(() => this.refreshInventoryPanel());
      }
    });

    // Licenses can flip between locked/unaffordable/available purely because credits or
    // reputation changed elsewhere (a sale completing, reputation gained/lost) -- re-render
    // the Contracts panel on every state change so it never goes stale while the Tablet
    // happens to be open. (Fires once immediately on subscribe -- harmless, just an extra
    // render of a tiny list before the window is even shown.) The Supply tab's afford-
    // ability (and its "on shelf" counts, which change on every sale too) needs the exact
    // same live refresh, for the same reason. Inventory totals also refresh after stock
    // transfers, crate ordering/delivery, and customers taking shelf items.
    this.playerState.subscribe(() => {
      this.refreshInventoryPanel();
      this.refreshContractsPanel();
      this.refreshSupplyPanel();
      this.refreshLayoutPanels();
    });
  }

  renderPanelContent(tabId) {
    if (tabId === "inventory") return InventoryRenderer.generateHTML(this.scene.getInventoryItems());
    if (tabId === "contracts") {
      return ContractRenderer.generateHTML(database.getAllLicenses(), this.playerState);
    }
    if (tabId === "supply") return SupplyRenderer.generateHTML(this.scene, this.supplyOrder);
    if (tabId === "fixtures") return LayoutRenderer.generateHTML(this.scene, true);
    if (tabId === "layout") return LayoutRenderer.generateHTML(this.scene);
    return `<div class="tablet-placeholder">COMING SOON</div>`;
  }

  switchTab(tabId) {
    if (this.bodyElement.contains(document.activeElement)) document.activeElement.blur();
    this.fixtureHighlight.reset();
    if (tabId === "inventory") this.refreshInventoryPanel();
    if (tabId === "supply") this.refreshSupplyPanel();
    if (tabId === "layout" || tabId === "fixtures") this.refreshLayoutPanels();
    this.bodyElement.querySelectorAll(".tablet-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    });
    this.bodyElement.querySelectorAll(".tablet-tab-panel").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.tabPanel !== tabId);
    });
  }

  refreshInventoryPanel() {
    const panel = this.bodyElement.querySelector('[data-tab-panel="inventory"]');
    if (!panel) return;
    // Re-rendering would wipe a price the player is mid-way through typing.
    if (this.editingPrice) {
      this.inventoryRefreshPending = true;
      return;
    }
    this.inventoryRefreshPending = false;
    const activeElement = document.activeElement;
    const focusedButton = panel.contains(activeElement) && activeElement.matches(PRICE_BUTTON_SELECTOR)
      ? { itemId: activeElement.dataset.priceItemId, action: activeElement.dataset.priceAction }
      : null;
    const selectedItemId = panel.querySelector(".item-card.selected")?.dataset.itemId;
    const scrollTop = panel.querySelector(".inventory-list").scrollTop;
    this.disableInventoryNavigation();
    panel.innerHTML = this.renderPanelContent("inventory");
    this.disableInventoryNavigation = InventoryRenderer.enableListNavigation(
      this.uiWindow.element,
      selectedItemId,
    );
    panel.querySelector(".inventory-list").scrollTop = scrollTop;
    if (focusedButton) {
      const replacement = Array.from(panel.querySelectorAll(PRICE_BUTTON_SELECTOR)).find(
        (button) =>
          button.dataset.priceItemId === focusedButton.itemId &&
          button.dataset.priceAction === focusedButton.action,
      );
      replacement?.focus({ preventScroll: true });
    }
  }

  refreshContractsPanel() {
    const panel = this.bodyElement.querySelector('[data-tab-panel="contracts"]');
    if (panel) panel.innerHTML = this.renderPanelContent("contracts");
  }

  refreshSupplyPanel() {
    const panel = this.bodyElement.querySelector('[data-tab-panel="supply"]');
    if (!panel) return;
    const scrollTop = panel.querySelector(".supply-list").scrollTop;
    panel.innerHTML = this.renderPanelContent("supply");
    panel.querySelector(".supply-list").scrollTop = scrollTop;
  }

  refreshLayoutPanels() {
    for (const id of ["layout", "fixtures"]) {
      const panel = this.bodyElement.querySelector(`[data-tab-panel="${id}"]`);
      if (panel) panel.innerHTML = this.renderPanelContent(id);
    }
    this.updateSaveStatus();
  }

  updateSaveStatus() {
    this.bodyElement.querySelectorAll("[data-save-status]").forEach((element) => {
      element.textContent = this.scene.saveStatus;
    });
  }

  handlePriceAdjustment(itemId, action) {
    const currentPrice = this.scene.getStorePrice(itemId);
    const marketPrice = this.scene.market.getPrice(itemId);
    const nextPrice =
      action === "decrease"
        ? Math.max(1, Math.min(currentPrice - 1, Math.round(currentPrice * 0.9)))
        : action === "increase"
          ? Math.max(currentPrice + 1, Math.round(currentPrice * 1.1))
          : action === "market"
            ? marketPrice
            : null;
    if (nextPrice !== null) this.scene.setStorePrice(itemId, nextPrice);
  }

  handleSignContract(licenseId) {
    const license = database.getLicense(licenseId);
    if (!license) return;
    if (this.playerState.activeLicenses.has(licenseId)) return; // already owned
    if (!license.isUnlocked(this.playerState)) return; // reputation requirement not met
    if (!license.canAfford(this.playerState)) return; // can't afford it

    this.playerState.spendCredits(license.baseCost);
    this.playerState.signLicense(licenseId);
    this.scene.recalculateActiveFactions();
    // Both of the above call notifyListeners(), which triggers refreshContractsPanel()
    // via the subscribe() in the constructor -- no explicit re-render needed here.
  }

  changeSupplyOrder(itemId, delta) {
    const count = (this.supplyOrder.get(itemId) || 0) + delta;
    const summary = this.scene.getSupplyOrderSummary(this.supplyOrder);
    if (delta > 0 && summary.crates >= summary.maxCrates) return;
    if (count > 0) this.supplyOrder.set(itemId, count);
    else this.supplyOrder.delete(itemId);
    this.refreshSupplyPanel();
  }

  handlePlaceSupplyOrder() {
    // Why an order can't be placed is already shown in the summary, so no popup here.
    if (this.scene.placeSupplyOrder(this.supplyOrder)) this.supplyOrder.clear();
    this.refreshSupplyPanel();
  }

  openWindow() {
    if (this.scene.startingShift || this.scene.fixturePlacement?.active || this.scene.loadFailed) return;
    this.refreshInventoryPanel();
    this.refreshSupplyPanel(); // loading pad spots free up without any playerState change
    this.refreshLayoutPanels();
    this.uiWindow.openWindow();
  }
}
