// ==========================================
// FILE: DeliveriesTab.js
// ==========================================
// Manager's Tablet Deliveries tab: the app that comes with the Delivery Drone Delivery Drones.
// Shows what the drones are doing with each accepted remote order, and lets the player accept,
// decline, reset, or cancel orders without walking to the Drone Terminal.
import { html, raw } from "../core/html.js";
import { formatRemoteDeadline } from "../modules/droneDeliveries/DroneDeliverySystem.js";
import { formatMoneyAmount } from "./Money.js";

export class DeliveriesTab {
  constructor(scene) {
    this.scene = scene;
    this.panel = null;
    this.renderPanel = null;
    this.confirmCancelId = null;
  }

  get system() {
    return this.scene.gameModules?.get("droneDeliveries") ?? null;
  }

  draw() {
    const system = this.system;
    if (!system) return "";
    const today = this.scene.gameState.calendar.day;
    const statuses = system.drones.statuses();
    if (!statuses.some(({ order }) => order.id === this.confirmCancelId)) this.confirmCancelId = null;
    const orderCards = statuses.map((status) => {
      const { order, crate } = status;
      const number = order.id.slice("remote-order-".length);
      const rows = order.items.map((line) =>
        system.renderProductLine(line.itemId, line.quantity, crate.getAvailableUnitsFor(line.itemId))).join("");
      const due = formatRemoteDeadline(order.expiresOnDay, today, "Due");
      const actions = this.confirmCancelId === order.id
        ? html`
          <div class="remote-order-cancel-confirmation">
            <div>Cancel Order ${number}?</div>
            <div class="remote-order-cancel-cost">&minus;${order.reputation} reputation</div>
            <div class="remote-order-actions">
              <button type="button" class="action-btn warning" data-deliveries-confirm-cancel="${order.id}">CANCEL ORDER</button>
              <button type="button" class="action-btn" data-deliveries-keep>KEEP IT</button>
            </div>
          </div>`
        : html`
          <div class="remote-order-actions">
            <button type="button" class="action-btn" data-deliveries-reset="${order.id}">RESET</button>
            <button type="button" class="action-btn warning" data-deliveries-cancel="${order.id}">CANCEL</button>
          </div>`;
      return html`
        <div class="item-card deliveries-order">
          <div class="deliveries-order-header">
            <h3 class="type-h3">Order ${number}</h3>
            <span class="deliveries-progress">${status.packed} of ${status.total} packed</span>
          </div>
          <p class="type-description deliveries-status deliveries-status-${status.state}">${system.drones.statusText(status)}</p>
          <div class="remote-order-lines">${raw(rows)}</div>
          <div class="remote-order-stats">
            <span class="remote-order-pay">Pays ${formatMoneyAmount(order.payout)}</span>
            <span class="remote-order-reputation">+${order.reputation} reputation</span>
            <span class="remote-order-deadline${due.endsWith("today") ? " urgent" : ""}">${due}</span>
          </div>
          ${actions}
        </div>
      `;
    });
    return String(html`
      <div class="deliveries-panel">
        <div class="deliveries-list custom-scrollbar">
          <p class="type-description">Your drones pack accepted orders one item at a time, taking stock from crates
            before shelves. They start an order once your store has every item it still needs, and ship it as soon
            as it's packed.</p>
          <h2 class="type-h2">Accepted Orders</h2>
          ${orderCards.length ? orderCards : html`<p class="type-description deliveries-empty">No accepted orders. Accept an offer below.</p>`}
          <h2 class="type-h2">Offers</h2>
          ${raw(system.renderOffers())}
        </div>
      </div>
    `);
  }

  /**
   * @param {HTMLElement} panel
   * @param {HTMLElement} eventRoot
   * @param {() => string} renderPanel
   */
  bind(panel, eventRoot, renderPanel) {
    if (!panel) throw new Error("Deliveries tab panel is missing");
    this.panel = panel;
    this.renderPanel = renderPanel;
    eventRoot.addEventListener("click", (event) => this.handleClick(event));
  }

  get visible() {
    return Boolean(this.panel && !this.panel.classList.contains("hidden"));
  }

  redraw() {
    if (!this.panel) return;
    const scrollTop = this.panel.querySelector(".deliveries-list")?.scrollTop ?? 0;
    this.lastHTML = this.renderPanel();
    this.panel.innerHTML = this.lastHTML;
    const list = this.panel.querySelector(".deliveries-list");
    if (list) list.scrollTop = scrollTop;
  }

  // Called on the drones' regular tick; only touches the page when something on it changed.
  refreshIfChanged() {
    if (!this.visible || !this.scene.managerTablet?.uiWindow?.isOpen) return;
    if (this.renderPanel() !== this.lastHTML) this.redraw();
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    const target = event.target;
    const system = this.system;
    if (!system || !(target instanceof Element) || !this.panel.contains(target)) return;
    const button = target.closest("button");
    if (!button || button.disabled) return;
    const data = button.dataset;
    if (data.remoteOrderAccept) system.acceptOffer(data.remoteOrderAccept);
    else if (data.remoteOrderDecline) system.declineOffer(data.remoteOrderDecline);
    else if (data.deliveriesReset) system.resetOrder(data.deliveriesReset);
    else if (data.deliveriesCancel) this.confirmCancelId = data.deliveriesCancel;
    else if (data.deliveriesConfirmCancel) {
      this.confirmCancelId = null;
      system.cancelOrder(data.deliveriesConfirmCancel);
    } else if ("deliveriesKeep" in data) this.confirmCancelId = null;
    else return;
    this.redraw();
  }
}
