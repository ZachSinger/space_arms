// ==========================================
// FILE: Messages.js
// ==========================================
// Everything the shop says to the player outside of menus: the message line at the bottom
// (a short warning, or the current button hint when no warning is showing), text that
// floats up in the map, and the save/load error window.
import { UIWindow } from "../logic/UIWindow.js";

export const SHOP_MESSAGE_COLOR = "#f59e0b";
const HINT_COLOR = "#38bdf8";
const MESSAGE_SHOWN_MS = 2250;
const MESSAGE_FADE_MS = 250;

export class Messages {
  /**
   * @param {object} scene - the shop scene, for map text, pop-up scale, and the windows
   * @param {HTMLElement} element - the message line
   */
  constructor(scene, element) {
    if (!element) throw new Error("Missing game message element");
    this.scene = scene;
    this.element = element;
    this.timeout = null;
    this.warningShowing = false;
    this.hint = "";
    this.saveErrorWindow = null;
    this.retrySave = null;
  }

  /**
   * Shows a temporary message (2250 ms, then a 250 ms fade), after which the current
   * hint returns.
   * @param {string} message
   * @param {string} color - CSS color
   */
  show(message, color = SHOP_MESSAGE_COLOR) {
    const { element } = this;
    clearTimeout(this.timeout);
    this.warningShowing = true;
    element.textContent = message;
    element.style.setProperty("--game-message-color", color);
    element.classList.remove("hidden", "fading", "context-message");
    this.timeout = setTimeout(() => {
      element.classList.add("fading");
      this.timeout = setTimeout(() => {
        this.timeout = null;
        this.warningShowing = false;
        this.renderHint();
      }, MESSAGE_FADE_MS);
    }, MESSAGE_SHOWN_MS);
  }

  setHint(text) {
    this.hint = text;
    this.renderHint();
  }

  renderHint() {
    // Temporary warnings take priority; restore the current hint when they expire.
    if (this.warningShowing) return;
    const { element, hint } = this;
    if (element.textContent !== hint) element.textContent = hint;
    element.style.setProperty("--game-message-color", HINT_COLOR);
    element.classList.remove("fading");
    element.classList.add("context-message");
    element.classList.toggle("crowded", hint.split("\n").length > 3);
    element.classList.toggle("hidden", !hint);
  }

  /**
   * Brief map text. It holds still for 900 ms before floating up and fading over 900 ms,
   * since it spawns where the player is least likely to be looking.
   * @param {number} x - px
   * @param {number} y - px
   * @param {string} text
   * @param {string} color - CSS color
   */
  floatText(x, y, text, color) {
    const { scene } = this;
    scene.debugInfo?.record("game-message", { x, y, text, color });
    const scale = scene.getPopupScale(x, y);
    const label = scene.add
      .text(x, y, text, {
        fontFamily: '"Courier New", monospace',
        fontSize: "18px",
        fontStyle: "bold",
        color,
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(9999)
      .setScale(scale);

    scene.tweens.add({
      targets: label,
      y: y - 36 * scale,
      alpha: 0,
      duration: 900,
      delay: 900,
      ease: "Cubic.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  /**
   * Opens the save/load error window.
   * @param {{ text: string, buttonLabel: string, onButton: () => void }} details
   */
  showSaveError({ text, buttonLabel, onButton }) {
    this.retrySave = onButton;
    if (!this.saveErrorWindow) {
      this.saveErrorWindow = new UIWindow({
        id: "save-error-window", title: "SAVE / LOAD ERROR", width: "400px", height: "auto",
        x: 80, y: 120, shouldCloseOtherWindows: true,
        contentHTML: '<p data-save-error role="alert"></p><button class="action-btn" data-save-retry></button>',
      }, this.scene.windowManager);
      this.saveErrorWindow.element.querySelector("[data-save-retry]")
        .addEventListener("click", () => this.retrySave?.());
    }
    this.saveErrorWindow.element.querySelector("[data-save-error]").textContent = text;
    this.saveErrorWindow.element.querySelector("[data-save-retry]").textContent = buttonLabel;
    this.saveErrorWindow.openWindow();
  }

  closeSaveError() {
    this.saveErrorWindow?.close();
  }

  destroy() {
    clearTimeout(this.timeout);
    this.timeout = null;
    this.element.classList.add("hidden");
  }
}
