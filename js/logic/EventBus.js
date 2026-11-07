// ==========================================
// FILE: EventBus.js
// ==========================================
// A small synchronous publisher for game events. Producers announce facts without calling
// the debug log, UI, audio, or other consumers directly.

export const GAME_EVENTS = Object.freeze({
  CUSTOMER_HIT_BY_CRATE: "customer-hit-by-crate",
  CUSTOMER_LEFT_ANGRY: "customer-left-angry",
  CUSTOMER_MISSING_PRIMARY: "customer-missing-primary",
  CUSTOMER_SALE_COMPLETED: "customer-sale-completed",
  CRATE_PICKED_UP: "crate-picked-up",
  CRATE_DROPPED: "crate-dropped",
  CRATE_DELIVERY_RESULT: "crate-delivery-result",
  FIXTURE_OPENED: "fixture-opened",
  INVENTORY_TRANSFERRED: "inventory-transferred",
  REGISTER_SESSION_ENDED: "register-session-ended",
  REGISTER_SESSION_STARTED: "register-session-started",
  SHIFT_ENDED: "shift-ended",
  SHIFT_STARTED: "shift-started",
});

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<(payload: object) => void>>} */
    this.listeners = new Map();
  }

  /**
   * Subscribe to an event. The returned function removes only this subscription.
   * @param {string} eventName
   * @param {(payload: object) => void} listener
   * @returns {() => void}
   */
  on(eventName, listener) {
    if (!eventName) throw new TypeError("Event name is required");
    if (typeof listener !== "function") throw new TypeError("Event listener must be a function");

    let listeners = this.listeners.get(eventName);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(eventName, listeners);
    }
    listeners.add(listener);

    return () => {
      const currentListeners = this.listeners.get(eventName);
      currentListeners?.delete(listener);
      if (currentListeners?.size === 0) this.listeners.delete(eventName);
    };
  }

  /**
   * Notify current subscribers synchronously. Listener errors are allowed to surface.
   * @param {string} eventName
   * @param {object} payload
   */
  emit(eventName, payload) {
    const listeners = this.listeners.get(eventName);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(payload);
  }

  // Remove subscriptions when the owning scene shuts down.
  clear() {
    this.listeners.clear();
  }
}
