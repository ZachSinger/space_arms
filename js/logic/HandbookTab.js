// ==========================================
// FILE: HandbookTab.js
// ==========================================
// Handbook topic selection, rendering, and panel refresh behavior.
import { HandbookRenderer } from "./HandbookRenderer.js";

export class HandbookTab {
  constructor(gameState, getLicenses) {
    this.gameState = gameState;
    this.getLicenses = getLicenses;
    this.topic = "store";
    this.panel = null;
    this.renderPanel = null;
  }

  draw() {
    return HandbookRenderer.generateHTML({
      topic: this.topic,
      shopLevel: this.gameState.reputation.shopLevel,
      reputation: this.gameState.reputation.global,
      licenses: this.getLicenses(),
    });
  }

  /**
   * Bind topic selection and the full panel renderer.
   * @param {HTMLElement} panel
   * @param {HTMLElement} eventRoot
   * @param {() => string} renderPanel
   */
  bind(panel, eventRoot, renderPanel) {
    if (!panel) throw new Error("Handbook tab panel is missing");
    this.panel = panel;
    this.renderPanel = renderPanel;
    eventRoot.addEventListener("click", (event) => this.handleClick(event));
  }

  redraw() {
    if (this.panel) this.panel.innerHTML = this.renderPanel();
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element) || !this.panel.contains(target)) return;
    const topicButton = target.closest("[data-handbook-topic]");
    if (!topicButton) return;
    this.topic = topicButton.dataset.handbookTopic;
    this.redraw();
  }
}
