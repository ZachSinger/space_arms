// ==========================================
// FILE: FinancesTab.js
// ==========================================
// Finances tab rendering, actions, and panel refresh behavior.
import { FinancesRenderer } from "./FinancesRenderer.js";

export class FinancesTab {
  constructor(scene) {
    this.scene = scene;
    this.selectedDay = null;
    this.panel = null;
    this.renderPanel = null;
    this.actions = null;
  }

  draw() {
    return FinancesRenderer.generateHTML(this.scene.shift.financesView(), this.selectedDay);
  }

  /**
   * Bind finance controls and its full panel renderer.
   * @param {HTMLElement} panel
   * @param {HTMLElement} eventRoot
   * @param {() => string} renderPanel
   * @param {Record<string, (value?: string) => void>} actions
   */
  bind(panel, eventRoot, renderPanel, actions) {
    if (!panel) throw new Error("Finances tab panel is missing");
    this.panel = panel;
    this.renderPanel = renderPanel;
    this.actions = actions;
    eventRoot.addEventListener("click", (event) => this.handleClick(event));
  }

  redraw() {
    if (!this.panel) return;
    const scrollTop = this.panel.querySelector(".finances-day-list")?.scrollTop ?? 0;
    this.panel.innerHTML = this.renderPanel();
    const list = this.panel.querySelector(".finances-day-list");
    if (list) list.scrollTop = scrollTop;
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element) || !this.panel.contains(target)) return;

    const dayButton = target.closest("[data-finances-day]");
    if (dayButton) {
      this.actions.selectDay(dayButton.dataset.financesDay);
      return;
    }
    if (target.closest("[data-end-day]")) this.actions.endDay();
    else if (target.closest("[data-finances-start-shift]")) this.actions.startShift();
    else if (target.closest("[data-take-emergency-loan]")) this.actions.takeLoan();
    else if (target.closest("[data-pay-off-emergency-loan]")) this.actions.payOffLoan();
  }
}
