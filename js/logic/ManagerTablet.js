// ==========================================
// FILE: ManagerTablet.js
// ==========================================
// The Manager's Tablet window (bible Part 8): tab chrome plus the Contracts, Supply,
// Fixtures/Layout, and price-editing interactions. Each tab's HTML comes from its renderer.

import { UIWindow } from "./UIWindow.js";
import { InventoryRenderer } from "./InventoryRenderer.js";
import { ContractRenderer } from "./ContractRenderer.js";
import { SupplyRenderer } from "./SupplyRenderer.js";
import { LayoutRenderer } from "./LayoutRenderer.js";
import { EquipmentRenderer } from "./EquipmentRenderer.js";
import { EmployeeRenderer } from "./EmployeeRenderer.js";
import { FinancesRenderer } from "./FinancesRenderer.js";
import { HandbookRenderer } from "./HandbookRenderer.js";
import { FixtureHighlight } from "./FixtureHighlight.js";
import { playErrorBuzz } from "./Sfx.js";
import { GAME_EVENTS } from "./EventBus.js";
import { formatMoney, roundMoney } from "./Money.js";
import { getNextHovercartUpgrade } from "./Hovercart.js";
import { getFixtureResaleValue, getFixtureType } from "./FixtureLayout.js";
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

// The bible's full Step 40 tab list (Part 8).
const TAB_DEFS = [
  { id: "inventory", label: "Inventory" },
  { id: "employee", label: "Employee" },
  { id: "contracts", label: "Contracts" },
  { id: "supply", label: "Supply" },
  { id: "fixtures", label: "Fixtures" },
  { id: "equipment", label: "Equipment" },
  { id: "layout", label: "Layout" },
  { id: "finances", label: "Finances" },
  { id: "handbook", label: "Handbook" },
];

const PRICE_INPUT_SELECTOR = "input[data-price-item-id]";
const PRICE_BUTTON_SELECTOR = "button[data-price-action]";
const PRICE_CONTROL_SELECTOR = `${PRICE_INPUT_SELECTOR}, ${PRICE_BUTTON_SELECTOR}`;

/**
 * The single Tablet window; owns tab switching, the supply order being built, and
 * live re-rendering of panels whenever playerState changes.
 */
export class ManagerTablet {
  constructor(windowManager, playerState, scene) {
    this.playerState = playerState;
    this.scene = scene; // needed by the Supply tab to read/order fixture stock
    this.supplyOrder = new Map(); // item id -> crates in the order being built
    this.fixturePurchaseNotice = "";
    this.fixtureSaleConfirmation = null;
    this.equipmentPurchaseNotice = "";
    this.handbookTopic = "store";
    this.employeeFireConfirmationId = null;
    this.employeeTrainingConfirmation = null;

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
    this.uiWindow.onClose = () => {
      this.fixturePurchaseNotice = "";
      this.fixtureSaleConfirmation = null;
      this.equipmentPurchaseNotice = "";
      this.employeeFireConfirmationId = null;
      this.employeeTrainingConfirmation = null;
      this.fixtureHighlight.reset();
      this.scene.resumeRegisterCheckout();
    };
    this.disableInventoryNavigation = InventoryRenderer.enableListNavigation(
      this.uiWindow.element,
    );

    this.bodyElement.querySelector(".tablet-tab-bar").addEventListener("click", (event) => {
      const button = event.target.closest("[data-tab]");
      if (button) this.switchTab(button.dataset.tab);
    });

    // Delegated, since panel innerHTML is fully replaced on every playerState change.
    this.bodyElement.addEventListener("click", (event) => {
      const handbookTopicButton = event.target.closest("[data-handbook-topic]");
      if (handbookTopicButton) {
        this.handbookTopic = handbookTopicButton.dataset.handbookTopic;
        this.refreshHandbookPanel();
      }

      const signButton = event.target.closest("[data-license-id]");
      if (signButton) this.handleSignContract(signButton.dataset.licenseId);

      const hireEmployeeButton = event.target.closest("[data-hire-employee-id]");
      if (hireEmployeeButton) {
        this.scene.hireEmployee(hireEmployeeButton.dataset.hireEmployeeId);
      }

      const fireEmployeeButton = event.target.closest("[data-fire-employee-id]");
      if (fireEmployeeButton) {
        this.employeeFireConfirmationId = fireEmployeeButton.dataset.fireEmployeeId;
        this.employeeTrainingConfirmation = null;
        this.refreshEmployeePanel();
      }
      const confirmFireEmployeeButton = event.target.closest("[data-confirm-fire-employee]");
      if (confirmFireEmployeeButton) {
        this.scene.fireEmployee(confirmFireEmployeeButton.dataset.confirmFireEmployee);
        this.employeeFireConfirmationId = null;
        this.refreshEmployeePanel();
      }
      if (event.target.closest("[data-cancel-fire-employee]")) {
        this.employeeFireConfirmationId = null;
        this.refreshEmployeePanel();
      }

      const trainEmployeeButton = event.target.closest("[data-train-employee-id]");
      if (trainEmployeeButton) {
        const employeeId = trainEmployeeButton.dataset.trainEmployeeId;
        const jobId = trainEmployeeButton.dataset.trainEmployeeJob;
        const reason = this.scene.getEmployeeTrainingBlockReason(employeeId, jobId);
        if (reason) this.scene.showShopMessage(reason);
        else {
          this.employeeFireConfirmationId = null;
          this.employeeTrainingConfirmation = { employeeId, jobId };
          this.refreshEmployeePanel();
          this.bodyElement.querySelector(".employee-training-confirmation")?.scrollIntoView({ block: "nearest" });
        }
      }
      if (event.target.closest("[data-confirm-employee-training]")) {
        const training = this.employeeTrainingConfirmation;
        this.employeeTrainingConfirmation = null;
        if (training) this.scene.trainEmployee(training.employeeId, training.jobId);
        else this.scene.showShopMessage("Choose an employee skill to train first.");
        this.refreshEmployeePanel();
      }
      if (event.target.closest("[data-cancel-employee-training]")) {
        this.employeeTrainingConfirmation = null;
        this.refreshEmployeePanel();
      }

      if (event.target.closest("[data-end-day]") && this.scene.endDay()) this.uiWindow.close();
      if (event.target.closest("[data-finances-start-shift]")) this.scene.startNextShift();
      if (event.target.closest("[data-take-emergency-loan]")) this.scene.takeEmergencyLoan();
      if (event.target.closest("[data-pay-off-emergency-loan]")) this.scene.payOffEmergencyLoan();

      const priorityButton = event.target.closest("[data-employee-priority-id]");
      if (priorityButton) {
        this.scene.moveEmployeeJobPriority(
          priorityButton.dataset.employeePriorityId,
          priorityButton.dataset.employeePriorityJob,
          Number(priorityButton.dataset.employeePriorityDirection),
        );
      }

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
      if (buyFixtureButton) {
        const typeId = buyFixtureButton.dataset.buyFixtureId;
        const name = getFixtureType(typeId)?.name ?? "Fixture";
        // Set before buying: the purchase re-renders this tab through the state listener.
        this.fixturePurchaseNotice = `Bought ${name}. Its crate is waiting on the Loading Pad.`;
        if (!this.scene.buyFixture(typeId)) {
          this.fixturePurchaseNotice = "";
          this.scene.showShopMessage("Fixture purchase is unavailable. Check its license, cost, and requirements.");
        }
      }

      const buyExpansionButton = event.target.closest("[data-buy-expansion-id]");
      if (buyExpansionButton) this.scene.buyExpansion(buyExpansionButton.dataset.buyExpansionId);

      const buyBackroomButton = event.target.closest("[data-buy-backroom-id]");
      if (buyBackroomButton) this.scene.buyBackroomUpgrade(buyBackroomButton.dataset.buyBackroomId);

      const crateFixtureButton = event.target.closest("[data-crate-fixture-id]");
      if (crateFixtureButton) this.scene.crateFixture(crateFixtureButton.dataset.crateFixtureId);

      const sellFixtureButton = event.target.closest("[data-sell-fixture-id]");
      if (sellFixtureButton) {
        this.prepareFixtureSale("placed", this.scene.fixtures.get(sellFixtureButton.dataset.sellFixtureId));
      }

      const sellCrateButton = event.target.closest("[data-sell-fixture-crate]");
      if (sellCrateButton) {
        const key = sellCrateButton.dataset.sellFixtureCrate;
        const crate = key === "carried" ? this.scene.carriedCrate : this.scene.restockCrates[Number(key)];
        this.prepareFixtureSale("crate", crate);
      }
      if (event.target.closest("[data-confirm-fixture-sale]")) this.confirmFixtureSale();
      if (event.target.closest("[data-cancel-fixture-sale]")) {
        this.fixtureSaleConfirmation = null;
        this.refreshLayoutPanels();
      }

      if (event.target.closest("[data-upgrade-hovercart]")) {
        const upgrade = getNextHovercartUpgrade(this.playerState.hovercart.capacity);
        this.equipmentPurchaseNotice = upgrade
          ? `Hovercart upgraded to ${upgrade.capacity} spaces.`
          : "";
        if (!this.playerState.upgradeHovercart()) {
          this.equipmentPurchaseNotice = "";
          this.scene.showShopMessage(!upgrade
            ? "Your hovercart is already at its maximum capacity."
            : this.playerState.shopLevel < upgrade.requiredShopLevel
              ? `Reach Shop Level ${upgrade.requiredShopLevel} to buy the ${upgrade.capacity}-space hovercart upgrade.`
              : `Not enough credits. This upgrade costs ${formatMoney(upgrade.price)}.`);
          this.refreshEquipmentPanel();
        }
      }

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

    // License availability, supply affordability, shelf counts, and inventory totals all
    // change elsewhere (sales, deliveries, reputation), so re-render on every state change.
    this.playerState.subscribe(() => {
      this.refreshInventoryPanel();
      this.refreshEmployeePanel();
      this.refreshContractsPanel();
      this.refreshSupplyPanel();
      this.refreshLayoutPanels();
      this.refreshEquipmentPanel();
      this.refreshFinancesPanel();
    });
    this.scene.eventBus.on(GAME_EVENTS.INVENTORY_TRANSFERRED, ({ destination }) => {
      if (destination === "customer-cart") this.refreshInventoryPanel();
    });
    this.scene.eventBus.on(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, () => {
      this.refreshInventoryPanel();
    });
  }

  // --- Tabs and panel rendering ---

  /**
   * @param {string} tabId - a TAB_DEFS id
   * @returns {string} panel HTML, or a placeholder for unbuilt tabs
   */
  renderPanelContent(tabId) {
    if (tabId === "inventory") return InventoryRenderer.generateHTML(this.scene.getInventoryItems());
    if (tabId === "employee") {
      return EmployeeRenderer.generateHTML({
        hiredEmployeeIds: this.playerState.hiredEmployees,
        activeEmployeeIds: this.scene.employees.map((employee) => employee.data.id),
        employeeJobPriorities: this.playerState.employeeJobPriorities,
        credits: this.playerState.credits,
        canHire: this.scene.canHireEmployees(),
        canFire: this.scene.canHireEmployees(),
        fireConfirmationEmployeeId: this.employeeFireConfirmationId,
        employeeSkills: this.playerState.employeeSkills,
        employeeTraining: this.playerState.employeeTraining,
        trainingConfirmation: this.employeeTrainingConfirmation,
        shopLevel: this.playerState.shopLevel,
      });
    }
    if (tabId === "contracts") {
      return ContractRenderer.generateHTML(database.getAllLicenses(), this.playerState);
    }
    if (tabId === "supply") return SupplyRenderer.generateHTML(this.scene, this.supplyOrder);
    if (tabId === "fixtures") {
      return LayoutRenderer.generateHTML(
        this.scene, true, this.fixturePurchaseNotice, this.fixtureSaleConfirmation,
      );
    }
    if (tabId === "equipment") return EquipmentRenderer.generateHTML(this.playerState, this.equipmentPurchaseNotice);
    if (tabId === "layout") return LayoutRenderer.generateHTML(this.scene);
    if (tabId === "finances") return FinancesRenderer.generateHTML(this.scene.getFinancesView());
    if (tabId === "handbook") {
      return HandbookRenderer.generateHTML({
        topic: this.handbookTopic,
        shopLevel: this.playerState.shopLevel,
        reputation: this.playerState.globalReputation,
        licenses: database.getAllLicenses(),
      });
    }
    throw new Error(`Unknown tablet tab: ${tabId}`);
  }

  switchTab(tabId) {
    if (this.bodyElement.contains(document.activeElement)) document.activeElement.blur();
    this.fixtureHighlight.reset();
    this.fixturePurchaseNotice = "";
    this.fixtureSaleConfirmation = null;
    this.equipmentPurchaseNotice = "";
    this.employeeFireConfirmationId = null;
    this.employeeTrainingConfirmation = null;
    if (tabId === "inventory") this.refreshInventoryPanel();
    if (tabId === "employee") this.refreshEmployeePanel();
    if (tabId === "supply") this.refreshSupplyPanel();
    if (tabId === "layout" || tabId === "fixtures") this.refreshLayoutPanels();
    if (tabId === "equipment") this.refreshEquipmentPanel();
    if (tabId === "finances") this.refreshFinancesPanel();
    if (tabId === "handbook") this.refreshHandbookPanel();
    this.bodyElement.querySelectorAll(".tablet-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    });
    this.bodyElement.querySelectorAll(".tablet-tab-panel").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.tabPanel !== tabId);
    });
  }

  // Re-renders while preserving selection, scroll, and focus on a price button.
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

  refreshEmployeePanel() {
    const panel = this.bodyElement.querySelector('[data-tab-panel="employee"]');
    if (!panel) return;
    const scrollTop = panel.querySelector(".employee-panel")?.scrollTop ?? 0;
    panel.innerHTML = this.renderPanelContent("employee");
    panel.querySelector(".employee-panel").scrollTop = scrollTop;
  }

  refreshEquipmentPanel() {
    const panel = this.bodyElement.querySelector('[data-tab-panel="equipment"]');
    if (panel) panel.innerHTML = this.renderPanelContent("equipment");
  }

  refreshFinancesPanel() {
    const panel = this.bodyElement.querySelector('[data-tab-panel="finances"]');
    if (panel) panel.innerHTML = this.renderPanelContent("finances");
  }

  refreshHandbookPanel() {
    const panel = this.bodyElement.querySelector('[data-tab-panel="handbook"]');
    if (panel) panel.innerHTML = this.renderPanelContent("handbook");
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
      if (!panel) continue;
      const positions = [".fixture-management-scroll", ".layout-fixture-list"].map((selector) => ({
        selector,
        top: panel.querySelector(selector)?.scrollTop ?? 0,
      }));
      panel.innerHTML = this.renderPanelContent(id);
      for (const { selector, top } of positions) {
        const list = panel.querySelector(selector);
        if (list) list.scrollTop = top;
      }
    }
    this.updateSaveStatus();
  }

  updateSaveStatus() {
    this.bodyElement.querySelectorAll("[data-save-status]").forEach((element) => {
      element.textContent = this.scene.saveStatus;
    });
  }

  prepareFixtureSale(kind, target) {
    const reason = kind === "placed"
      ? this.scene.getFixtureSaleBlockReason(target)
      : this.scene.getFixtureCrateSaleBlockReason(target);
    if (reason) {
      this.scene.showShopMessage(reason);
      return;
    }
    const typeId = kind === "placed" ? target.type : target.typeId;
    this.fixturePurchaseNotice = "";
    this.fixtureSaleConfirmation = {
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
    const sale = this.fixtureSaleConfirmation;
    if (!sale) {
      this.scene.showShopMessage("Choose a fixture to sell first.");
      return;
    }
    this.fixtureSaleConfirmation = null;
    if (sale.kind === "placed" && this.scene.fixtures.get(sale.target.id) !== sale.target) {
      this.scene.showShopMessage("That fixture is no longer available.");
      this.refreshLayoutPanels();
      return;
    }
    this.fixturePurchaseNotice = `Sold ${sale.name} for ${formatMoney(sale.value)}.`;
    this.fixtureHighlight.reset();
    const sold = sale.kind === "placed"
      ? this.scene.sellFixture(sale.target.id)
      : this.scene.sellFixtureCrate(sale.target);
    if (!sold) {
      this.fixturePurchaseNotice = "";
      this.refreshLayoutPanels();
    }
  }

  // --- Prices, contracts, and supply orders ---

  /**
   * Step a store price: roughly ±10% (at least 1 credit), or reset to market.
   * @param {string} itemId
   * @param {"decrease" | "increase" | "market"} action
   */
  handlePriceAdjustment(itemId, action) {
    const currentPrice = this.scene.getStorePrice(itemId);
    const marketPrice = this.scene.market.getPrice(itemId);
    const nextPrice =
      action === "decrease"
        ? Math.max(1, Math.min(roundMoney(currentPrice - 1), roundMoney(currentPrice * 0.9)))
        : action === "increase"
          ? Math.max(roundMoney(currentPrice + 1), roundMoney(currentPrice * 1.1))
          : action === "market"
            ? marketPrice
            : null;
    if (nextPrice !== null) this.scene.setStorePrice(itemId, nextPrice);
  }

  handleSignContract(licenseId) {
    const license = database.getLicense(licenseId);
    if (!license) throw new Error(`Unknown supplier license: ${licenseId}.`);
    if (this.playerState.activeLicenses.has(licenseId)) return; // already owned
    if (!license.isUnlocked(this.playerState)) {
      this.scene.showShopMessage("This contract is locked. Check its requirements in the Contracts tab.");
      return;
    }
    if (!license.canAfford(this.playerState)) return; // can't afford it

    this.playerState.spendCredits(license.baseCost, { category: "licenses", label: license.name });
    this.playerState.signLicense(licenseId);
    this.scene.recalculateActiveFactions();
    // The panel re-renders via the constructor's playerState subscription.
  }

  /**
   * Add or remove crates of an item, rejecting additions the order can't hold.
   * @param {string} itemId
   * @param {number} delta - crates
   */
  changeSupplyOrder(itemId, delta) {
    const count = (this.supplyOrder.get(itemId) || 0) + delta;
    const summary = this.scene.getSupplyOrderSummary(this.supplyOrder);
    if (delta > 0 && summary.crates >= summary.maxCrates) return;
    if (delta > 0) {
      const candidate = new Map(this.supplyOrder);
      candidate.set(itemId, count);
      const nextSummary = this.scene.getSupplyOrderSummary(candidate);
      if (!nextSummary.canPlace) {
        this.scene.showShopMessage(nextSummary.problem);
        playErrorBuzz();
        return;
      }
    }
    if (count > 0) this.supplyOrder.set(itemId, count);
    else this.supplyOrder.delete(itemId);
    this.refreshSupplyPanel();
  }

  handlePlaceSupplyOrder() {
    // Why an order can't be placed is already shown in the summary, so no popup here.
    if (this.scene.placeSupplyOrder(this.supplyOrder)) this.supplyOrder.clear();
    this.refreshSupplyPanel();
  }

  // --- Window ---

  openWindow() {
    if (this.scene.startingShift || this.scene.fixturePlacement?.active || this.scene.loadFailed) return;
    this.refreshInventoryPanel();
    this.refreshEmployeePanel();
    this.refreshSupplyPanel(); // loading pad spots free up without any playerState change
    this.refreshLayoutPanels();
    this.refreshEquipmentPanel();
    this.refreshFinancesPanel();
    this.uiWindow.openWindow();
    this.scene.checkoutWindow.suspend();
  }
}
