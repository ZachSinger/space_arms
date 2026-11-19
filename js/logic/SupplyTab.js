// ==========================================
// FILE: SupplyTab.js
// ==========================================
// Supply tab interactions and refresh behavior, kept beside its renderer.
import { playErrorBuzz } from "./Sfx.js";
import { SupplyRenderer } from "./SupplyRenderer.js";

export class SupplyTab {
  /** @param {GameScene} scene */
  constructor(scene) {
    this.scene = scene;
    this.order = new Map();
    this.panel = null;
    this.renderPanel = null;
  }

  draw() {
    return SupplyRenderer.generateHTML(this.scene, this.order);
  }

  /**
   * Bind the tab's controls and complete panel renderer.
   * @param {HTMLElement} panel
   * @param {() => string} [renderPanel]
   */
  bind(panel, renderPanel = () => this.draw()) {
    if (!panel) throw new Error("Supply tab panel is missing");
    this.panel = panel;
    this.renderPanel = renderPanel;
    panel.addEventListener("click", (event) => this.handleClick(event));
  }

  redraw() {
    if (!this.panel) return;
    const scrollTop = this.panel.querySelector(".supply-list")?.scrollTop ?? 0;
    this.panel.innerHTML = this.renderPanel();
    const list = this.panel.querySelector(".supply-list");
    if (list) list.scrollTop = scrollTop;
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const addButton = target.closest("[data-supply-add]");
    if (addButton) {
      this.changeOrder(addButton.dataset.supplyAdd, 1);
      return;
    }

    const removeButton = target.closest("[data-supply-remove]");
    if (removeButton) {
      this.changeOrder(removeButton.dataset.supplyRemove, -1);
      return;
    }

    if (target.closest("[data-supply-clear]")) {
      this.order.clear();
      this.redraw();
      return;
    }

    if (target.closest("[data-supply-place]")) this.placeOrder();
  }

  /**
   * Add or remove crates, rejecting additions that exceed the order's limits.
   * @param {string} itemId
   * @param {number} delta - crate count change
   */
  changeOrder(itemId, delta) {
    const count = (this.order.get(itemId) || 0) + delta;
    const summary = this.scene.supply.orderSummary(this.order);
    if (delta > 0 && summary.crates >= summary.maxCrates) return;
    if (delta > 0) {
      const candidate = new Map(this.order);
      candidate.set(itemId, count);
      const nextSummary = this.scene.supply.orderSummary(candidate);
      if (!nextSummary.canPlace) {
        this.scene.showShopMessage(nextSummary.problem);
        playErrorBuzz();
        return;
      }
    }
    if (count > 0) this.order.set(itemId, count);
    else this.order.delete(itemId);
    this.redraw();
  }

  placeOrder() {
    if (this.scene.supply.placeOrder(this.order)) this.order.clear();
    this.redraw();
  }
}
