import { UIWindow } from "./UIWindow.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { validateShopSave } from "./ShopSave.js";
import { database } from "../scenes/boot.js";

export class PauseMenu {
  constructor(shop) {
    this.shop = shop;
    this.destroying = false;
    this.inertBackground = [];
    this.shade = document.createElement("div");
    this.shade.className = "pause-shade hidden";
    document.getElementById("ui-layer").appendChild(this.shade);
    this.uiWindow = new UIWindow({
      id: "pause-menu", title: "PAUSED", width: "360px", height: "auto",
      onClose: () => this.resume(),
      contentHTML: `
        <div class="pause-actions">
          <button class="action-btn" data-pause-action="resume" data-pad-autofocus>Resume</button>
          <button class="action-btn" data-pause-action="save">Save Game</button>
          <button class="action-btn" data-pause-action="load">Load Game</button>
          <button class="action-btn" data-pause-action="settings">Settings</button>
          <button class="action-btn" data-pause-action="menu">Exit to Main Menu</button>
          <button class="action-btn" data-pause-action="desktop">Exit to Desktop</button>
        </div>
        <p class="pause-status" role="status"></p>`,
    }, shop.windowManager);
    this.settings = new SettingsPanel({
      onOpen: () => {
        this.uiWindow.element.classList.add("hidden");
        this.uiWindow.element.classList.remove("active");
      },
      onClose: () => {
        if (!this.isOpen) return;
        this.uiWindow.element.classList.remove("hidden");
        shop.windowManager.focusWindow(this.uiWindow);
      },
    });
    this.confirmation = new UIWindow({
      id: "pause-confirmation", title: "CONFIRM", width: "400px", height: "auto",
      contentHTML: `<p data-pause-warning></p>
        <button class="action-btn" data-pause-confirm>Continue</button>
        <button class="action-btn" data-pause-cancel>Cancel</button>`,
    }, shop.windowManager);
    this.confirmation.element.querySelector("[data-pause-cancel]").addEventListener("click",
      () => this.confirmation.close());
    this.confirmation.element.querySelector("[data-pause-confirm]").addEventListener("click", () => {
      const action = this.confirmedAction;
      this.confirmation.close();
      void this.run(action);
    });
    this.uiWindow.element.addEventListener("click", (event) => {
      const action = event.target.closest("[data-pause-action]")?.dataset.pauseAction;
      if (action) void this.run(() => this.activate(action));
    });
  }

  get isOpen() { return this.uiWindow.isOpen; }

  get settingsOpen() { return !this.settings.element.classList.contains("hidden"); }

  toggle() {
    if (this.settingsOpen) return;
    if (this.confirmation.isOpen) {
      this.confirmation.close();
      return;
    }
    if (this.isOpen) this.uiWindow.close();
    else this.open();
  }

  open() {
    if (this.isOpen) return;
    this.uiWindow.openWindow();
    this.shade.classList.remove("hidden");
    const menuElements = [this.uiWindow.element, this.confirmation.element, this.settings.element, this.shade];
    for (const element of document.getElementById("ui-layer").children) {
      if (menuElements.includes(element) || element.inert) continue;
      element.inert = true;
      this.inertBackground.push(element);
    }
    this.shop.setGamePaused(true);
    if (this.shop.shiftClock.started) {
      this.shop.shiftClock.isPaused = true;
      this.shop.shiftClock.notifyListeners();
    }
    const save = this.uiWindow.element.querySelector('[data-pause-action="save"]');
    save.disabled = !this.shop.saves.canWrite();
    const reason = this.shop.sandbox ? "Saving is unavailable in the test room."
      : "Finish the shift before saving.";
    save.title = save.disabled ? reason : "";
    this.uiWindow.element.querySelector('[data-pause-action="desktop"]').disabled = !window.desktopApi?.quitGame;
    this.status(save.disabled ? reason : "");
    this.uiWindow.element.querySelector('[data-pause-action="resume"]').focus();
    this.shop.controls.uiNavigator?.setHudOpen(false);
  }

  resume() {
    if (this.destroying) return;
    this.confirmation.close();
    this.shade.classList.add("hidden");
    this.restoreBackground();
    this.shop.setGamePaused(false);
    if (this.shop.shiftClock.started) {
      this.shop.shiftClock.isPaused = false;
      this.shop.shiftClock.notifyListeners();
    }
  }

  status(message) {
    this.uiWindow.element.querySelector(".pause-status").textContent = message;
  }

  restoreBackground() {
    this.inertBackground.forEach((element) => { element.inert = false; });
    this.inertBackground = [];
  }

  async run(action) {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
    } catch (error) {
      console.error("Pause menu action failed:", error);
      this.status(error.message);
    } finally {
      this.busy = false;
    }
  }

  confirm(message, action) {
    this.confirmedAction = action;
    this.confirmation.element.querySelector("[data-pause-warning]").textContent = message;
    this.confirmation.openWindow();
  }

  async activate(action) {
    if (action === "resume") this.uiWindow.close();
    else if (action === "save") {
      await this.shop.saves.saveManually();
      this.status(this.shop.saves.status);
    } else if (action === "settings") await this.settings.open();
    else if (action === "load") {
      this.confirm("Load your saved game? Unsaved progress will be lost.", async () => {
        const payload = await this.shop.saves.manager.read();
        if (!payload) throw new Error("No saved game was found.");
        const savedShopData = validateShopSave(payload.data.shop, database);
        this.shop.scene.restart({ savedShopData, real: this.shop.realMode });
      });
    } else if (action === "menu") {
      this.confirm("Exit to the main menu? Unsaved progress will be lost.", () => window.location.reload());
    } else if (action === "desktop") {
      this.confirm("Exit the game? Unsaved progress will be lost.", () => window.desktopApi.quitGame());
    } else {
      throw new RangeError(`Unknown pause menu action: ${action}`);
    }
  }

  destroy() {
    this.destroying = true;
    this.restoreBackground();
    this.shop.setGamePaused(false, { shutdown: true });
    this.settings.destroy();
    this.shade.remove();
  }
}
