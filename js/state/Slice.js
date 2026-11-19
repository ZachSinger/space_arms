// ==========================================
// FILE: Slice.js
// ==========================================
// One piece of the game's saved state (money, reputation, staff...). Screens subscribe to the
// slices they show and redraw when told something changed; nothing refreshes them by hand.
//
// Rules:
// - Change a slice's data only through its own methods, which call `changed()` when done.
// - `changed()` tells this slice's subscribers, then the owning GameState's.

export class Slice {
  #listeners = new Set();
  /** @type {(() => void) | null} */
  #onChange = null;

  /**
   * Called right away with this slice, then after every change. Returns an unsubscribe function.
   * @param {(slice: this) => void} callback
   * @param {{ immediate?: boolean }} [options]
   * @returns {() => void}
   */
  subscribe(callback, { immediate = true } = {}) {
    const entry = () => callback(this);
    this.#listeners.add(entry);
    if (immediate) entry();
    return () => this.#listeners.delete(entry);
  }

  /** @param {() => void} callback - the owning GameState's change hook */
  attach(callback) {
    this.#onChange = callback;
  }

  changed() {
    for (const listener of [...this.#listeners]) listener();
    this.#onChange?.();
  }
}
