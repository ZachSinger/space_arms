/**
 * Shared timing tools. Anything that waits in real time (checkout delays, the Chit
 * countdown, belt motion) goes through PausableTimers so a pause holds it in place.
 * Shift time itself lives in ShiftClock, which only advances on game frames.
 */

/**
 * Timers that stop counting while paused and carry on from where they stopped.
 * Time is "running time": real milliseconds that passed while not paused.
 */
export class PausableTimers {
  /**
   * @param {{ now?: () => number, schedule?: (callback: () => void, ms: number) => any,
   *   unschedule?: (id: any) => void }} [host]
   *   Injectable for tests; defaults to the browser's clock and timers.
   */
  constructor({
    now = () => Date.now(),
    schedule = (callback, ms) => setTimeout(callback, ms),
    unschedule = (id) => clearTimeout(id),
  } = {}) {
    this.realNow = now;
    this.schedule = schedule;
    this.unschedule = unschedule;
    this.paused = false;
    this.runningMs = 0;
    this.resumedAt = now();
    /** @type {Set<object>} */
    this.timers = new Set();
  }

  /** Milliseconds of running time since these timers were created. */
  now() {
    return this.paused ? this.runningMs : this.runningMs + (this.realNow() - this.resumedAt);
  }

  /**
   * Calls back once after `ms` of running time.
   * @param {number} ms
   * @param {() => void} callback
   * @returns {{ cancel: () => void }}
   */
  after(ms, callback) {
    return this.add({ remaining: Math.max(0, ms), callback, repeatMs: 0 });
  }

  /**
   * Calls back every `ms` of running time with the running time since the last call.
   * @param {number} ms
   * @param {(elapsedMs: number) => void} callback
   * @returns {{ cancel: () => void }}
   */
  every(ms, callback) {
    if (!(ms > 0)) throw new RangeError("A repeating timer needs a positive interval.");
    return this.add({ remaining: ms, callback, repeatMs: ms, lastTick: this.now() });
  }

  /** @param {boolean} paused */
  setPaused(paused) {
    if (this.paused === paused) return;
    const runningNow = this.now();
    this.paused = paused;
    if (paused) {
      this.runningMs = runningNow;
      for (const timer of this.timers) {
        this.unschedule(timer.id);
        timer.remaining = Math.max(0, timer.remaining - (runningNow - timer.startedAt));
      }
    } else {
      this.resumedAt = this.realNow();
      for (const timer of this.timers) this.start(timer);
    }
  }

  clear() {
    for (const timer of this.timers) this.unschedule(timer.id);
    this.timers.clear();
  }

  add(timer) {
    this.timers.add(timer);
    if (!this.paused) this.start(timer);
    return { cancel: () => this.cancel(timer) };
  }

  cancel(timer) {
    if (!this.timers.delete(timer)) return;
    this.unschedule(timer.id);
  }

  start(timer) {
    timer.startedAt = this.now();
    timer.id = this.schedule(() => this.fire(timer), timer.remaining);
  }

  fire(timer) {
    if (!this.timers.has(timer)) return;
    if (!timer.repeatMs) {
      this.timers.delete(timer);
      timer.callback();
      return;
    }
    const now = this.now();
    const elapsed = now - timer.lastTick;
    timer.lastTick = now;
    timer.remaining = timer.repeatMs;
    this.start(timer);
    timer.callback(elapsed);
  }
}

