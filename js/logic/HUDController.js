// ==========================================
// FILE: HUDController.js
// ==========================================
// The persistent DOM HUD: credits, reputation, hovercart capacity, shift clock, and the
// pause / temporary store closure / start-shift / end-day / save buttons.
import { formatMoney } from "./Money.js";
import { getNextShopLevel } from "./ShopProgression.js";
export class HUDController {
    /**
     * @param {PlayerState} playerState
     * @param {ShiftClock | null} shiftClock - omit to skip the clock and shift buttons
     * @param {() => void} onStartShift
     * @param {() => void} onSave
     * @param {() => void} onEndDay - opens the Finances tab once a shift is over
     * @param {() => void} onToggleStore - temporarily stops or resumes customer arrivals
     * @param {() => void} onMainMenu - asks to leave the game for the title screen
     */
    constructor(playerState, shiftClock, onStartShift, onSave, onEndDay, onToggleStore, onMainMenu) {
        this.creditsEl = document.getElementById('hud-credits');
        this.repEl = document.getElementById('hud-rep');
        this.shopLevelEl = document.getElementById('hud-shop-level');
        this.hovercartEl = document.getElementById('hud-hovercart');
        this.staminaEl = document.getElementById('hud-stamina');
        this.staminaFillEl = document.getElementById('hud-stamina-fill');
        this.staminaValueEl = document.getElementById('hud-stamina-value');
        this.shiftTimeEl = document.getElementById('hud-shift-time');
        this.pauseBtn = document.getElementById('hud-pause-btn');
        this.storeToggleBtn = document.getElementById('hud-store-toggle-btn');
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
        this.mainMenuBtn = document.getElementById('hud-main-menu-btn');
        this.handleMainMenu = () => onMainMenu?.();
        this.mainMenuBtn.addEventListener('click', this.handleMainMenu);
        this.clock = null;
        this.awaitingEndDay = false;
        this.storeTemporarilyClosed = false;

        playerState.subscribe((state) => this.render(state));

        if (shiftClock) {
            shiftClock.subscribe((clock) => this.renderShiftClock(clock));
            this.handlePause = () => shiftClock.togglePause();
            this.handleStoreToggle = () => onToggleStore?.();
            this.handleStartShift = () => onStartShift?.();
            this.handleEndDay = () => onEndDay?.();
            this.pauseBtn.addEventListener('click', this.handlePause);
            this.storeToggleBtn.addEventListener('click', this.handleStoreToggle);
            this.startShiftBtn.addEventListener('click', this.handleStartShift);
            this.endDayBtn.addEventListener('click', this.handleEndDay);
        }
    }

    destroy() {
        this.rootEl.classList.add('hidden');
        this.rootEl.removeEventListener('mousedown', this.preventButtonFocus);
        this.pauseBtn.removeEventListener('click', this.handlePause);
        this.storeToggleBtn.removeEventListener('click', this.handleStoreToggle);
        this.startShiftBtn.removeEventListener('click', this.handleStartShift);
        this.endDayBtn.removeEventListener('click', this.handleEndDay);
        this.saveBtn.removeEventListener('click', this.handleSave);
        this.mainMenuBtn.removeEventListener('click', this.handleMainMenu);
    }

    /**
     * @param {{canSave: boolean, saving: boolean, status: string, unavailableReason: string}} saveState
     */
    renderSaveState({ canSave, saving, status, unavailableReason }) {
        this.saveBtn.disabled = !canSave || saving;
        this.saveBtn.textContent = saving ? 'SAVING...' : 'SAVE';
        this.saveBtn.title = saving ? 'Saving game...' : canSave ? status : unavailableReason;
    }

    renderStamina({ stamina, maxStamina, exhausted }) {
        const percent = Math.ceil(stamina / maxStamina * 100);
        if (percent === this.staminaPercent && exhausted === this.staminaExhausted) return;
        this.staminaPercent = percent;
        this.staminaExhausted = exhausted;
        this.staminaFillEl.style.width = `${percent}%`;
        this.staminaValueEl.textContent = `${percent}%`;
        this.staminaEl.setAttribute('aria-valuenow', String(percent));
        this.staminaEl.setAttribute('aria-valuetext', exhausted
            ? `${percent}% stamina. Recovering before you can dash again.`
            : `${percent}% stamina`);
        this.staminaEl.classList.toggle('exhausted', exhausted);
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

    renderStoreStatus(temporarilyClosed) {
        this.storeTemporarilyClosed = temporarilyClosed;
        this.renderShiftButtons();
    }

    // Show shift controls only when their action is available; store admission can be toggled during a shift.
    renderShiftButtons() {
        if (!this.clock) return;
        const started = this.clock.started;
        this.pauseBtn.classList.toggle('hidden', !started);
        this.endDayBtn.classList.toggle('hidden', started || !this.awaitingEndDay);
        this.startShiftBtn.classList.toggle('hidden', started || this.awaitingEndDay);
        const canToggleStore = started && !this.clock.softClosed;
        this.storeToggleBtn.classList.toggle('hidden', !canToggleStore);
        this.storeToggleBtn.disabled = !canToggleStore;
        this.storeToggleBtn.textContent = this.storeTemporarilyClosed
            ? 'REOPEN STORE'
            : 'CLOSE STORE';
        this.storeToggleBtn.setAttribute('aria-pressed', String(this.storeTemporarilyClosed));
        this.storeToggleBtn.title = this.storeTemporarilyClosed
            ? 'Reopen the store and resume scheduled customer arrivals.'
            : 'Temporarily stop new customers. Customers already inside can finish shopping, and the shift clock keeps running.';
    }
}