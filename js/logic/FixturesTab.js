// ==========================================
// FILE: FixturesTab.js
// ==========================================
// Fixtures tab rendering, actions, and panel refresh behavior.
import { LayoutRenderer } from "./LayoutRenderer.js";

export class FixturesTab {
  constructor(scene) {
    this.scene = scene;
    this.purchaseNotice = "";
    this.saleConfirmation = null;
    this.panel = null;
    this.renderPanel = null;
    this.actions = null;
  }

  draw() {
    return LayoutRenderer.generateHTML(
      this.scene,
      true,
      this.purchaseNotice,
      this.saleConfirmation,
    );
  }

  /**
   * Bind fixture actions and its full panel renderer.
   * @param {HTMLElement} panel
   * @param {HTMLElement} eventRoot
   * @param {() => string} renderPanel
   * @param {Record<string, (value?: string) => void>} actions
   */
  bind(panel, eventRoot, renderPanel, actions) {
    if (!panel) throw new Error("Fixtures tab panel is missing");
    this.panel = panel;
    this.renderPanel = renderPanel;
    this.actions = actions;
    eventRoot.addEventListener("click", (event) => this.handleClick(event));
  }

  redraw() {
    if (!this.panel) return;
    const scrollPositions = [".fixtures-catalog-list", ".fixtures-owned-list"].map((selector) => ({
      selector,
      top: this.panel.querySelector(selector)?.scrollTop ?? 0,
    }));

    this.panel.innerHTML = this.renderPanel();

    for (const { selector, top } of scrollPositions) {
      const list = this.panel.querySelector(selector);
      if (list) list.scrollTop = top;
    }
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    if (!(event.target instanceof Element) || !this.panel.contains(event.target)) return;
    const actions = [
      ["[data-buy-fixture-id]", "buyFixture", "buyFixtureId"],
      ["[data-move-fixture-id]", "moveFixture", "moveFixtureId"],
      ["[data-crate-fixture-id]", "crateFixture", "crateFixtureId"],
      ["[data-sell-fixture-id]", "sellFixture", "sellFixtureId"],
      ["[data-sell-fixture-crate]", "sellFixtureCrate", "sellFixtureCrate"],
    ];
    for (const [selector, action, dataKey] of actions) {
      const button = event.target.closest(selector);
      if (!button) continue;
      this.actions[action](button.dataset[dataKey]);
      return;
    }

    if (event.target.closest("[data-confirm-fixture-sale]")) this.actions.confirmSale();
    else if (event.target.closest("[data-cancel-fixture-sale]")) this.actions.cancelSale();
  }
}
