// ==========================================
// FILE: ShiftClock.js
// ==========================================
// Real-time in-game clock for one shift (Galactic Time Code at a fixed speed, with a manual
// pause). At hour 12 the store soft-closes to new foot traffic; the scene ends the shift
// once everyone inside has been served. The clock only tracks time and the soft-close flag.
const SHIFT_LENGTH_HOURS = 12;
const REAL_SECONDS_PER_GTC_HOUR = 35; // a 12-hour shift is 7 minutes of unpaused play
export const SHIFT_DURATION_MS = SHIFT_LENGTH_HOURS * REAL_SECONDS_PER_GTC_HOUR * 1000;
const SHIFT_START_HOUR = 8; // cosmetic: the displayed clock starts at 08:00

export class ShiftClock {
  constructor() {
    this.elapsedMs = 0;
    // The first shift must be explicitly started from GameScene's pre-shift window.
    this.isPaused = true;
    this.started = false;
    this.softClosed = false; // true once hour 12 is reached
    this.listeners = [];
  }

  update(deltaMs) {
    if (this.isPaused || this.softClosed) return;

    this.elapsedMs = Math.min(SHIFT_DURATION_MS, this.elapsedMs + deltaMs);

    if (this.elapsedMs >= SHIFT_DURATION_MS) {
      this.softClosed = true;
    }

    this.notifyListeners();
  }

  // Time is counted in whole milliseconds so the shift ends exactly on schedule.
  get elapsedHours() {
    return this.elapsedMs / 1000 / REAL_SECONDS_PER_GTC_HOUR;
  }

  getElapsedMs() {
    return this.elapsedMs;
  }

  // Freeze or resume time. Ignored until the first shift starts, so the HUD button
  // can't tick the clock while the store is still closed.
  togglePause() {
    if (!this.started) return;
    this.isPaused = !this.isPaused;
    this.notifyListeners();
  }

  // Called when the player starts the next shift (or dismisses the first pre-shift window),
  // after the scene confirms the previous one has fully ended.
  startNewShift() {
    this.elapsedMs = 0;
    this.isPaused = false;
    this.started = true;
    this.softClosed = false;
    this.notifyListeners();
  }

  // 24-hour "HH:MM" display, wrapping past midnight if a shift ever ran that long.
  getFormattedTime() {
    const totalMinutes = Math.floor((SHIFT_START_HOUR + this.elapsedHours) * 60) % (24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  /**
   * Register a listener; it's called immediately with the current state.
   * @param {(clock: ShiftClock) => void} callback
   */
  subscribe(callback) {
    this.listeners.push(callback);
    callback(this);
  }

  notifyListeners() {
    this.listeners.forEach((callback) => callback(this));
  }
}
