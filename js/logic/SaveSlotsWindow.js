import { UIWindow } from "./UIWindow.js";
import { html } from "../core/html.js";
import { validateSaveName } from "../../SaveManager.js";

export function formatPlayTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const count = (value, unit) => `${value} ${unit}${value === 1 ? "" : "s"}`;
  if (minutes === 0) return count(seconds, "second");
  if (hours === 0) return count(minutes, "minute");
  return `${count(hours, "hour")} ${count(minutes % 60, "minute")}`;
}

export class SaveSlotsWindow {
  constructor(manager, { id, saves, onLoad, onSave, onClose }) {
    this.saves = saves;
    this.onLoad = onLoad;
    this.onSave = onSave;
    this.mode = "load";
    this.busy = false;
    this.uiWindow = new UIWindow({
      id, title: "LOAD GAME", width: "660px", height: "auto", x: 620, y: 170,
      onClose: () => {
        this.confirmation.close();
        onClose?.();
      },
      contentHTML: `
        <div class="save-slots">
          <p data-save-help></p>
          <div class="save-slot-list" data-save-list></div>
          <div class="save-slot-create" data-save-create>
            <button class="action-btn" data-save-new>CREATE NEW SAVE</button>
          </div>
          <p class="save-slot-status" data-save-status role="status" aria-live="polite"></p>
        </div>`,
    }, manager);
    this.confirmation = new UIWindow({
      id: `${id}-confirmation`, title: "CONFIRM", width: "440px", height: "auto", x: 730, y: 320,
      onClose: () => {
        if (this.uiWindow.isOpen) manager.focusWindow(this.uiWindow);
      },
      contentHTML: `
        <p data-save-warning></p>
        <label data-save-name-label>Enter a save file name <input data-save-name maxlength="40"></label>
        <p data-save-confirm-status role="status"></p>
        <button class="action-btn" data-save-confirm></button>
        <button class="action-btn" data-save-cancel>CANCEL</button>`,
    }, manager);
    this.uiWindow.element.addEventListener("click", (event) => {
      const card = event.target.closest("button[data-save-slot]");
      if (card) void this.run(() => this.select(card.dataset.saveSlot));
    });
    this.uiWindow.element.querySelector("[data-save-new]").addEventListener("click", () => {
      this.confirm("Enter a name for your new save.", async () => {
        const name = validateSaveName(this.confirmation.element.querySelector("[data-save-name]").value);
        if (!await this.onSave({ slotId: null, name })) {
          throw new Error("Save failed. Your previous saves are unchanged.");
        }
        this.confirmation.close();
        this.uiWindow.close();
      }, { title: "NEW SAVE", button: "CREATE SAVE", name: "" });
    });
    this.confirmation.element.querySelector("[data-save-cancel]").addEventListener("click", () => this.confirmation.close());
    this.confirmation.element.querySelector("[data-save-confirm]").addEventListener("click", () => {
      const nameLabel = this.confirmation.element.querySelector("[data-save-name-label]");
      if (!nameLabel.hidden) {
        try {
          validateSaveName(this.confirmation.element.querySelector("[data-save-name]").value);
        } catch (error) {
          this.status(error.message);
          this.confirmation.element.querySelector("[data-save-name]").focus();
          return;
        }
      }
      void this.run(() => this.confirmedAction());
    });
    this.confirmation.element.querySelector("[data-save-name]").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.confirmation.element.querySelector("[data-save-confirm]").click();
      }
    });
  }

  async open(mode) {
    this.mode = mode;
    this.uiWindow.element.querySelector(".retro-window-title").textContent = mode === "save" ? "SAVE GAME" : "LOAD GAME";
    this.uiWindow.element.querySelector("[data-save-create]").hidden = mode !== "save";
    this.uiWindow.element.querySelector("[data-save-help]").textContent = mode === "save" ? "Save Game" : "Load Game";
    this.uiWindow.openWindow();
    await this.run(() => this.refresh());
  }

  status(message) {
    this.uiWindow.element.querySelector("[data-save-status]").textContent = message;
    this.confirmation.element.querySelector("[data-save-confirm-status]").textContent = message;
  }

  async run(action) {
    if (this.busy) return;
    this.busy = true;
    this.uiWindow.closable = false;
    this.confirmation.closable = false;
    const buttons = [...this.uiWindow.element.querySelectorAll("button"), ...this.confirmation.element.querySelectorAll("button")]
      .map((button) => [button, button.disabled]);
    for (const [button] of buttons) button.disabled = true;
    this.status("");
    try {
      await action();
    } catch (error) {
      console.error("Save selection failed:", error);
      this.status(error.message);
    } finally {
      for (const [button, disabled] of buttons) button.disabled = disabled;
      this.uiWindow.closable = true;
      this.confirmation.closable = true;
      this.busy = false;
    }
  }

  async refresh() {
    this.slots = await this.saves.list();
    this.uiWindow.element.querySelector("[data-save-list]").innerHTML = this.slots.length
      ? this.slots.map((slot) => {
        const date = new Date(slot.lastPlayedAt);
        const dateText = `${date.toLocaleDateString("en-US")} ${date.toLocaleTimeString("en-US", {
          hour: "numeric", minute: "2-digit",
        })}`;
        return String(html`
          <button type="button" class="save-slot" data-save-slot="${slot.slotId}" data-pad-autofocus>
            <strong>${slot.name}</strong>
            <span>Last played: <time datetime="${date.toISOString()}">${dateText}</time></span>
            <span>Total play time: ${formatPlayTime(slot.playTimeMs)}</span>
          </button>`);
      }).join("")
      : '<p class="save-slot-empty">No saved shops yet.</p>';
  }

  confirm(message, action, { title = "CONFIRM", button = "CONFIRM", name = null } = {}) {
    this.confirmedAction = action;
    this.confirmation.element.querySelector(".retro-window-title").textContent = title;
    this.confirmation.element.querySelector("[data-save-warning]").textContent = message;
    this.confirmation.element.querySelector("[data-save-confirm-status]").textContent = "";
    this.confirmation.element.querySelector("[data-save-confirm]").textContent = button;
    const label = this.confirmation.element.querySelector("[data-save-name-label]");
    label.hidden = name === null;
    if (name !== null) this.confirmation.element.querySelector("[data-save-name]").value = name;
    this.confirmation.openWindow();
    this.confirmation.element.querySelector(name === null ? "[data-save-confirm]" : "[data-save-name]").focus();
  }

  async select(slotId) {
    const slot = this.slots.find((entry) => entry.slotId === slotId);
    if (!slot) throw new Error("That save no longer exists.");
    if (this.mode === "load") {
      const load = async () => {
        const payload = await this.saves.read(slotId);
        await this.onLoad(payload);
        this.confirmation.close();
        this.uiWindow.close();
      };
      if (this.onSave) {
        this.confirm(`Load "${slot.name}"? Unsaved shop progress will be lost.`, load, {
          title: "LOAD SAVE", button: "LOAD",
        });
      } else {
        await load();
      }
      return;
    }
    this.confirm(`Overwrite "${slot.name}"? Its saved progress will be replaced.`, async () => {
      if (!await this.onSave({ slotId })) {
        throw new Error("Save failed. Your previous saves are unchanged.");
      }
      this.confirmation.close();
      this.uiWindow.close();
    }, { title: "OVERWRITE SAVE", button: "OVERWRITE" });
  }

  destroy() {
    this.uiWindow.onClose = null;
    this.uiWindow.close();
    this.confirmation.close();
  }
}
