// ==========================================
// FILE: SettingsPanel.js
// ==========================================
// DOM settings window for resolution, display mode, and text size. Changes preview
// immediately; APPLY keeps them as the new cancel point, CANCEL reverts to the last one.
// Text size persists in localStorage; display settings live in the Electron window.
import { setGameDisplaySettings } from "./GameViewport.js";
import { getSavedCursorMode, setCursorMode } from "./GameCursor.js";
import {
  BINDING_GROUPS, bindingConflict, bindingForEvent, bindingLabel, defaultBindings, getBindings, setBindings,
} from "../input/KeyBindings.js";
import {
  CONTROLLER_ACTIONS, defaultControllerBindings, getControllerBindings, setControllerBindings,
  swapControllerBinding,
} from "../input/ControllerBindings.js";
import { PAD } from "../input/GamepadInput.js";
import {
  controllerButtonLabel, getControllerLabelStyle, getResolvedControllerLabelStyle, setControllerLabelStyle,
} from "../input/InputDevice.js";
import { html } from "../core/html.js";

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
      <div class="settings-header">
        <div class="settings-title">SETTINGS</div>
        <div class="settings-tabs">
          <button class="retro-tab-btn active" data-settings-tab="display">DISPLAY &amp; CURSOR</button>
          <button class="retro-tab-btn" data-settings-tab="controls">KEYBOARD &amp; MOUSE</button>
          <button class="retro-tab-btn" data-settings-tab="controller">CONTROLLER</button>
        </div>
        <p class="settings-binding-status" role="status"></p>
        <div class="settings-capture-actions hidden">
          <button class="settings-clear-binding">CLEAR CONTROL</button>
          <button class="settings-assign-escape">ASSIGN ESCAPE</button>
        </div>
      </div>
      <div class="settings-content custom-scrollbar">
        <div class="settings-display">
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
        <div class="settings-controls hidden">
          <h2>Keyboard &amp; mouse controls</h2>
          <p>Choose a control, then press a key or mouse button to change it.</p>
          <p>Mouse clicks inside menus, shelves and the register stay the same. Payment entry keeps its normal keys.</p>
          <div class="settings-binding-list"></div>
        </div>
        <div class="settings-controller hidden">
          <label class="settings-field">
            <span>CONTROLLER BUTTON NAMES</span>
            <select class="settings-controller-layout">
              <option value="automatic">AUTOMATIC</option>
              <option value="xbox">XBOX</option>
              <option value="playstation">PLAYSTATION</option>
              <option value="nintendo">NINTENDO</option>
            </select>
            <span>Automatic uses the controller name when it recognizes it. Otherwise, it uses Xbox button names.</span>
          </label>
          <h2>Controller buttons</h2>
          <p>Choose an action, then press the controller button you want to use. If another action uses that button, the two assignments switch. Press the D-pad to stop listening; the D-pad, sticks, and LT (dash) keep their current jobs.</p>
          <div class="settings-controller-bindings"></div>
          <div class="settings-controller-capture-actions hidden">
            <button class="settings-cancel-controller-capture">STOP LISTENING</button>
          </div>
          <button class="action-btn settings-controller-defaults">RESTORE DEFAULT BUTTONS</button>
        </div>
      </div>
      <div class="settings-actions">
        <button class="action-btn settings-defaults hidden">RESTORE DEFAULTS</button>
        <div class="settings-action-right">
        <button class="action-btn settings-cancel">CANCEL</button>
        <button class="action-btn warning settings-apply">APPLY</button>
        <button class="action-btn settings-accept">ACCEPT</button>
        </div>
      </div>
    `;

    document.getElementById("ui-layer").appendChild(this.element);

    this.select = this.element.querySelector(".settings-resolution");
    this.displayModeSelect = this.element.querySelector(
      ".settings-display-mode",
    );
    this.textSizeSelect = this.element.querySelector(".settings-text-size");
    this.cursorSelect = this.element.querySelector(".settings-cursor");
    this.controllerLayoutSelect = this.element.querySelector(".settings-controller-layout");
    this.status = this.element.querySelector(".settings-status");
    this.bindingStatus = this.element.querySelector(".settings-binding-status");
    this.bindingList = this.element.querySelector(".settings-binding-list");
    this.controllerBindingList = this.element.querySelector(".settings-controller-bindings");
    this.controllerCaptureActions = this.element.querySelector(".settings-controller-capture-actions");
    this.clearBindingButton = this.element.querySelector(".settings-clear-binding");
    this.captureActions = this.element.querySelector(".settings-capture-actions");
    this.bindings = getBindings();
    this.controllerBindings = getControllerBindings();
    SettingsPanel.applyTextSize(SettingsPanel.getSavedTextSize());

    this.element.querySelectorAll("[data-settings-tab]").forEach((button) => {
      button.addEventListener("click", () => this.selectTab(button.dataset.settingsTab));
    });
    this.element.querySelector(".settings-defaults").addEventListener("click", () => {
      this.bindings = defaultBindings();
      this.previewBindings();
      this.bindingStatus.textContent = "Default controls restored. Select Apply or Accept to keep them.";
    });
    this.bindingList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-binding-action]");
      if (!button) return;
      this.capture = { action: button.dataset.bindingAction, slot: Number(button.dataset.bindingSlot) };
      button.classList.add("capturing");
      this.bindingStatus.textContent = `Changing ${button.dataset.bindingLabel}. Press a key or mouse button. Escape cancels; use Assign Escape to bind it.`;
      this.captureActions.classList.remove("hidden");
      button.focus();
    });
    this.clearBindingButton.addEventListener("click", () => this.clearCapturedBinding());
    this.element.querySelector(".settings-assign-escape").addEventListener("click", () => this.assignCapturedBinding("Escape"));
    this.controllerBindingList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-controller-binding-action]");
      if (button) this.startControllerCapture(button.dataset.controllerBindingAction);
    });
    this.element.querySelector(".settings-cancel-controller-capture")
      .addEventListener("click", () => this.stopControllerCapture("Button selection stopped."));
    this.element.querySelector(".settings-controller-defaults").addEventListener("click", () => {
      this.controllerBindings = defaultControllerBindings();
      this.previewControllerBindings();
      this.bindingStatus.textContent = "Default controller buttons restored. Select Apply or Accept to keep them.";
    });
    this.element
      .querySelector(".settings-cancel")
      .addEventListener("click", () => this.run(() => this.cancel()));

    this.element
      .querySelector(".settings-apply")
      .addEventListener("click", () => this.run(() => this.saveSnapshot()));

    this.element
      .querySelector(".settings-accept")
      .addEventListener("click", () => this.run(() => this.close()));

    this.select.addEventListener("change", () => this.run(() => this.previewResolution()));
    this.displayModeSelect.addEventListener("change", () =>
      this.run(() => this.previewDisplayMode()),
    );
    this.textSizeSelect.addEventListener("change", () =>
      this.previewTextSize(),
    );
    this.cursorSelect.addEventListener("change", () => setCursorMode(this.cursorSelect.value));
    this.controllerLayoutSelect.addEventListener("change", () => {
      setControllerLabelStyle(this.controllerLayoutSelect.value);
      this.renderControllerBindings();
    });
    this.handleEscape = (event) => {
      if (event.key !== "Escape" || this.element.classList.contains("hidden")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.controllerCapture) {
        this.stopControllerCapture("Button selection stopped.");
        return;
      }
      void this.run(() => this.cancel());
    };
    document.addEventListener("keydown", this.handleEscape, true);
    this.handleBindingInput = (event) => this.captureBinding(event);
    this.handleBindingClick = (event) => {
      if (this.suppressClick) {
        this.suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    this.handleBindingContextMenu = (event) => {
      if (!this.suppressContextMenu) return;
      this.suppressContextMenu = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", this.handleBindingInput, true);
    window.addEventListener("mousedown", this.handleBindingInput, true);
    window.addEventListener("click", this.handleBindingClick, true);
    window.addEventListener("contextmenu", this.handleBindingContextMenu, true);
  }

  get isCapturing() { return Boolean(this.capture); }
  get isCapturingController() { return Boolean(this.controllerCapture); }

  selectTab(tab) {
    this.stopCapture();
    for (const button of this.element.querySelectorAll("[data-settings-tab]")) {
      const selected = button.dataset.settingsTab === tab;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
    }
    this.element.querySelector(".settings-display").classList.toggle("hidden", tab !== "display");
    this.element.querySelector(".settings-controls").classList.toggle("hidden", tab !== "controls");
    this.element.querySelector(".settings-controller").classList.toggle("hidden", tab !== "controller");
    this.element.querySelector(".settings-defaults").classList.toggle("hidden", tab !== "controls");
  }

  renderBindings() {
    this.bindingList.innerHTML = String(html`
      <table class="settings-binding-table">
        <thead><tr><th>ACTION</th><th>CONTROL 1</th><th>CONTROL 2</th></tr></thead>
        <tbody>${BINDING_GROUPS.map(({ title, actions }) => html`
          <tr class="settings-binding-group"><th colspan="3">${title}</th></tr>
          ${actions.map(({ id, label }) => html`
            <tr><td>${label}</td>${this.bindings[id].map((binding, slot) => html`
              <td><button class="settings-binding${binding ? "" : " empty"}"
                data-binding-action="${id}" data-binding-slot="${slot}" data-binding-label="${label}"
                aria-label="${label}, control ${slot + 1}: ${bindingLabel(binding)}">${bindingLabel(binding)}</button></td>
            `)}</tr>
          `)}
        `)}</tbody>
      </table>`);
  }

  renderControllerBindings() {
    const style = getResolvedControllerLabelStyle();
    this.controllerBindingList.innerHTML = String(html`
      <table class="settings-binding-table">
        <thead><tr><th>ACTION</th><th>BUTTON</th></tr></thead>
        <tbody>${CONTROLLER_ACTIONS.map(({ id, label }) => {
          const button = this.controllerBindings[id];
          const name = controllerButtonLabel(button, style);
          const capturing = this.controllerCapture === id ? " capturing" : "";
          return html`<tr><td>${label}</td><td><button class="settings-binding${capturing}"
            data-controller-binding-action="${id}" data-controller-binding-label="${label}"
            aria-label="${label}: ${name}">${name}</button></td></tr>`;
        })}</tbody>
      </table>`);
  }

  startControllerCapture(action) {
    this.stopCapture();
    this.controllerCapture = action;
    const button = this.controllerBindingList.querySelector(
      `[data-controller-binding-action="${action}"]`,
    );
    button?.classList.add("capturing");
    this.controllerCaptureActions.classList.remove("hidden");
    this.bindingStatus.textContent = `Changing ${button?.dataset.controllerBindingLabel}. Press a controller button; assigned actions will switch buttons if needed.`;
    button?.focus();
  }

  captureControllerButton(button) {
    if (!this.controllerCapture) return;
    if ([PAD.UP, PAD.DOWN, PAD.LEFT, PAD.RIGHT].includes(button)) {
      this.stopControllerCapture("Button selection stopped.");
      return;
    }
    const action = this.controllerCapture;
    let result;
    try {
      result = swapControllerBinding(this.controllerBindings, action, button);
    } catch (error) {
      this.bindingStatus.textContent = error.message;
      return;
    }
    const oldButton = this.controllerBindings[action];
    this.controllerBindings = result.bindings;
    this.previewControllerBindings();
    const buttonName = controllerButtonLabel(button);
    if (result.replacedAction) {
      const selectedLabel = CONTROLLER_ACTIONS.find(({ id }) => id === action).label;
      const other = CONTROLLER_ACTIONS.find(({ id }) => id === result.replacedAction);
      this.bindingStatus.textContent = `${selectedLabel} now uses ${buttonName}. ${other.label} now uses ${controllerButtonLabel(oldButton)}. Select Apply or Accept to keep these buttons.`;
    } else {
      this.bindingStatus.textContent = `That action already uses ${buttonName}. Select Apply or Accept to keep these buttons.`;
    }
  }

  previewControllerBindings() {
    setControllerBindings(this.controllerBindings);
    this.stopControllerCapture();
    this.renderControllerBindings();
  }

  previewBindings() {
    const previousCapture = this.capture;
    setBindings(this.bindings);
    this.stopCapture();
    this.renderBindings();
    if (previousCapture) {
      this.bindingList.querySelector(
        `[data-binding-action="${previousCapture.action}"][data-binding-slot="${previousCapture.slot}"]`,
      )?.focus({ preventScroll: true });
    }
  }

  stopCapture() {
    this.capture = null;
    this.stopControllerCapture();
    this.bindingList.querySelectorAll(".capturing").forEach((button) => button.classList.remove("capturing"));
    this.captureActions.classList.add("hidden");
    this.bindingStatus.textContent = "";
  }

  stopControllerCapture(message = "") {
    this.controllerCapture = null;
    this.controllerBindingList?.querySelectorAll(".capturing").forEach((button) => button.classList.remove("capturing"));
    this.controllerCaptureActions?.classList.add("hidden");
    if (message) this.bindingStatus.textContent = message;
  }

  clearCapturedBinding() {
    if (!this.capture) return;
    const { action, slot } = this.capture;
    if (!this.bindings[action][1 - slot]) {
      this.bindingStatus.textContent = "Each action needs at least one control.";
      return;
    }
    this.bindings[action][slot] = null;
    this.previewBindings();
  }

  captureBinding(event) {
    if (!this.capture || this.element.classList.contains("hidden")) {
      if (event.type === "mousedown") {
        this.suppressClick = false;
        this.suppressContextMenu = false;
      }
      return;
    }
    if (event.type === "mousedown" && event.target.closest?.(".settings-capture-actions")) return;
    if (event.type === "mousedown" && !event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "mousedown" && event.button === 0) this.suppressClick = true;
    if (event.type === "mousedown" && event.button === 2) this.suppressContextMenu = true;
    if (event.type === "keydown" && event.key === "Escape") {
      this.stopCapture();
      return;
    }
    if (event.repeat) return;
    const value = bindingForEvent(event);
    if (!value) {
      this.bindingStatus.textContent = "That key or mouse button cannot be assigned. Try another.";
      return;
    }
    this.assignCapturedBinding(value);
  }

  assignCapturedBinding(value) {
    if (!this.capture) return;
    const { action, slot } = this.capture;
    const conflict = bindingConflict(this.bindings, action, slot, value);
    if (conflict) {
      this.bindingStatus.textContent = `${bindingLabel(value)} is already used for ${conflict}. Choose another control.`;
      return;
    }
    this.bindings[action][slot] = value;
    this.previewBindings();
  }

  async run(action) {
    try {
      await action();
    } catch (error) {
      console.error("Settings action failed:", error);
      this.status.textContent = `Could not apply settings: ${error.message}`;
      this.bindingStatus.textContent = `Could not apply settings: ${error.message}`;
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
      controllerLabelStyle: getControllerLabelStyle(),
      controls: getBindings(),
      controllerBindings: getControllerBindings(),
    };
    this.bindings = getBindings();
    this.controllerBindings = getControllerBindings();
    this.renderBindings();
    this.renderControllerBindings();
    this.selectTab("display");
    this.select.disabled = this.displayModeSelect.disabled = !settings;
    if (settings) this.syncDisplaySettings(settings);
    else this.status.textContent = "Display settings are available in the desktop game. Text size and cursor work here.";
    this.textSizeSelect.value = this.settingsSnapshot.textSize;
    this.cursorSelect.value = this.settingsSnapshot.cursorMode;
    this.controllerLayoutSelect.value = this.settingsSnapshot.controllerLabelStyle;
    setControllerLabelStyle(this.settingsSnapshot.controllerLabelStyle);
    this.renderControllerBindings();

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
    setControllerLabelStyle(this.controllerLayoutSelect.value, { persist: true });
    setBindings(this.bindings, { persist: true });
    setControllerBindings(this.controllerBindings, { persist: true });
    this.stopCapture();
    this.element.classList.add("hidden");
    this.onClose?.();
  }

  destroy() {
    document.removeEventListener("keydown", this.handleEscape, true);
    window.removeEventListener("keydown", this.handleBindingInput, true);
    window.removeEventListener("mousedown", this.handleBindingInput, true);
    window.removeEventListener("click", this.handleBindingClick, true);
    window.removeEventListener("contextmenu", this.handleBindingContextMenu, true);
    this.element.remove();
  }

  async cancel() {
    const {
      resolution, displayMode, textSize, cursorMode, controllerLabelStyle, controls, controllerBindings,
    } = this.settingsSnapshot;

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
    this.controllerLayoutSelect.value = controllerLabelStyle;
    setControllerLabelStyle(controllerLabelStyle);
    if (controls) {
      this.bindings = controls;
      setBindings(controls);
    }
    if (controllerBindings) {
      this.controllerBindings = controllerBindings;
      setControllerBindings(controllerBindings);
    }
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
      controllerLabelStyle: this.controllerLayoutSelect.value,
      controls: getBindings(),
      controllerBindings: getControllerBindings(),
    };
    if (settings) this.syncDisplaySettings(settings);
    localStorage.setItem(SettingsPanel.textSizeStorageKey, this.textSizeSelect.value);
    setCursorMode(this.cursorSelect.value, { persist: true });
    setControllerLabelStyle(this.controllerLayoutSelect.value, { persist: true });
    setBindings(this.bindings, { persist: true });
    setControllerBindings(this.controllerBindings, { persist: true });
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
