// ==========================================
// FILE: LayoutTab.js
// ==========================================
// Layout tab rendering, expansion actions, and panel refresh behavior.
import { LayoutRenderer } from "./LayoutRenderer.js";

export class LayoutTab {
  constructor(scene) {
    this.scene = scene;
    this.panel = null;
    this.renderPanel = null;
    this.actions = null;
  }

  draw() {
    return LayoutRenderer.generateHTML(this.scene);
  }

  /**
   * Bind layout actions and its full panel renderer.
   * @param {HTMLElement} panel
   * @param {HTMLElement} eventRoot
   * @param {() => string} renderPanel
   * @param {Record<string, (value: string) => void>} actions
   */
  bind(panel, eventRoot, renderPanel, actions) {
    if (!panel) throw new Error("Layout tab panel is missing");
    this.panel = panel;
    this.renderPanel = renderPanel;
    this.actions = actions;
    eventRoot.addEventListener("click", (event) => this.handleClick(event));
  }

  redraw() {
    if (!this.panel) return;
    const scrollTop = this.panel.querySelector(".layout-expansions-list")?.scrollTop ?? 0;
    this.panel.innerHTML = this.renderPanel();
    const list = this.panel.querySelector(".layout-expansions-list");
    if (list) list.scrollTop = scrollTop;
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    if (!(event.target instanceof Element) || !this.panel.contains(event.target)) return;
    const actions = [
      ["[data-buy-expansion-id]", "buyExpansion", "buyExpansionId"],
      ["[data-buy-backroom-id]", "buyBackroomUpgrade", "buyBackroomId"],
      ["[data-buy-hovercart]", "buyHovercart", "buyHovercart"],
      ["[data-buy-hovercart-upgrade]", "buyHovercartUpgrade", "buyHovercartUpgrade"],
    ];
    for (const [selector, action, dataKey] of actions) {
      const button = event.target.closest(selector);
      if (!button) continue;
      this.actions[action](button.dataset[dataKey]);
      return;
    }
  }
}
