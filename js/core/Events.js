// ==========================================
// FILE: Events.js
// ==========================================
// The game's announcements: one part of the game says what just happened ("a sale finished")
// and anything interested reacts, without the two knowing about each other.
//
// Rules:
// - Announce a fact only after the change it describes is complete.
// - An announcement made while another is still being handled waits until that one has
//   reached every listener, so listeners never see events out of order or half-handled.
// - Every subscription can be undone; `group()` undoes many at once (for menus that close).

/**
 * Every event the game announces, and what it carries.
 * @typedef {object} GameEventPayloads
 * @property {{ customer: object, itemId: string | null }} "customer-hit-by-crate"
 * @property {{ customer: object, cart: object[], reputationPenalty?: boolean, factionReputationPenalty?: boolean }} "customer-left-angry"
 * @property {{ customer: object, itemIds: string[], itemNames: string[] }} "customer-missing-primary"
 * @property {{ customer: object, reaction: "bargain" | "skipped" | "disgusted" }} "customer-price-reaction"
 * @property {{ customer: object, total: number }} "customer-sale-completed"
 * @property {{ customer: object }} "customer-exited"
 * @property {{ kind: string, itemId: string | null, typeId: string | null, quantity: number }} "crate-picked-up"
 * @property {{ kind: string, itemId: string | null, typeId: string | null, quantity: number, thrown: boolean, x: number, y: number }} "crate-dropped"
 * @property {{ fixtureId: string, type: string }} "fixture-opened"
 * @property {{ itemId: string, quantity: number, source: string, destination: string }} "inventory-transferred"
 * @property {{ registerId: string | null }} "register-session-ended"
 * @property {{ registerId: string }} "register-session-started"
 * @property {{ served: number, turnedAway: number, reputation: number, factionReputation: object }} "shift-ended"
 * @property {{ pool: object }} "shift-started"
 */

export const GAME_EVENTS = Object.freeze({
  CUSTOMER_HIT_BY_CRATE: "customer-hit-by-crate",
  CUSTOMER_LEFT_ANGRY: "customer-left-angry",
  CUSTOMER_MISSING_PRIMARY: "customer-missing-primary",
  CUSTOMER_PRICE_REACTION: "customer-price-reaction",
  CUSTOMER_SALE_COMPLETED: "customer-sale-completed",
  CUSTOMER_EXITED: "customer-exited",
  CRATE_PICKED_UP: "crate-picked-up",
  CRATE_DROPPED: "crate-dropped",
  FIXTURE_OPENED: "fixture-opened",
  INVENTORY_TRANSFERRED: "inventory-transferred",
  REGISTER_SESSION_ENDED: "register-session-ended",
  REGISTER_SESSION_STARTED: "register-session-started",
  SHIFT_ENDED: "shift-ended",
  SHIFT_STARTED: "shift-started",
});

const KNOWN_EVENTS = new Set(Object.values(GAME_EVENTS));

export class Events {
  /** @param {{ strict?: boolean }} [options] - strict rejects event names not in GAME_EVENTS */
  constructor({ strict = false } = {}) {
    this.strict = strict;
    /** @type {Map<string, Set<(payload: any) => void>>} */
    this.listeners = new Map();
    /** @type {Array<[string, any]>} */
    this.queue = [];
    this.dispatching = false;
  }

  checkName(eventName) {
    if (!eventName) throw new TypeError("Event name is required");
    if (this.strict && !KNOWN_EVENTS.has(eventName)) throw new TypeError(`Unknown event "${eventName}"`);
  }

  /**
   * Subscribe to an event. The returned function removes only this subscription.
   * @param {string} eventName
   * @param {(payload: any) => void} listener
   * @returns {() => void}
   */
  on(eventName, listener) {
    this.checkName(eventName);
    if (typeof listener !== "function") throw new TypeError("Event listener must be a function");
    let listeners = this.listeners.get(eventName);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(eventName, listeners);
    }
    // Wrapped so the same function can be subscribed twice and removed independently.
    const entry = (payload) => listener(payload);
    listeners.add(entry);
    return () => {
      const current = this.listeners.get(eventName);
      current?.delete(entry);
      if (current?.size === 0) this.listeners.delete(eventName);
    };
  }

  /** Like `on`, but only for the next time the event happens. */
  once(eventName, listener) {
    const off = this.on(eventName, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  /**
   * A set of subscriptions that can all be removed with one `off()`.
   * @returns {{ on: (eventName: string, listener: (payload: any) => void) => () => void, off: () => void }}
   */
  group() {
    const offs = [];
    return {
      on: (eventName, listener) => {
        const off = this.on(eventName, listener);
        offs.push(off);
        return off;
      },
      off: () => {
        for (const off of offs.splice(0)) off();
      },
    };
  }

  /**
   * Announce an event. Listener errors are allowed to surface.
   * @param {string} eventName
   * @param {any} payload
   */
  emit(eventName, payload) {
    this.checkName(eventName);
    this.queue.push([eventName, payload]);
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      while (this.queue.length) {
        const [name, data] = this.queue.shift();
        const listeners = this.listeners.get(name);
        if (!listeners) continue;
        for (const listener of [...listeners]) listener(data);
      }
    } finally {
      this.dispatching = false;
      this.queue.length = 0;
    }
  }

  // Remove every subscription when the owning scene shuts down.
  clear() {
    this.listeners.clear();
    this.queue.length = 0;
  }
}

/**
 * Collapses many "something changed" calls into one call per flush, for screens that redraw
 * on change. The game calls `flush()` once per frame.
 * @param {() => void} callback
 */
export function createBatchedNotifier(callback) {
  let pending = false;
  return {
    notify() {
      pending = true;
    },
    flush() {
      if (!pending) return;
      pending = false;
      callback();
    },
    get pending() {
      return pending;
    },
  };
}
