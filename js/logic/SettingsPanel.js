export class SettingsPanel {
  constructor() {
    this.element = document.createElement("div");
    this.element.className = "retro-window settings-window hidden";
    this.element.innerHTML = `
      <div class="settings-content">
        <div class="settings-title">SETTINGS</div>
        <label class="settings-field">
          <span>RESOLUTION</span>
          <select class="settings-resolution"></select>
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
    this.status = this.element.querySelector(".settings-status");

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
  }

  async open() {
    const settings = await window.desktopApi.getDisplaySettings();

    this.settingsSnapshot = {
      resolution: settings.current,
    };
    this.appliedResolution = settings.current;

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
  }

  async apply() {
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

  close() {
    this.element.classList.add("hidden");
  }

  destroy() {
    this.element.remove();
  }

  async cancel() {
    const { width, height } = this.settingsSnapshot.resolution;

    if (
      width !== this.appliedResolution.width ||
      height !== this.appliedResolution.height
    ) {
      const restored = await window.desktopApi.setResolution({ width, height });
      this.appliedResolution = restored;
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

    const applied = await window.desktopApi.setResolution({ width, height });
    this.appliedResolution = applied;
    this.status.textContent = `CURRENT: ${applied.width} x ${applied.height}`;
  }

  async saveSnapshot() {
    const settings = await window.desktopApi.getDisplaySettings();

    this.settingsSnapshot = {
      resolution: settings.current,
    };
    this.appliedResolution = settings.current;
    this.status.textContent = `CURRENT: ${settings.current.width} x ${settings.current.height}`;
  }
}
