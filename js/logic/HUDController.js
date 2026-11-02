export class HUDController {
    constructor(playerState, shiftClock) {
        this.creditsEl = document.getElementById('hud-credits');
        this.repEl = document.getElementById('hud-rep');
        this.shiftTimeEl = document.getElementById('hud-shift-time');
        this.pauseBtn = document.getElementById('hud-pause-btn');

        // Subscribe to the brain!
        playerState.subscribe((state) => this.render(state));

        if (shiftClock) {
            shiftClock.subscribe((clock) => this.renderShiftClock(clock));
            this.pauseBtn.addEventListener('click', () => shiftClock.togglePause());
        }
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
    }

    renderShiftClock(clock) {
        this.shiftTimeEl.innerText = clock.started ? clock.getFormattedTime() : 'CLOSED';
        this.shiftTimeEl.classList.toggle('shift-soft-closed', clock.softClosed);

        this.pauseBtn.innerText = clock.isPaused ? 'RESUME' : 'PAUSE';
        this.pauseBtn.classList.toggle('active', clock.isPaused);
        // Pausing after doors are already locked for the day doesn't mean anything --
        // the clock itself has already stopped advancing (see ShiftClock.update). Same
        // idea before the very first shift has even been started yet (see
        // ShiftClock.togglePause's own guard against this).
        this.pauseBtn.disabled = clock.softClosed || !clock.started;
    }
}