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
            <label>New save name (optional) <input data-save-name maxlength="40" placeholder="Automatic name if left empty"></label>
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
        <label data-save-rename-label>Save name <input data-save-rename maxlength="40"></label>
        <p data-save-confirm-status role="status"></p>
        <button class="action-btn" data-save-confirm>CONFIRM</button>
        <button class="action-btn" data-save-cancel>CANCEL</button>`,
    }, manager);
    this.uiWindow.element.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-slot-action]");
      if (button) void this.run(() => this.select(button.dataset.slotAction, button.dataset.slotId));
    });
    this.uiWindow.element.querySelector("[data-save-new]").addEventListener("click", () => {
      void this.run(async () => {
        const value = this.uiWindow.element.querySelector("[data-save-name]").value;
        const name = value.trim() ? validateSaveName(value) : undefined;
        if (await this.onSave({ slotId: null, name })) this.uiWindow.close();
        else this.status("Save failed. Your previous saves are unchanged.");
      });
    });
    this.confirmation.element.querySelector("[data-save-cancel]").addEventListener("click", () => this.confirmation.close());
    this.confirmation.element.querySelector("[data-save-confirm]").addEventListener("click", () => {
      void this.run(async () => {
        await this.confirmedAction();
        this.confirmation.close();
      });
    });
  }

  async open(mode) {
    this.mode = mode;
    this.uiWindow.element.querySelector(".retro-window-title").textContent = mode === "save" ? "SAVE GAME" : "LOAD GAME";
    this.uiWindow.element.querySelector("[data-save-create]").hidden = mode !== "save";
    this.uiWindow.element.querySelector("[data-save-help]").textContent = mode === "save"
      ? "Save to your current save, create a separate copy, or replace another saved shop. Autosaves follow the save you choose."
      : "Choose a saved shop. Each save has its own progress.";
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
        const current = slot.slotId === this.saves.slotId;
        const date = new Date(slot.lastPlayedAt);
        return String(html`
          <article class="save-slot${current ? " current-save" : ""}">
            <h3>${slot.name}${current ? " (current save)" : ""}</h3>
            <p>Last played: <time datetime="${date.toISOString()}">${date.toLocaleString()}</time></p>
            <p>Total play time: ${formatPlayTime(slot.playTimeMs)}</p>
            <div class="save-slot-actions">
              <button class="action-btn" data-slot-action="select" data-slot-id="${slot.slotId}" data-pad-autofocus>${this.mode === "load" ? "LOAD" : "SAVE HERE"}</button>
              <button class="action-btn" data-slot-action="rename" data-slot-id="${slot.slotId}">RENAME</button>
              <button class="action-btn" data-slot-action="delete" data-slot-id="${slot.slotId}" ${current ? html`disabled title="Return to the title screen to delete the shop you are playing."` : ""}>DELETE</button>
            </div>
          </article>`);
      }).join("")
      : '<p class="save-slot-empty">No saved shops yet. Start a new game to create one.</p>';
  }

  confirm(message, action, name = null) {
    this.confirmedAction = action;
    this.confirmation.element.querySelector("[data-save-warning]").textContent = message;
    this.confirmation.element.querySelector("[data-save-confirm-status]").textContent = "";
    const label = this.confirmation.element.querySelector("[data-save-rename-label]");
    label.hidden = name === null;
    if (name !== null) this.confirmation.element.querySelector("[data-save-rename]").value = name;
    this.confirmation.openWindow();
    this.confirmation.element.querySelector(name === null ? "[data-save-confirm]" : "[data-save-rename]").focus();
  }

  async select(action, slotId) {
    const slot = this.slots.find((entry) => entry.slotId === slotId);
    if (!slot) throw new Error("That save no longer exists.");
    if (action === "rename") {
      this.confirm(`Rename "${slot.name}".`, async () => {
        await this.saves.rename(slotId, this.confirmation.element.querySelector("[data-save-rename]").value);
        await this.refresh();
      }, slot.name);
    } else if (action === "delete") {
      this.confirm(`Permanently delete "${slot.name}"? This cannot be undone.`, async () => {
        await this.saves.delete(slotId);
        await this.refresh();
      });
    } else if (action === "select" && this.mode === "load") {
      const load = async () => {
        const payload = await this.saves.read(slotId);
        await this.onLoad(payload);
        this.uiWindow.close();
      };
      if (this.onSave) this.confirm(`Load "${slot.name}"? Unsaved shop progress will be lost.`, load);
      else await load();
    } else if (action === "select") {
      const save = async () => {
        if (!await this.onSave({ slotId })) throw new Error("Save failed. Your previous saves are unchanged.");
        this.uiWindow.close();
      };
      if (slotId === this.saves.slotId) await save();
      else this.confirm(`Replace "${slot.name}" with your current shop? Its previous progress will be lost.`, save);
    } else {
      throw new Error(`Unknown save action: ${action}.`);
    }
  }

  destroy() {
    this.uiWindow.onClose = null;
    this.uiWindow.close();
    this.confirmation.close();
  }
}
