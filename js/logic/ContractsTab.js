// ==========================================
// FILE: ContractsTab.js
// ==========================================
// Contracts tab rendering and signing actions.
import { ContractRenderer } from "./ContractRenderer.js";

export class ContractsTab {
  /**
   * @param {GameState} gameState
   * @param {() => SupplierLicense[]} getLicenses
   * @param {(licenseId: string) => void} signContract
   */
  constructor(gameState, getLicenses, signContract) {
    this.gameState = gameState;
    this.getLicenses = getLicenses;
    this.signContract = signContract;
    this.panel = null;
    this.renderPanel = null;
  }

  draw() {
    return ContractRenderer.generateHTML(this.getLicenses(), this.gameState);
  }

  /**
   * Bind contract actions and its full panel renderer.
   * @param {HTMLElement} panel
   * @param {HTMLElement} eventRoot
   * @param {() => string} [renderPanel]
   */
  bind(panel, eventRoot, renderPanel = () => this.draw()) {
    if (!panel) throw new Error("Contracts tab panel is missing");
    this.panel = panel;
    this.renderPanel = renderPanel;
    eventRoot.addEventListener("click", (event) => this.handleClick(event));
  }

  redraw() {
    if (!this.panel) return;
    this.panel.innerHTML = this.renderPanel();
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    if (!(event.target instanceof Element) || !this.panel.contains(event.target)) return;
    const signButton = event.target.closest("[data-license-id]");
    if (signButton) this.signContract(signButton.dataset.licenseId);
  }
}
