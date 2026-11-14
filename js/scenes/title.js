// ==========================================
// FILE: title.js
// ==========================================
// Title screen scene: New Game / Continue / Settings / Dev menu, driven by mouse or arrow keys.
// Continue loads and validates the saved shop before starting the game scene.
import Phaser from "phaser";
import { SettingsPanel } from "../logic/SettingsPanel.js";
import { UIWindow } from "../logic/UIWindow.js";
import { WindowManager } from "../logic/WindowManager.js";
import { SaveManager } from "../../SaveManager.js";
import { validateShopSave } from "../logic/ShopSave.js";
import { database } from "./boot.js";
import { GamepadInput, PAD } from "../logic/GamepadInput.js";
import { UINavigator } from "../logic/UINavigator.js";
import { setInputDevice } from "../logic/InputDevice.js";

export class TitleScene extends Phaser.Scene {
  constructor() {
    super("scene-title");
  }

  create() {
    const { width, height } = this.scale;

    this.selectedIndex = 0;
    this.loadingSave = false;
    this.saveManager = new SaveManager();
    this.commands = [
      { label: "NEW GAME", action: () => this.confirmNewGame() },
      {
        label: "CONTINUE",
        action: () => this.continueGame(),
      },
      {
        label: "SETTINGS",
        action: () => this.settingsPanel.open(),
      },
      // Developer test harness for crate handling.
      { label: "DEV", action: () => this.scene.start("scene-crate-lab") },
    ];

    this.titleText = this.add
      .text(0, 0, "SPACE ARMS DEALER", {
        fontFamily: "monospace",
        fontSize: "52px",
        color: "#e2e8f0",
      })
      .setOrigin(0.5);

    this.subtitleText = this.add
      .text(0, 0, "LICENSED ARMS DISTRIBUTION TERMINAL", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#94a3b8",
      })
      .setOrigin(0.5);

    this.menuItems = this.commands.map((command, index) => {
      const menuItem = this.add
        .text(0, 0, command.label, {
          fontFamily: "monospace",
          fontSize: "24px",
          color: "#94a3b8",
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      menuItem.on("pointerover", () => this.setSelectedCommand(index));
      menuItem.on("pointerdown", () => this.activateCommand());

      return menuItem;
    });

    this.statusText = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#38bdf8",
      })
      .setOrigin(0.5);

    // Base font sizes (px), scaled by the player's text size setting.
    this.textObjects = [
      { object: this.titleText, fontSize: 52 },
      { object: this.subtitleText, fontSize: 16 },
      ...this.menuItems.map((object) => ({ object, fontSize: 24 })),
      { object: this.statusText, fontSize: 16 },
    ];
    this.applyTextSize(
      SettingsPanel.getTextSizeScale(SettingsPanel.getSavedTextSize()),
    );
    this.handleTextSizeChange = (event) =>
      this.applyTextSize(event.detail.scale);
    window.addEventListener("text-size-changed", this.handleTextSizeChange);

    this.input.keyboard.on("keydown-UP", () => this.selectCommand(-1));
    this.input.keyboard.on("keydown-DOWN", () => this.selectCommand(1));
    this.input.keyboard.on("keydown-ENTER", () => this.activateCommand());

    this.layout(width, height);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.updateMenuAppearance();

    this.settingsPanel = new SettingsPanel({
      onOpen: () => this.setMenuActive(false),
      onClose: () => this.setMenuActive(true),
    });
    this.windowManager = new WindowManager();
    this.newGameWindow = new UIWindow({
      id: "new-game-confirmation", title: "NEW GAME", width: "380px", height: "auto",
      x: 80, y: 120, onClose: () => this.setMenuActive(true),
      contentHTML: `
        <p>Start a new shop? This replaces your existing saved game.</p>
        <button class="action-btn" data-confirm-new-game>START NEW GAME</button>
        <button class="action-btn" data-cancel-new-game>CANCEL</button>
      `,
    }, this.windowManager);
    this.newGameWindow.element.querySelector("[data-confirm-new-game]").addEventListener("click", () => {
      this.newGameWindow.close();
      this.scene.start("scene-game");
    });
    this.newGameWindow.element.querySelector("[data-cancel-new-game]").addEventListener("click", () => this.newGameWindow.close());
    this.padInput = new GamepadInput();
    this.uiNavigator = new UINavigator();
    this.events.once("shutdown", () => {
      this.uiNavigator.destroy();
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      window.removeEventListener(
        "text-size-changed",
        this.handleTextSizeChange,
      );
      this.settingsPanel.destroy();
      this.windowManager.destroy();
    });
  }

  handleResize(gameSize) {
    this.layout(gameSize.width, gameSize.height);
  }

  // Controller: up/down picks a menu entry and A or Start chooses it; open windows get the menu cursor.
  update(time, delta) {
    const pad = this.padInput;
    pad.poll(time);
    if (pad.hadInput) setInputDevice("gamepad");
    if (this.uiNavigator.handle(pad, delta)) return;
    if (!this.input.keyboard.enabled) return;
    if (pad.navDirection === "up") this.selectCommand(-1);
    else if (pad.navDirection === "down") this.selectCommand(1);
    if (pad.justPressed(PAD.A) || pad.justPressed(PAD.START)) this.activateCommand();
  }

  /**
   * Block menu input while a DOM window (settings, confirmation) is open on top.
   * @param {boolean} isActive
   */
  setMenuActive(isActive) {
    this.input.enabled = isActive;
    this.input.keyboard.enabled = isActive;
  }

  confirmNewGame() {
    if (this.loadingSave) return;
    this.setMenuActive(false);
    this.newGameWindow.openWindow();
  }

  // Load the save and start the game with it; any failure stays on the title with a message.
  async continueGame() {
    if (this.loadingSave) return;
    this.loadingSave = true;
    this.setMenuActive(false);
    this.showStatus("LOADING SAVED GAME...");
    try {
      const payload = await this.saveManager.read();
      if (payload === null) {
        this.showStatus("NO SAVED GAME FOUND");
        return;
      }
      const savedShopData = validateShopSave(payload.data.shop, database);
      this.scene.start("scene-game", { savedShopData });
    } catch (error) {
      console.error("Could not load saved game", error);
      this.showStatus(`LOAD FAILED: ${error.message}`);
    } finally {
      this.loadingSave = false;
      this.setMenuActive(true);
    }
  }

  layout(width, height) {
    this.titleText.setPosition(width / 2, height / 2 - 150);
    this.subtitleText.setPosition(width / 2, height / 2 - 95);

    this.menuItems.forEach((menuItem, index) => {
      menuItem.setPosition(width / 2, height / 2 + index * 48);
    });

    this.statusText.setPosition(width / 2, height / 2 + 175);
  }

  /**
   * Move the menu selection, wrapping at both ends.
   * @param {number} change - +1 down, -1 up
   */
  selectCommand(change) {
    this.setSelectedCommand(
      (this.selectedIndex + change + this.commands.length) % this.commands.length,
    );
  }

  setSelectedCommand(index) {
    this.selectedIndex = index;
    this.updateMenuAppearance();
  }

  activateCommand() {
    this.commands[this.selectedIndex].action();
  }

  updateMenuAppearance() {
    this.menuItems.forEach((menuItem, index) => {
      const isSelected = index === this.selectedIndex;

      menuItem.setText(
        `${isSelected ? "> " : "  "}${this.commands[index].label}`,
      );
      menuItem.setColor(isSelected ? "#38bdf8" : "#94a3b8");
    });
  }

  applyTextSize(scale) {
    this.textObjects.forEach(({ object, fontSize }) =>
      object.setFontSize(fontSize * scale),
    );
  }

  showStatus(message) {
    this.statusText.setText(message);
  }
}
