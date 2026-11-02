// ==========================================
// FILE: ShiftClock.js
// ==========================================
// Real-time-driven in-game clock for a single shift (bible Step 2: Galactic Time Code,
// "Static Speed", with a Manual Toggle to pause). A shift is a fixed 12 GTC hours; once
// elapsed, the store "soft closes" (bible Step 11): doors lock to new foot traffic, but
// the scene is responsible for actually ending the shift once everyone already inside has
// been served (the clock itself only tracks time + the soft-close flag).
const SHIFT_LENGTH_HOURS = 12;
const REAL_SECONDS_PER_GTC_HOUR = 12; // "Static Speed" -- a full 12-hour shift is 144
// real seconds (2m24s), fast enough to actually playtest a full shift end-to-end.
const SHIFT_START_HOUR = 8; // purely cosmetic -- the displayed clock starts at 08:00

export class ShiftClock {
  constructor() {
    this.elapsedHours = 0;
    this.isPaused = false;
    this.softClosed = false; // true once hour 12 is reached
    this.listeners = [];
  }

  update(deltaMs) {
    if (this.isPaused || this.softClosed) return;

    const deltaHours = deltaMs / 1000 / REAL_SECONDS_PER_GTC_HOUR;
    this.elapsedHours = Math.min(SHIFT_LENGTH_HOURS, this.elapsedHours + deltaHours);

    if (this.elapsedHours >= SHIFT_LENGTH_HOURS) {
      this.softClosed = true;
    }

    this.notifyListeners();
  }

  // The "Manual Toggle" from the bible -- lets the player freeze time entirely (e.g. to
  // think without pressure) without needing a variable speed control.
  togglePause() {
    this.isPaused = !this.isPaused;
    this.notifyListeners();
  }

  // Called once the scene confirms the shift has actually ended (soft-closed AND every
  // customer already inside has been served) and the player starts the next one.
  startNewShift() {
    this.elapsedHours = 0;
    this.isPaused = false;
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

  subscribe(callback) {
    this.listeners.push(callback);
    callback(this);
  }

  notifyListeners() {
    this.listeners.forEach((callback) => callback(this));
  }
}
