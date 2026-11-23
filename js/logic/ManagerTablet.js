// ==========================================
// FILE: ManagerTablet.js
// ==========================================
// The Manager's Tablet window (bible Part 8): tab chrome and shared routing for tablet actions.

import { UIWindow } from "./UIWindow.js";
import { DESIGN_HEIGHT, DESIGN_WIDTH } from "./GameViewport.js";
import { InventoryTab, INVENTORY_PRICE_CONTROL_SELECTOR } from "./InventoryTab.js";
import { EmployeeTab, EMPLOYEE_PRIORITY_SELECTOR, EMPLOYEE_TRAINING_SELECTOR } from "./EmployeeTab.js";
import { ContractsTab } from "./ContractsTab.js";
import { SupplyTab } from "./SupplyTab.js";
import { FixturesTab } from "./FixturesTab.js";
import { LayoutTab } from "./LayoutTab.js";
import { FinancesTab } from "./FinancesTab.js";
import { HandbookTab } from "./HandbookTab.js";
import { FixtureHighlight } from "./FixtureHighlight.js";
import { GAME_EVENTS } from "../core/Events.js";
import { getFixtureResaleValue, getFixtureType } from "./FixtureLayout.js";
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

// The bible's full Step 40 tab list (Part 8).
export const TAB_DEFS = [
  { id: "inventory", label: "Inventory" },
  { id: "employee", label: "Employee" },
  { id: "contracts", label: "Contracts" },
  { id: "supply", label: "Supply" },
  { id: "fixtures", label: "Fixtures" },
  { id: "layout", label: "Layout" },
  { id: "finances", label: "Finances" },
  { id: "handbook", label: "Handbook" },
];

// Extra tabs that only appear in the DEV UI Lab.
export const UI_LAB_TAB_DEFS = [{ id: "textStyles", label: "Text Styles" }];

/** @param {Phaser.Scene} scene @returns {{id: string, label: string}[]} */
export function getTabDefs(scene) {
  return scene?.lab === "ui" ? [...TAB_DEFS, ...UI_LAB_TAB_DEFS] : TAB_DEFS;
}

function renderTextStylesPage() {
  return `
    <div class="type-styles-page">
      <h1 class="type-h1">H1 - Manager's Tablet</h1>
      <h2 class="type-h2">H2 - Weekly Supply Order</h2>
      <h3 class="type-h3">H3 - Laser Pistols</h3>
      <p class="type-subheading">Subheading - Delivered tomorrow morning</p>
      <p class="type-description">Description - Crates arrive at the back door at the start of the next day. Unpack them onto shelves before customers come looking.</p>
            <p class="type-subheading">Thin divider</p>
            <hr class="divider-thin">
            <p class="type-subheading">Medium divider</p>
            <hr class="divider-medium">
            <p class="type-subheading">Thick divider</p>
            <hr class="divider-thick">
    </div>
  `;
}

const TABLET_KEYBOARD_CONTROL_SELECTOR =
  `${INVENTORY_PRICE_CONTROL_SELECTOR}, ${EMPLOYEE_PRIORITY_SELECTOR}, ${EMPLOYEE_TRAINING_SELECTOR}`;

/**
 * The single Tablet window; owns tab switching and refreshes panels when game state changes.
 */
export class ManagerTablet {
  constructor(windowManager, gameState, scene) {
    this.gameState = gameState;
    this.scene = scene;
    this.inventoryTab = new InventoryTab(scene);
    this.employeeTab = new EmployeeTab(scene, gameState);
    this.contractsTab = new ContractsTab(
      gameState,
      () => database.getAllLicenses(),
      (licenseId) => this.handleSignContract(licenseId),
    );
    this.supplyTab = new SupplyTab(scene);
    this.fixturesTab = new FixturesTab(scene);
    this.layoutTab = new LayoutTab(scene);
    this.financesTab = new FinancesTab(scene);
    this.handbookTab = new HandbookTab(gameState, () => database.getAllLicenses());

    const tabDefs = getTabDefs(scene);
    const tabBarHTML = tabDefs.map(
      ({ id, label }, index) =>
        `<button class="retro-tab-btn tablet-tab-btn${index === 0 ? " active" : ""}" data-tab="${id}">${label}</button>`,
    ).join("");

    const panelsHTML = tabDefs.map(({ id }, index) => {
      const hiddenClass = index === 0 ? "" : " hidden";
      return `<div class="tablet-tab-panel${hiddenClass}" data-tab-panel="${id}">${this.renderPanelContent(id)}</div>`;
    }).join("");

    // 85% of the screen height, keeping the tablet's classic shape, centered both ways.
    const tabletHeight = Math.round(DESIGN_HEIGHT * 0.85);
    const tabletWidth = Math.round(tabletHeight * (768 / 648));
    this.uiWindow = new UIWindow(
      {
        id: "manager-tablet",
        title: "MANAGER'S TABLET",
        contentHTML: `
          <div class="tablet-tab-bar">${tabBarHTML}</div>
          <div class="tablet-tab-content">${panelsHTML}</div>
        `,
        width: `${tabletWidth}px`,
        height: `${tabletHeight}px`,
        x: Math.round((DESIGN_WIDTH - tabletWidth) / 2),
        y: Math.round((DESIGN_HEIGHT - tabletHeight) / 2),
      },
      windowManager,
    );

    this.bodyElement = this.uiWindow.element.querySelector(".retro-window-body");
    this.inventoryTab.bind(
      this.bodyElement.querySelector('[data-tab-panel="inventory"]'),
      this.uiWindow.element,
      this.bodyElement,
      () => this.renderPanelContent("inventory"),
    );
    this.employeeTab.bind(
      this.bodyElement.querySelector('[data-tab-panel="employee"]'),
      this.bodyElement,
      () => this.renderPanelContent("employee"),
    );
    this.contractsTab.bind(
      this.bodyElement.querySelector('[data-tab-panel="contracts"]'),
      this.bodyElement,
      () => this.renderPanelContent("contracts"),
    );
    this.supplyTab.bind(
      this.bodyElement.querySelector('[data-tab-panel="supply"]'),
      () => this.renderPanelContent("supply"),
    );
    this.fixturesTab.bind(
      this.bodyElement.querySelector('[data-tab-panel="fixtures"]'),
      this.bodyElement,
      () => this.renderPanelContent("fixtures"),
      {
        buyFixture: (typeId) => this.handleFixturePurchase(typeId),
        moveFixture: (fixtureId) => this.scene.fixturePlacement.begin(fixtureId),
        crateFixture: (fixtureId) => this.scene.fixtureSystem.crate(fixtureId),
        sellFixture: (fixtureId) =>
          this.prepareFixtureSale("placed", this.scene.fixtures.get(fixtureId)),
        sellFixtureCrate: (key) => {
          const crate = key === "carried"
            ? this.scene.carriedCrate
            : this.scene.restockCrates[Number(key)];
          this.prepareFixtureSale("crate", crate);
        },
        confirmSale: () => this.confirmFixtureSale(),
        cancelSale: () => {
          this.fixturesTab.saleConfirmation = null;
          this.refreshLayoutPanels();
        },
      },
    );
    this.layoutTab.bind(
      this.bodyElement.querySelector('[data-tab-panel="layout"]'),
      this.bodyElement,
      () => this.renderPanelContent("layout"),
      {
        buyExpansion: (expansionId) => this.scene.fixtureSystem.buyExpansion(expansionId),
        buyBackroomUpgrade: (upgradeId) => this.scene.fixtureSystem.buyBackroomUpgrade(upgradeId),
        buyHovercart: () => this.scene.gameModules.get("hovercart")?.buy(),
      },
    );
    this.financesTab.bind(
      this.bodyElement.querySelector('[data-tab-panel="finances"]'),
      this.bodyElement,
      () => this.renderPanelContent("finances"),
      {
        selectDay: (value) => {
          this.financesTab.selectedDay = value === "today" ? null : Number(value);
          this.financesTab.redraw();
        },
        endDay: () => {
          if (this.scene.shift.endDay()) this.uiWindow.close();
        },
        startShift: () => this.scene.shift.start(),
        takeLoan: () => this.scene.shift.takeLoan(),
        payOffLoan: () => this.scene.shift.payOffLoan(),
      },
    );
    this.handbookTab.bind(
      this.bodyElement.querySelector('[data-tab-panel="handbook"]'),
      this.bodyElement,
      () => this.renderPanelContent("handbook"),
    );
    this.fixtureHighlight = new FixtureHighlight(scene, this.uiWindow);
    this.uiWindow.onClose = () => {
      this.fixturesTab.purchaseNotice = "";
      this.fixturesTab.saleConfirmation = null;
      this.fixtureHighlight.reset();
      this.scene.checkoutSystem.resumeRegisterCheckout();
    };
    this.bodyElement.querySelector(".tablet-tab-bar").addEventListener("click", (event) => {
      const button = event.target.closest("[data-tab]");
      if (button) this.switchTab(button.dataset.tab);
    });

    // Focused controls must not also drive the player or fire game hotkeys.
    const keyboard = this.scene.input.keyboard;
    this.bodyElement.addEventListener("focusin", (event) => {
      if (!event.target.matches(TABLET_KEYBOARD_CONTROL_SELECTOR)) return;
      keyboard.enabled = false;
      keyboard.disableGlobalCapture();
      keyboard.resetKeys();
    });
    this.bodyElement.addEventListener("focusout", (event) => {
      if (!event.target.matches(TABLET_KEYBOARD_CONTROL_SELECTOR)) return;
      if (!event.relatedTarget?.matches?.(TABLET_KEYBOARD_CONTROL_SELECTOR)) {
        keyboard.enabled = true;
        keyboard.enableGlobalCapture();
      }
    });

    // License availability, supply affordability, shelf counts, and inventory totals all
    // change elsewhere (sales, deliveries, reputation), so re-render on every state change.
    this.gameState.subscribe(() => {
      this.inventoryTab.redraw();
      this.employeeTab.redraw();
      this.contractsTab.redraw();
      this.refreshSupplyPanel();
      this.refreshLayoutPanels();
      this.refreshFinancesPanel();
    });
    this.scene.eventBus.on(GAME_EVENTS.INVENTORY_TRANSFERRED, ({ destination }) => {
      if (destination === "customer-cart") this.inventoryTab.redraw();
    });
    this.scene.eventBus.on(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, () => {
      this.inventoryTab.redraw();
    });
  }

  // --- Tabs and panel rendering ---

  /**
   * @param {string} tabId - a TAB_DEFS id
   * @returns {string} the tab's page title followed by its body
   */
  renderPanelContent(tabId) {
    const { label } = getTabDefs(this.scene).find((tab) => tab.id === tabId);
    return `<h1 class="type-h1 tablet-page-title">${label}</h1>${this.renderPanelBody(tabId)}`;
  }

  /**
   * @param {string} tabId - a TAB_DEFS id
   * @returns {string} panel body HTML
   */
  renderPanelBody(tabId) {
    if (tabId === "inventory") return this.inventoryTab.draw();
    if (tabId === "employee") return this.employeeTab.draw();
    if (tabId === "contracts") return this.contractsTab.draw();
    if (tabId === "supply") return this.supplyTab.draw();
    if (tabId === "fixtures") return this.fixturesTab.draw();
    if (tabId === "layout") return this.layoutTab.draw();
    if (tabId === "finances") return this.financesTab.draw();
    if (tabId === "handbook") return this.handbookTab.draw();
    if (tabId === "textStyles") return renderTextStylesPage();
    throw new Error(`Unknown tablet tab: ${tabId}`);
  }

  switchTab(tabId) {
    if (this.bodyElement.contains(document.activeElement)) document.activeElement.blur();
    this.fixtureHighlight.reset();
    this.fixturesTab.purchaseNotice = "";
    this.fixturesTab.saleConfirmation = null;
    if (tabId === "inventory") this.inventoryTab.redraw();
    if (tabId === "employee") this.employeeTab.redraw();
    if (tabId === "contracts") this.contractsTab.redraw();
    if (tabId === "supply") this.refreshSupplyPanel();
    if (tabId === "layout" || tabId === "fixtures") this.refreshLayoutPanels();
    if (tabId === "finances") this.refreshFinancesPanel();
    if (tabId === "handbook") this.refreshHandbookPanel();
    this.bodyElement.querySelectorAll(".tablet-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    });
    this.bodyElement.querySelectorAll(".tablet-tab-panel").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.tabPanel !== tabId);
    });
  }

  openForItem(itemId) {
    if (!database.getItem(itemId)) throw new Error(`Unknown inventory item: ${itemId}`);
    this.openWindow();
    this.switchTab("inventory");
    this.inventoryTab.focusItem(itemId);
  }

  refreshContractsPanel() {
    this.contractsTab.redraw();
  }

  refreshEmployeePanel() {
    this.employeeTab.redraw();
  }

  refreshFinancesPanel() {
    this.financesTab.redraw();
  }

  refreshHandbookPanel() {
    this.handbookTab.redraw();
  }

  refreshSupplyPanel() {
    this.supplyTab.redraw();
  }

  refreshLayoutPanels() {
    this.layoutTab.redraw();
    this.fixturesTab.redraw();
    this.updateSaveStatus();
  }

  updateSaveStatus() {
    this.bodyElement.querySelectorAll("[data-save-status]").forEach((element) => {
      element.textContent = this.scene.saves.status;
    });
  }

  prepareFixtureSale(kind, target) {
    const reason = kind === "placed"
      ? this.scene.fixtureSystem.saleBlockReason(target)
      : this.scene.fixtureSystem.crateSaleBlockReason(target);
    if (reason) {
      this.scene.messages.show(reason);
      return;
    }
    const typeId = kind === "placed" ? target.type : target.typeId;
    this.fixturesTab.purchaseNotice = "";
    this.fixturesTab.saleConfirmation = {
      kind,
      target,
      name: kind === "placed"
        ? this.scene.fixtures.displayName(target)
        : `${getFixtureType(typeId).name} crate`,
      value: getFixtureResaleValue(typeId),
    };
    this.refreshLayoutPanels();
  }

  confirmFixtureSale() {
    const sale = this.fixturesTab.saleConfirmation;
    if (!sale) {
      this.scene.messages.show("Choose a fixture to sell first.");
      return;
    }
    this.fixturesTab.saleConfirmation = null;
    if (sale.kind === "placed" && this.scene.fixtures.get(sale.target.id) !== sale.target) {
      this.scene.messages.show("That fixture is no longer available.");
      this.refreshLayoutPanels();
      return;
    }
    this.fixturesTab.purchaseNotice = `Sold ${sale.name} for ${sale.value.toLocaleString()}.`;
    this.fixtureHighlight.reset();
    const sold = sale.kind === "placed"
      ? this.scene.fixtureSystem.sell(sale.target.id)
      : this.scene.fixtureSystem.sellCrate(sale.target);
    if (!sold) {
      this.fixturesTab.purchaseNotice = "";
      this.refreshLayoutPanels();
    }
  }

  handleFixturePurchase(typeId) {
    const name = getFixtureType(typeId)?.name ?? "Fixture";
    this.fixturesTab.purchaseNotice = `Bought ${name}. Its crate is waiting on the Loading Pad.`;
    if (!this.scene.fixtureSystem.buy(typeId)) {
      this.fixturesTab.purchaseNotice = "";
      this.scene.messages.show("Fixture purchase is unavailable. Check its license, cost, and requirements.");
    }
  }

  // --- Contracts and shared tablet actions ---

  handleSignContract(licenseId) {
    const license = database.getLicense(licenseId);
    if (!license) throw new Error(`Unknown supplier license: ${licenseId}.`);
    if (this.gameState.catalog.owns(licenseId)) return; // already owned
    if (!license.isUnlocked(this.gameState)) {
      this.scene.messages.show("This contract is locked. Check its requirements in the Contracts tab.");
      return;
    }
    if (!license.canAfford(this.gameState)) return; // can't afford it

    this.gameState.economy.spend(license.baseCost, { category: "licenses", label: license.name });
    this.gameState.catalog.sign(licenseId);
    this.scene.catalogSystem.recalculateActiveFactions();
    // The panel re-renders via the constructor's game state subscription.
  }

  // --- Window ---

  openWindow() {
    if (this.scene.shift.starting || this.scene.fixturePlacement?.active || this.scene.saves.loadFailed) return;
    this.inventoryTab.redraw();
    this.refreshEmployeePanel();
    this.refreshSupplyPanel(); // loading pad spots free up without any game state change
    this.refreshLayoutPanels();
    this.refreshFinancesPanel();
    this.uiWindow.openWindow();
    this.scene.checkoutWindow.suspend();
  }
}
