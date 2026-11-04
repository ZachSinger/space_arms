export class HUDController {
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

        // Subscribe to the brain!
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

    renderSaveState({ canSave, saving, status, unavailableReason }) {
        this.saveBtn.disabled = !canSave || saving;
        this.saveBtn.textContent = saving ? 'SAVING...' : 'SAVE';
        this.saveBtn.title = saving ? 'Saving game...' : canSave ? status : unavailableReason;
    }

    render(state) {
        // Render credits with commas
        this.creditsEl.innerText = `${state.credits.toLocaleString()}c`;
        
        // Toggle red color if in debt
        if (state.credits < 0) {
            this.creditsEl.classList.add('deficit');
        } else {
            this.creditsEl.classList.remove('deficit');
        }
        
        // Render raw reputation integer
        this.repEl.innerText = state.globalReputation;

        // Hovercart capacity -- same InventoryPool model as a physical fixture, just
        // always "with" the player (bible: an abstract carrying capacity, not a physical
        // object). Not driven by its own subscribe() -- transfers call
        // playerState.notifyListeners() directly (see FixtureWindow.transfer) so this
        // stays live right alongside credits/reputation.
        this.hovercartEl.innerText = `${state.hovercart.usedCapacity()}/${state.hovercart.capacity}`;
    }

    renderShiftClock(clock) {
        this.shiftTimeEl.innerText = clock.started ? clock.getFormattedTime() : 'CLOSED';
        this.shiftTimeEl.classList.toggle('shift-soft-closed', clock.softClosed);

        // Before the very first shift starts, show a plain HUD button instead of a
        // separate popped-up window -- the pause button has nothing to do yet either
        // (ShiftClock.togglePause() ignores it until started, see its own comment).
        this.startShiftBtn.classList.toggle('hidden', clock.started);
        this.pauseBtn.classList.toggle('hidden', !clock.started);

        this.pauseBtn.innerText = clock.isPaused ? 'RESUME' : 'PAUSE';
        this.pauseBtn.classList.toggle('active', clock.isPaused);
        // Pausing after doors are already locked for the day doesn't mean anything --
        // the clock itself has already stopped advancing (see ShiftClock.update).
        this.pauseBtn.disabled = clock.softClosed;
    }
}