// ==========================================
// FILE: HUDController.js
// ==========================================
// The persistent DOM HUD: credits, reputation, hovercart capacity, shift clock, and the
// pause / start-shift / save buttons. Re-renders from PlayerState and ShiftClock updates.
export class HUDController {
    /**
     * @param {PlayerState} playerState
     * @param {ShiftClock | null} shiftClock - omit to skip the clock and shift buttons
     * @param {() => void} onStartShift
     * @param {() => void} onSave
     */
    constructor(playerState, shiftClock, onStartShift, onSave) {
        this.creditsEl = document.getElementById('hud-credits');
        this.repEl = document.getElementById('hud-rep');
        this.hovercartEl = document.getElementById('hud-hovercart');
        this.shiftTimeEl = document.getElementById('hud-shift-time');
        this.pauseBtn = document.getElementById('hud-pause-btn');
        this.startShiftBtn = document.getElementById('hud-start-shift-btn');
        this.saveBtn = document.getElementById('hud-save-btn');
        this.rootEl = document.getElementById('persistent-hud');
        this.rootEl.classList.remove('hidden');
        this.saveBtn.disabled = true;
        this.saveBtn.textContent = 'SAVE';
        this.handleSave = () => onSave?.();
        this.saveBtn.addEventListener('click', this.handleSave);

        playerState.subscribe((state) => this.render(state));

        if (shiftClock) {
            shiftClock.subscribe((clock) => this.renderShiftClock(clock));
            this.handlePause = () => shiftClock.togglePause();
            this.handleStartShift = () => onStartShift?.();
            this.pauseBtn.addEventListener('click', this.handlePause);
            this.startShiftBtn.addEventListener('click', this.handleStartShift);
        }
    }

    destroy() {
        this.rootEl.classList.add('hidden');
        this.pauseBtn.removeEventListener('click', this.handlePause);
        this.startShiftBtn.removeEventListener('click', this.handleStartShift);
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
        this.creditsEl.innerText = `${state.credits.toLocaleString()} credits`;
        
        if (state.credits < 0) {
            this.creditsEl.classList.add('deficit');
        } else {
            this.creditsEl.classList.remove('deficit');
        }
        
        this.repEl.innerText = state.globalReputation;

        // The hovercart has no subscribe() of its own; transfers call
        // playerState.notifyListeners() (see FixtureWindow.transfer) to keep this live.
        this.hovercartEl.innerText = `${state.hovercart.usedCapacity()}/${state.hovercart.capacity}`;
    }

    renderShiftClock(clock) {
        this.shiftTimeEl.innerText = clock.started ? clock.getFormattedTime() : 'CLOSED';
        this.shiftTimeEl.classList.toggle('shift-soft-closed', clock.softClosed);

        // Before the first shift, show START SHIFT in place of PAUSE (which does nothing yet).
        this.startShiftBtn.classList.toggle('hidden', clock.started);
        this.pauseBtn.classList.toggle('hidden', !clock.started);

        this.pauseBtn.innerText = clock.isPaused ? 'RESUME' : 'PAUSE';
        this.pauseBtn.classList.toggle('active', clock.isPaused);
        // After soft close the clock has already stopped, so pausing means nothing.
        this.pauseBtn.disabled = clock.softClosed;
    }
}