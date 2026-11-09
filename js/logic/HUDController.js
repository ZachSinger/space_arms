// ==========================================
// FILE: HUDController.js
// ==========================================
// The persistent DOM HUD: credits, reputation, hovercart capacity, shift clock, and the
// pause / start-shift / end-day / save buttons. Re-renders from PlayerState and ShiftClock.
import { formatMoney } from "./Money.js";
import { getNextShopLevel } from "./ShopProgression.js";
export class HUDController {
    /**
     * @param {PlayerState} playerState
     * @param {ShiftClock | null} shiftClock - omit to skip the clock and shift buttons
     * @param {() => void} onStartShift
     * @param {() => void} onSave
     * @param {() => void} onEndDay - opens the Finances tab once a shift is over
     */
    constructor(playerState, shiftClock, onStartShift, onSave, onEndDay) {
        this.creditsEl = document.getElementById('hud-credits');
        this.repEl = document.getElementById('hud-rep');
        this.shopLevelEl = document.getElementById('hud-shop-level');
        this.hovercartEl = document.getElementById('hud-hovercart');
        this.shiftTimeEl = document.getElementById('hud-shift-time');
        this.pauseBtn = document.getElementById('hud-pause-btn');
        this.startShiftBtn = document.getElementById('hud-start-shift-btn');
        this.endDayBtn = document.getElementById('hud-end-day-btn');
        this.saveBtn = document.getElementById('hud-save-btn');
        this.rootEl = document.getElementById('persistent-hud');
        this.rootEl.classList.remove('hidden');
        // Top bar buttons are mouse-only. If one held keyboard focus, Space would press it
        // instead of picking up or dropping a crate.
        for (const button of this.rootEl.querySelectorAll('button')) button.tabIndex = -1;
        this.preventButtonFocus = (event) => {
            if (event.target.closest?.('button')) event.preventDefault();
        };
        this.rootEl.addEventListener('mousedown', this.preventButtonFocus);
        this.saveBtn.disabled = true;
        this.saveBtn.textContent = 'SAVE';
        this.handleSave = () => onSave?.();
        this.saveBtn.addEventListener('click', this.handleSave);
        this.clock = null;
        this.awaitingEndDay = false;

        playerState.subscribe((state) => this.render(state));

        if (shiftClock) {
            shiftClock.subscribe((clock) => this.renderShiftClock(clock));
            this.handlePause = () => shiftClock.togglePause();
            this.handleStartShift = () => onStartShift?.();
            this.handleEndDay = () => onEndDay?.();
            this.pauseBtn.addEventListener('click', this.handlePause);
            this.startShiftBtn.addEventListener('click', this.handleStartShift);
            this.endDayBtn.addEventListener('click', this.handleEndDay);
        }
    }

    destroy() {
        this.rootEl.classList.add('hidden');
        this.rootEl.removeEventListener('mousedown', this.preventButtonFocus);
        this.pauseBtn.removeEventListener('click', this.handlePause);
        this.startShiftBtn.removeEventListener('click', this.handleStartShift);
        this.endDayBtn.removeEventListener('click', this.handleEndDay);
        this.saveBtn.removeEventListener('click', this.handleSave);
    }

    /**
     * @param {{canSave: boolean, saving: boolean, status: string, unavailableReason: string}} saveState
     */
    renderSaveState({ canSave, saving, status, unavailableReason }) {
        this.saveBtn.disabled = !canSave || saving;
        this.saveBtn.textContent = saving ? 'SAVING...' : 'SAVE';
        this.saveBtn.title = saving ? 'Saving game...' : canSave ? status : unavailableReason;
    }

    render(state) {
        this.creditsEl.innerText = formatMoney(state.credits);
        
        if (state.credits < 0) {
            this.creditsEl.classList.add('deficit');
        } else {
            this.creditsEl.classList.remove('deficit');
        }
        
        this.repEl.innerText = state.globalReputation;
        this.repEl.title = 'Store reputation changes at the end of each shift.';
        this.shopLevelEl.innerText = state.shopLevel;
        const nextLevel = getNextShopLevel(state.shopLevel);
        this.shopLevelEl.title = nextLevel
            ? `Finish a shift with at least ${nextLevel.reputation} store reputation to reach Shop Level ${nextLevel.level}.`
            : 'Your shop keeps its earned level even if reputation falls.';

        // The hovercart has no subscribe() of its own; transfers call
        // playerState.notifyListeners() (see FixtureWindow.transfer) to keep this live.
        this.hovercartEl.innerText = `${state.hovercart.usedCapacity()}/${state.hovercart.capacity}`;

        this.awaitingEndDay = Boolean(state.awaitingEndDay);
        this.renderShiftButtons();
    }

    renderShiftClock(clock) {
        this.clock = clock;
        this.shiftTimeEl.innerText = clock.started ? clock.getFormattedTime() : 'CLOSED';
        this.shiftTimeEl.classList.toggle('shift-soft-closed', clock.softClosed);

        this.pauseBtn.innerText = clock.isPaused ? 'RESUME' : 'PAUSE';
        this.pauseBtn.classList.toggle('active', clock.isPaused);
        // After soft close the clock has already stopped, so pausing means nothing.
        this.pauseBtn.disabled = clock.softClosed;
        this.renderShiftButtons();
    }

    // One shift button at a time: PAUSE during a shift, END DAY after it, START SHIFT before.
    renderShiftButtons() {
        if (!this.clock) return;
        const started = this.clock.started;
        this.pauseBtn.classList.toggle('hidden', !started);
        this.endDayBtn.classList.toggle('hidden', started || !this.awaitingEndDay);
        this.startShiftBtn.classList.toggle('hidden', started || this.awaitingEndDay);
    }
}