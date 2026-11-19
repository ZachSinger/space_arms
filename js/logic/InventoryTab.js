// ==========================================
// FILE: InventoryTab.js
// ==========================================
// Inventory tab display, price controls, and keyboard/hover navigation.
import { InventoryRenderer } from "./InventoryRenderer.js";
import { adjustStorePrice } from "./Money.js";

export const INVENTORY_PRICE_INPUT_SELECTOR = "input[data-price-item-id]";
export const INVENTORY_PRICE_BUTTON_SELECTOR = "button[data-price-action]";
export const INVENTORY_PRICE_CONTROL_SELECTOR =
  `${INVENTORY_PRICE_INPUT_SELECTOR}, ${INVENTORY_PRICE_BUTTON_SELECTOR}`;

export class InventoryTab {
  /** @param {GameScene} scene */
  constructor(scene) {
    this.scene = scene;
    this.panel = null;
    this.rootElement = null;
    this.renderPanel = null;
    this.disableNavigation = () => {};
    this.editingPrice = false;
    this.refreshPending = false;
  }

  draw() {
    return InventoryRenderer.generateHTML(this.scene.getInventoryItems());
  }

  /**
   * Bind inventory controls and its full panel renderer.
   * @param {HTMLElement} panel
   * @param {HTMLElement} rootElement
   * @param {HTMLElement} eventRoot
   * @param {() => string} [renderPanel]
   */
  bind(panel, rootElement, eventRoot, renderPanel = () => this.draw()) {
    if (!panel) throw new Error("Inventory tab panel is missing");
    this.panel = panel;
    this.rootElement = rootElement;
    this.renderPanel = renderPanel;
    this.disableNavigation = this.enableListNavigation();

    eventRoot.addEventListener("click", (event) => this.handleClick(event));
    eventRoot.addEventListener("change", (event) => this.handleChange(event));
    eventRoot.addEventListener("keydown", (event) => this.handleKeydown(event));
    eventRoot.addEventListener("focusin", (event) => this.handleFocusIn(event));
    eventRoot.addEventListener("focusout", (event) => this.handleFocusOut(event));
  }

  redraw() {
    if (!this.panel) return;
    if (this.editingPrice) {
      this.refreshPending = true;
      return;
    }

    this.refreshPending = false;
    const activeElement = document.activeElement;
    const focusedButton = this.panel.contains(activeElement) &&
      activeElement.matches(INVENTORY_PRICE_BUTTON_SELECTOR)
      ? {
        itemId: activeElement.dataset.priceItemId,
        action: activeElement.dataset.priceAction,
      }
      : null;
    const selectedItemId = this.panel.querySelector(".item-card.selected")?.dataset.itemId;
    const scrollTop = this.panel.querySelector(".inventory-list").scrollTop;
    this.disableNavigation();
    this.panel.innerHTML = this.renderPanel();
    this.disableNavigation = this.enableListNavigation(selectedItemId);
    this.panel.querySelector(".inventory-list").scrollTop = scrollTop;

    if (focusedButton) {
      const replacement = Array.from(this.panel.querySelectorAll(INVENTORY_PRICE_BUTTON_SELECTOR)).find(
        (button) =>
          button.dataset.priceItemId === focusedButton.itemId &&
          button.dataset.priceAction === focusedButton.action,
      );
      replacement?.focus({ preventScroll: true });
    }
  }

  /**
   * Move list selection to an item and focus its price field.
   * @param {string} itemId
   */
  focusItem(itemId) {
    this.disableNavigation();
    this.disableNavigation = this.enableListNavigation(itemId);
    const input = Array.from(this.panel.querySelectorAll(INVENTORY_PRICE_INPUT_SELECTOR))
      .find((element) => element.dataset.priceItemId === itemId);
    input?.focus();
    input?.select();
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    if (!(event.target instanceof Element) || !this.panel.contains(event.target)) return;
    const button = event.target.closest(INVENTORY_PRICE_BUTTON_SELECTOR);
    if (button) this.handlePriceAdjustment(button.dataset.priceItemId, button.dataset.priceAction);
  }

  /** @param {Event} event */
  handleChange(event) {
    if (!(event.target instanceof Element) || !this.panel.contains(event.target)) return;
    const input = event.target.closest(INVENTORY_PRICE_INPUT_SELECTOR);
    if (!input) return;

    const itemId = input.dataset.priceItemId;
    if (!this.scene.setStorePrice(itemId, Number(input.value))) {
      input.value = this.scene.getStorePrice(itemId);
      return;
    }

    const entry = this.scene.getInventoryItems().find(({ item }) => item.id === itemId);
    const profit = input.closest(".inventory-item-card")?.querySelector("[data-inventory-profit]");
    if (entry && profit) {
      profit.outerHTML = InventoryRenderer.generateProfitHTML(entry.storePrice, entry.unitCost);
    }
  }

  /** @param {KeyboardEvent} event */
  handleKeydown(event) {
    if (!(event.target instanceof Element) || !this.panel.contains(event.target)) return;
    if (event.key === "Enter" && event.target.matches(INVENTORY_PRICE_INPUT_SELECTOR)) {
      event.target.blur();
    }
  }

  /** @param {FocusEvent} event */
  handleFocusIn(event) {
    if (event.target instanceof Element && this.panel.contains(event.target) &&
      event.target.matches(INVENTORY_PRICE_INPUT_SELECTOR)) {
      this.editingPrice = true;
    }
  }

  /** @param {FocusEvent} event */
  handleFocusOut(event) {
    if (!(event.target instanceof Element) || !this.panel.contains(event.target)) return;
    if (event.target.matches(INVENTORY_PRICE_INPUT_SELECTOR)) this.editingPrice = false;
    if (this.refreshPending && event.target.matches(INVENTORY_PRICE_CONTROL_SELECTOR) &&
      !event.relatedTarget?.matches?.(INVENTORY_PRICE_BUTTON_SELECTOR)) {
      setTimeout(() => this.redraw());
    }
  }

  /**
   * Step a store price by about 10%, or set it to the current market price.
   * @param {string} itemId
   * @param {"decrease" | "increase" | "market"} action
   */
  handlePriceAdjustment(itemId, action) {
    const nextPrice = adjustStorePrice(
      this.scene.getStorePrice(itemId),
      this.scene.gameState.market.getPrice(itemId),
      action,
    );
    if (nextPrice !== null) this.scene.setStorePrice(itemId, nextPrice);
  }

  destroy() {
    this.disableNavigation();
    this.disableNavigation = () => {};
  }

  /** @param {string | null} [selectedItemId] @returns {() => void} */
  enableListNavigation(selectedItemId = null) {
    const list = this.rootElement.querySelector(".inventory-list");
    const cards = list ? Array.from(list.querySelectorAll(".item-card")) : [];
    if (cards.length === 0) return () => {};

    let selectedIndex = 0;
    const selectCard = (index) => {
      cards[selectedIndex]?.classList.remove("selected");
      selectedIndex = Math.max(0, Math.min(index, cards.length - 1));
      const card = cards[selectedIndex];
      card.classList.add("selected");
      card.scrollIntoView({ block: "nearest" });
    };
    const handlePointerEnter = (event) => selectCard(Number(event.currentTarget.dataset.index));
    const handleKeydown = (event) => {
      if (this.rootElement.classList.contains("hidden")) return;
      if (event.target instanceof HTMLInputElement) return;
      const panel = list.closest(".tablet-tab-panel");
      if (panel && panel.classList.contains("hidden")) return;
      if (event.code === "ArrowDown") {
        event.preventDefault();
        selectCard(selectedIndex + 1);
      } else if (event.code === "ArrowUp") {
        event.preventDefault();
        selectCard(selectedIndex - 1);
      }
    };

    cards.forEach((card) => card.addEventListener("pointerenter", handlePointerEnter));
    window.addEventListener("keydown", handleKeydown);
    selectCard(Math.max(0, cards.findIndex((card) => card.dataset.itemId === selectedItemId)));

    return () => {
      window.removeEventListener("keydown", handleKeydown);
      cards.forEach((card) => card.removeEventListener("pointerenter", handlePointerEnter));
    };
  }
}
