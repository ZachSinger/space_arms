// ==========================================
// FILE: OrderTracker.js
// ==========================================
// The small remote-order card under the top bar's left end. It shows the open order's items,
// how many are packed, and where each item is in the shop right now. Clicking its heading
// shrinks it to one line. It glows for a few seconds when a new order arrives.
import { html } from "../../core/html.js";

const NEW_ORDER_GLOW_MS = 6000;
// Kept for the whole session, so a player who shrank the card doesn't have to again.
let collapsedForSession = false;

/**
 * @typedef {{ name: string, image: string | null, packed: number, needed: number,
 *   where: string, shortage: string }} OrderTrackerLine
 * @typedef {{ dueText: string, dueSoon: boolean, payText: string, packed: number, total: number,
 *   status: string, complete: boolean, lines: OrderTrackerLine[] }} OrderTrackerView
 */

export class OrderTracker {
  /** @param {Document} [doc] */
  constructor(doc = document) {
    this.doc = doc;
    this.element = doc.createElement("section");
    this.element.className = "order-tracker hidden";
    this.element.setAttribute("aria-label", "Remote order");
    this.element.addEventListener("click", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-order-tracker-toggle]")) return;
      collapsedForSession = !collapsedForSession;
      this.key = null;
      this.render(this.view);
    });
    (doc.getElementById("ui-layer") ?? doc.body).append(this.element);
    this.view = null;
    this.key = null;
    this.glowTimer = null;
  }

  /** @param {OrderTrackerView | null} view - null hides the card */
  render(view) {
    this.view = view;
    const key = JSON.stringify([view, collapsedForSession]);
    if (key === this.key) return;
    this.key = key;
    this.element.classList.toggle("hidden", !view);
    this.element.classList.toggle("collapsed", collapsedForSession);
    this.element.classList.toggle("complete", Boolean(view?.complete));
    if (!view) {
      this.element.replaceChildren();
      return;
    }
    const lines = view.lines.map((line) => html`
      <li class="order-tracker-line${line.packed >= line.needed ? " done" : ""}">
        ${line.image ? html`<img class="order-tracker-image" src="${line.image}" alt="">` : ""}
        <div class="order-tracker-text">
          <div class="order-tracker-item">
            <span class="order-tracker-name">${line.name}</span>
            <span class="order-tracker-count">${line.packed} / ${line.needed}</span>
          </div>
          ${line.where ? html`<div class="order-tracker-where">${line.where}</div>` : ""}
          ${line.shortage ? html`<div class="order-tracker-shortage">${line.shortage}</div>` : ""}
        </div>
      </li>`);
    this.element.innerHTML = String(html`
      <button type="button" class="order-tracker-heading" data-order-tracker-toggle
        title="${collapsedForSession ? "Show this order's item list" : "Shrink this card to one line"}">
        <span class="order-tracker-title">REMOTE ORDER</span>
        <span class="order-tracker-progress">${view.packed} / ${view.total} packed</span>
        <span class="order-tracker-toggle">${collapsedForSession ? "SHOW" : "HIDE"}</span>
      </button>
      <div class="order-tracker-body">
        <div class="order-tracker-due${view.dueSoon ? " soon" : ""}">${view.dueText} · ${view.payText}</div>
        <ul class="order-tracker-lines">${lines}</ul>
        <div class="order-tracker-status">${view.status}</div>
      </div>
    `);
  }

  /** Glow for a few seconds so a new order is noticed without stopping play. */
  announce() {
    this.element.classList.remove("new-order");
    void this.element.offsetWidth;
    this.element.classList.add("new-order");
    clearTimeout(this.glowTimer);
    this.glowTimer = setTimeout(() => this.element.classList.remove("new-order"), NEW_ORDER_GLOW_MS);
  }

  destroy() {
    clearTimeout(this.glowTimer);
    this.element.remove();
  }
}
