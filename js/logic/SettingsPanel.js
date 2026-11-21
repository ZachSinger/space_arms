// ==========================================
// FILE: SettingsPanel.js
// ==========================================
// DOM settings window for resolution, display mode, and text size. Changes preview
// immediately; APPLY keeps them as the new cancel point, CANCEL reverts to the last one.
// Text size persists in localStorage; display settings live in the Electron window.
import { setGameDisplaySettings } from "./GameViewport.js";
import { getSavedCursorMode, setCursorMode } from "./GameCursor.js";

export class SettingsPanel {
  static textSizeStorageKey = "space-arms-dealer.text-size";

  // Text size option -> font scale multiplier.
  static textSizeScales = {
    default: "1.15",
    smaller: "0.95",
    larger: "1.4",
  };

  constructor({ onOpen, onClose } = {}) {
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.element = document.createElement("div");
    this.element.className = "retro-window settings-window hidden";
    this.element.innerHTML = `
      <div class="settings-content custom-scrollbar">
        <div class="settings-title">SETTINGS</div>
        <label class="settings-field">
          <span>CURSOR</span>
          <select class="settings-cursor">
            <option value="hardware">HARDWARE (SYSTEM-DRAWN)</option>
            <option value="software">SOFTWARE (GAME-DRAWN)</option>
          </select>
          <span>Both use the custom game cursor. Hardware follows your mouse with less delay.</span>
        </label>
        <label class="settings-field">
          <span>RESOLUTION</span>
          <select class="settings-resolution"></select>
        </label>
        <label class="settings-field">
          <span>DISPLAY MODE</span>
          <select class="settings-display-mode">
            <option value="windowed">WINDOWED</option>
            <option value="borderless">BORDERLESS FULLSCREEN</option>
            <option value="fullscreen">FULLSCREEN</option>
          </select>
        </label>
        <label class="settings-field">
          <span>TEXT SIZE</span>
          <select class="settings-text-size">
            <option value="default">DEFAULT</option>
            <option value="smaller">SMALLER</option>
            <option value="larger">LARGER</option>
          </select>
        </label>
        <div class="settings-status"></div>
      </div>
      <div class="settings-actions">
        <button class="action-btn settings-cancel">CANCEL</button>
        <button class="action-btn warning settings-apply">APPLY</button>
        <button class="action-btn settings-accept">ACCEPT</button>
      </div>
    `;

    document.getElementById("ui-layer").appendChild(this.element);

    this.select = this.element.querySelector(".settings-resolution");
    this.displayModeSelect = this.element.querySelector(
      ".settings-display-mode",
    );
    this.textSizeSelect = this.element.querySelector(".settings-text-size");
    this.cursorSelect = this.element.querySelector(".settings-cursor");
    this.status = this.element.querySelector(".settings-status");
    SettingsPanel.applyTextSize(SettingsPanel.getSavedTextSize());

    this.element
      .querySelector(".settings-cancel")
      .addEventListener("click", () => this.run(() => this.cancel()));

    this.element
      .querySelector(".settings-apply")
      .addEventListener("click", () => this.run(() => this.saveSnapshot()));

    this.element
      .querySelector(".settings-accept")
      .addEventListener("click", () => this.close());

    this.select.addEventListener("change", () => this.run(() => this.previewResolution()));
    this.displayModeSelect.addEventListener("change", () =>
      this.run(() => this.previewDisplayMode()),
    );
    this.textSizeSelect.addEventListener("change", () =>
      this.previewTextSize(),
    );
    this.cursorSelect.addEventListener("change", () => setCursorMode(this.cursorSelect.value));
    this.handleEscape = (event) => {
      if (event.key !== "Escape" || this.element.classList.contains("hidden")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void this.run(() => this.cancel());
    };
    document.addEventListener("keydown", this.handleEscape, true);
  }

  async run(action) {
    try {
      await action();
    } catch (error) {
      console.error("Settings action failed:", error);
      this.status.textContent = `Could not apply settings: ${error.message}`;
    }
  }

  // Show the panel, refreshing options and recording the current settings to revert to.
  async open() {
    const settings = window.desktopApi ? await window.desktopApi.getDisplaySettings() : null;

    this.settingsSnapshot = {
      resolution: settings?.current,
      displayMode: settings?.displayMode,
      textSize: SettingsPanel.getSavedTextSize(),
      cursorMode: getSavedCursorMode(),
    };
    this.select.disabled = this.displayModeSelect.disabled = !settings;
    if (settings) this.syncDisplaySettings(settings);
    else this.status.textContent = "Display settings are available in the desktop game. Text size and cursor work here.";
    this.textSizeSelect.value = this.settingsSnapshot.textSize;
    this.cursorSelect.value = this.settingsSnapshot.cursorMode;

    this.element.classList.remove("hidden");
    this.onOpen?.();
  }

  syncDisplaySettings(settings) {
    this.appliedResolution = settings.current;
    this.appliedDisplayMode = settings.displayMode;
    this.displayModeSelect.value = settings.displayMode;
    this.select.replaceChildren();

    for (const resolution of settings.resolutions) {
      const option = document.createElement("option");
      option.value = `${resolution.width}x${resolution.height}`;
      option.textContent = `${resolution.width} x ${resolution.height}`;

      if (
        resolution.width === settings.current.width &&
        resolution.height === settings.current.height
      ) {
        option.selected = true;
      }

      this.select.appendChild(option);
    }

    this.status.textContent = `CURRENT: ${settings.current.width} x ${settings.current.height}`;
    setGameDisplaySettings(settings);
  }

  // ACCEPT: keep whatever is previewed and persist the text size.
  close() {
    localStorage.setItem(
      SettingsPanel.textSizeStorageKey,
      this.textSizeSelect.value,
    );
    setCursorMode(this.cursorSelect.value, { persist: true });
    this.element.classList.add("hidden");
    this.onClose?.();
  }

  destroy() {
    document.removeEventListener("keydown", this.handleEscape, true);
    this.element.remove();
  }

  async cancel() {
    const { resolution, displayMode, textSize, cursorMode } = this.settingsSnapshot;

    // Restore the mode first; switching modes can resize the window.
    if (window.desktopApi && displayMode !== this.appliedDisplayMode) {
      await window.desktopApi.setDisplayMode(displayMode);
    }

    if (window.desktopApi) {
      const restored = await window.desktopApi.setResolution(resolution);
      this.syncDisplaySettings(restored);
    }
    this.textSizeSelect.value = textSize;
    SettingsPanel.applyTextSize(textSize);
    this.cursorSelect.value = cursorMode;
    setCursorMode(cursorMode);
    this.close();
  }

  async previewResolution() {
    const [width, height] = this.select.value.split("x").map(Number);

    if (
      width === this.appliedResolution.width &&
      height === this.appliedResolution.height
    ) {
      return;
    }

    const settings = await window.desktopApi.setResolution({ width, height });
    this.syncDisplaySettings(settings);
  }

  async previewDisplayMode() {
    const mode = this.displayModeSelect.value;

    if (mode === this.appliedDisplayMode) {
      return;
    }

    const settings = await window.desktopApi.setDisplayMode(mode);
    this.syncDisplaySettings(settings);
  }

  previewTextSize() {
    SettingsPanel.applyTextSize(this.textSizeSelect.value);
  }

  // APPLY: make the current settings the new point CANCEL reverts to.
  async saveSnapshot() {
    const settings = window.desktopApi ? await window.desktopApi.getDisplaySettings() : null;

    this.settingsSnapshot = {
      resolution: settings?.current,
      displayMode: settings?.displayMode,
      textSize: this.textSizeSelect.value,
      cursorMode: this.cursorSelect.value,
    };
    if (settings) this.syncDisplaySettings(settings);
    localStorage.setItem(SettingsPanel.textSizeStorageKey, this.textSizeSelect.value);
    setCursorMode(this.cursorSelect.value, { persist: true });
  }

  static getSavedTextSize() {
    const textSize = localStorage.getItem(SettingsPanel.textSizeStorageKey);
    return SettingsPanel.textSizeScales[textSize] ? textSize : "default";
  }

  static getTextSizeScale(textSize) {
    return Number(SettingsPanel.textSizeScales[textSize]);
  }

  /**
   * Apply the size to DOM text and notify the shared Phaser text-size handler.
   * @param {string} textSize - key of textSizeScales
   */
  static applyTextSize(textSize) {
    document.documentElement.dataset.textSize = textSize;
    window.dispatchEvent(
      new CustomEvent("text-size-changed", {
        detail: { scale: SettingsPanel.getTextSizeScale(textSize) },
      }),
    );
  }
}
