import Phaser from "phaser";
import { SettingsPanel } from "../logic/SettingsPanel.js";

export class TitleScene extends Phaser.Scene {
  constructor() {
    super("scene-title");
  }

  create() {
    const { width, height } = this.scale;

    this.selectedIndex = 0;
    this.commands = [
      { label: "NEW GAME", action: () => this.scene.start("scene-game") },
      {
        label: "CONTINUE",
        action: () => this.showStatus("NO SAVED GAME FOUND"),
      },
      {
        label: "SETTINGS",
        action: () => this.settingsPanel.open(),
      },
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

      menuItem.on("pointerover", () => this.selectCommand(index));
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
    this.events.once("shutdown", () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      window.removeEventListener(
        "text-size-changed",
        this.handleTextSizeChange,
      );
      this.settingsPanel.destroy();
    });
  }

  handleResize(gameSize) {
    this.layout(gameSize.width, gameSize.height);
  }

  setMenuActive(isActive) {
    this.input.enabled = isActive;
    this.input.keyboard.enabled = isActive;

    if (!isActive) {
      this.selectedIndex = this.commands.findIndex(
        (command) => command.label === "SETTINGS",
      );
      this.updateMenuAppearance();
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

  selectCommand(change) {
    if (typeof change === "number" && Math.abs(change) === 1) {
      this.selectedIndex =
        (this.selectedIndex + change + this.commands.length) %
        this.commands.length;
    } else {
      this.selectedIndex = change;
    }

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
