export class SettingsPanel {
  static textSizeStorageKey = "space-arms-dealer.text-size";

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
    this.status = this.element.querySelector(".settings-status");
    SettingsPanel.applyTextSize(SettingsPanel.getSavedTextSize());

    this.element
      .querySelector(".settings-cancel")
      .addEventListener("click", () => this.cancel());

    this.element
      .querySelector(".settings-apply")
      .addEventListener("click", () => this.saveSnapshot());

    this.element
      .querySelector(".settings-accept")
      .addEventListener("click", () => this.close());

    this.select.addEventListener("change", () => this.previewResolution());
    this.displayModeSelect.addEventListener("change", () =>
      this.previewDisplayMode(),
    );
    this.textSizeSelect.addEventListener("change", () =>
      this.previewTextSize(),
    );
  }

  async open() {
    const settings = await window.desktopApi.getDisplaySettings();

    this.settingsSnapshot = {
      resolution: settings.current,
      displayMode: settings.displayMode,
      textSize: SettingsPanel.getSavedTextSize(),
    };
    this.appliedResolution = settings.current;
    this.appliedDisplayMode = settings.displayMode;
    this.displayModeSelect.value = settings.displayMode;
    this.textSizeSelect.value = this.settingsSnapshot.textSize;

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
    this.element.classList.remove("hidden");
    this.onOpen?.();
  }

  close() {
    localStorage.setItem(
      SettingsPanel.textSizeStorageKey,
      this.textSizeSelect.value,
    );
    this.element.classList.add("hidden");
    this.onClose?.();
  }

  destroy() {
    this.element.remove();
  }

  async cancel() {
    const { resolution, displayMode, textSize } = this.settingsSnapshot;

    if (displayMode !== this.appliedDisplayMode) {
      await window.desktopApi.setDisplayMode(displayMode);
    }

    const restored = await window.desktopApi.setResolution(resolution);
    this.appliedResolution = restored;
    this.appliedDisplayMode = displayMode;
    this.textSizeSelect.value = textSize;
    SettingsPanel.applyTextSize(textSize);
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

    const applied = await window.desktopApi.setResolution({ width, height });
    this.appliedResolution = applied;
    this.status.textContent = `CURRENT: ${applied.width} x ${applied.height}`;
  }

  async previewDisplayMode() {
    const mode = this.displayModeSelect.value;

    if (mode === this.appliedDisplayMode) {
      return;
    }

    const settings = await window.desktopApi.setDisplayMode(mode);
    this.appliedDisplayMode = settings.displayMode;
    this.appliedResolution = settings.current;
    this.status.textContent = `CURRENT: ${this.appliedResolution.width} x ${this.appliedResolution.height}`;
  }

  previewTextSize() {
    SettingsPanel.applyTextSize(this.textSizeSelect.value);
  }

  async saveSnapshot() {
    const settings = await window.desktopApi.getDisplaySettings();

    this.settingsSnapshot = {
      resolution: settings.current,
      displayMode: settings.displayMode,
      textSize: this.textSizeSelect.value,
    };
    this.appliedResolution = settings.current;
    this.appliedDisplayMode = settings.displayMode;
    this.status.textContent = `CURRENT: ${settings.current.width} x ${settings.current.height}`;
  }

  static getSavedTextSize() {
    const textSize = localStorage.getItem(SettingsPanel.textSizeStorageKey);
    return SettingsPanel.textSizeScales[textSize] ? textSize : "default";
  }

  static getTextSizeScale(textSize) {
    return Number(SettingsPanel.textSizeScales[textSize]);
  }

  static applyTextSize(textSize) {
    document.documentElement.dataset.textSize = textSize;
    window.dispatchEvent(
      new CustomEvent("text-size-changed", {
        detail: { scale: SettingsPanel.getTextSizeScale(textSize) },
      }),
    );
  }
}
