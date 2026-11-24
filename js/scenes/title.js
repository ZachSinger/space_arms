// ==========================================
// FILE: title.js
// ==========================================
// Title screen scene: New Game / Continue / Settings / Dev menu, driven by mouse or arrow keys.
// Continue loads and validates the saved shop before starting the game scene.
import Phaser from "phaser";
import { SettingsPanel } from "../logic/SettingsPanel.js";
import { installSceneTextSize } from "../logic/GameTextSize.js";
import { UIWindow } from "../logic/UIWindow.js";
import { WindowManager } from "../logic/WindowManager.js";
import { SaveManager } from "../../SaveManager.js";
import { validateShopSave } from "../logic/ShopSave.js";
import { database } from "./boot.js";
import { GamepadInput } from "../input/GamepadInput.js";
import { UINavigator } from "../logic/UINavigator.js";
import { setInputDevice } from "../input/InputDevice.js";
import { showLoadingThen, hideLoadingScreen } from "./loadingScreen.js";

export class TitleScene extends Phaser.Scene {
  constructor() {
    super("scene-title");
  }

  create() {
    this.startingGame = false;
    hideLoadingScreen();
    installSceneTextSize(this, Phaser);
    const { width, height } = this.scale;

    this.selectedIndex = 0;
    this.loadingSave = false;
    this.saveManager = new SaveManager();
    this.commands = [
      // A clean playthrough: starts fresh right away and the game hides every debug tool.
      { label: "REAL", action: () => this.startRealGame() },
      { label: "NEW GAME", action: () => this.confirmNewGame() },
      {
        label: "CONTINUE",
        action: () => this.continueGame(),
      },
      { label: "JOIN A FRIEND", action: () => this.openJoinWindow() },
      {
        label: "SETTINGS",
        action: () => this.settingsPanel.open(),
      },
      // Developer test areas: the crate lab or the Shelf Test Room.
      { label: "DEV", action: () => this.openDevChooser() },
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
      this.startGameScene();
    });
    this.newGameWindow.element.querySelector("[data-cancel-new-game]").addEventListener("click", () => this.newGameWindow.close());
    this.devWindow = new UIWindow({
      id: "dev-area-chooser", title: "DEV", width: "380px", height: "auto",
      x: 80, y: 120, onClose: () => this.setMenuActive(true),
      contentHTML: `
        <p>Pick a test area. Nothing you do in any of them is saved, except the Snapshot button in Starting Template.</p>
        <button class="action-btn" data-dev-crate-lab>CRATE LAB</button>
        <button class="action-btn" data-dev-delivery-crate-lab>DELIVERY CRATE LAB</button>
        <button class="action-btn" data-dev-shelf-collision-lab>SHELF COLLISION LAB</button>
        <button class="action-btn" data-dev-shelf-room>SHELF TEST ROOM</button>
        <button class="action-btn" data-dev-ui-lab>UI LAB</button>
        <button class="action-btn" data-dev-starting-template>STARTING TEMPLATE</button>
        <button class="action-btn" data-dev-decorator>DECORATOR MODE</button>
        <button class="action-btn" data-dev-decoration-gallery>DECORATION GALLERY</button>
        <button class="action-btn" data-dev-tutorial>FIRST DAY TUTORIAL</button>
        <button class="action-btn" data-dev-crate-test>CRATE TEST ROOM</button>
        <button class="action-btn" data-dev-cancel>CANCEL</button>
      `,
    }, this.windowManager);
    const devButton = (selector, handler) =>
      this.devWindow.element.querySelector(selector).addEventListener("click", handler);
    devButton("[data-dev-crate-lab]", () => {
      this.devWindow.close();
      this.scene.start("scene-crate-lab");
    });
    devButton("[data-dev-delivery-crate-lab]", () => {
      this.devWindow.close();
      this.scene.start("scene-delivery-crate-lab");
    });
    devButton("[data-dev-shelf-collision-lab]", () => {
      this.devWindow.close();
      this.scene.start("scene-shelf-collision-lab");
    });
    devButton("[data-dev-shelf-room]", () => {
      this.devWindow.close();
      this.startGameScene({ sandbox: true });
    });
    devButton("[data-dev-ui-lab]", () => {
      this.devWindow.close();
      this.startGameScene({ sandbox: true, lab: "ui" });
    });
    devButton("[data-dev-starting-template]", () => {
      this.devWindow.close();
      this.startGameScene({ sandbox: true, lab: "template" });
    });
    devButton("[data-dev-decorator]", () => {
      this.devWindow.close();
      this.startGameScene({ sandbox: true, lab: "decorator" });
    });
    devButton("[data-dev-decoration-gallery]", () => {
      this.devWindow.close();
      this.startGameScene({ sandbox: true, lab: "decorations" });
    });
    devButton("[data-dev-tutorial]", () => {
      this.devWindow.close();
      this.startGameScene({ sandbox: true, lab: "tutorial" });
    });
    devButton("[data-dev-crate-test]", () => {
      this.devWindow.close();
      this.startGameScene({ sandbox: true, lab: "crates" });
    });
    devButton("[data-dev-cancel]", () => this.devWindow.close());
    this.buildJoinWindow();
    this.padInput = new GamepadInput();
    this.uiNavigator = new UINavigator();
    this.events.once("shutdown", () => {
      this.uiNavigator.destroy();
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.settingsPanel.destroy();
      this.windowManager.destroy();
    });
    // Accepting a Steam invite can happen on any screen; this game may already be joined.
    void window.desktopApi?.coop?.status().then((status) => {
      if (status.role === "friend" && this.scene.isActive()) this.scene.start("scene-coop-friend");
    });
  }

  buildJoinWindow() {
    this.joinWindow = new UIWindow({
      id: "coop-join", title: "JOIN A FRIEND", width: "420px", height: "auto",
      x: 80, y: 120, onClose: () => this.setMenuActive(true),
      contentHTML: `
        <div class="coop-join-form">
          <p>You'll walk around your friend's shop as the red shopkeeper.</p>
          <p>Playing on Steam: keep this screen open and accept your friend's invite in Steam. You'll join on your own.</p>
          <p>On the same home network without Steam: type the address your friend's pause menu shows.</p>
          <input type="text" data-coop-address placeholder="Address, like 192.168.1.20" spellcheck="false">
          <div class="coop-join-status" data-coop-join-status></div>
          <button class="action-btn" data-coop-join>JOIN</button>
          <button class="action-btn" data-coop-join-cancel>CANCEL</button>
        </div>
      `,
    }, this.windowManager);
    const element = this.joinWindow.element;
    const status = element.querySelector("[data-coop-join-status]");
    const join = element.querySelector("[data-coop-join]");
    element.querySelector("[data-coop-join-cancel]").addEventListener("click", () => this.joinWindow.close());
    join.addEventListener("click", async () => {
      const address = element.querySelector("[data-coop-address]").value.trim();
      if (!address) {
        status.textContent = "Type your friend's address first.";
        return;
      }
      join.disabled = true;
      status.textContent = "Joining...";
      try {
        const result = await window.desktopApi.coop.joinAddress(address);
        if (result.role === "friend") {
          this.joinWindow.close();
          if (this.scene.isActive()) this.scene.start("scene-coop-friend");
          return;
        }
        status.textContent = "Couldn't reach that address. Check it, and make sure your friend picked Invite a Friend.";
      } catch (error) {
        console.error("Could not join a friend:", error);
        status.textContent = "Couldn't reach that address. Check it, and make sure your friend picked Invite a Friend.";
      } finally {
        join.disabled = false;
      }
    });
  }

  openJoinWindow() {
    if (this.loadingSave) return;
    if (!window.desktopApi?.coop) {
      this.showStatus("PLAYING WITH A FRIEND NEEDS THE DESKTOP GAME");
      return;
    }
    this.setMenuActive(false);
    this.joinWindow.openWindow();
  }

  handleResize(gameSize) {
    this.layout(gameSize.width, gameSize.height);
  }

  // Controller: up/down picks a menu entry and A or Start chooses it; open windows get the menu cursor.
  update(time, delta) {
    const pad = this.padInput;
    pad.poll(time);
    if (pad.hadInput) setInputDevice("gamepad");
    if (this.settingsPanel.isCapturingController) {
      for (const button of pad.pressed) this.settingsPanel.captureControllerButton(button);
      return;
    }
    if (this.uiNavigator.handle(pad, delta)) return;
    if (!this.input.keyboard.enabled) return;
    if (pad.navDirection === "up") this.selectCommand(-1);
    else if (pad.navDirection === "down") this.selectCommand(1);
    if (pad.justPressedAction("interact") || pad.justPressedAction("pause")) this.activateCommand();
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

  // REAL skips the save-overwrite question and starts a debug-free fresh game.
  startRealGame() {
    if (this.loadingSave) return;
    this.startGameScene({ real: true });
  }

  /** @param {object} [data] - passed to the game scene's init */
  startGameScene(data) {
    if (this.startingGame) return;
    this.startingGame = true;
    this.setMenuActive(false);
    showLoadingThen(() => this.scene.start("scene-game", data));
  }

  openDevChooser() {
    if (this.loadingSave) return;
    this.setMenuActive(false);
    this.devWindow.openWindow();
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
      this.startGameScene({ savedShopData });
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

    this.statusText.setPosition(width / 2, height / 2 + this.menuItems.length * 48 + 10);
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

  showStatus(message) {
    this.statusText.setText(message);
  }
}
