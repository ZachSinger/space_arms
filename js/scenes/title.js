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

    this.add
      .text(width / 2, height / 2 - 150, "SPACE ARMS DEALER", {
        fontFamily: "monospace",
        fontSize: "52px",
        color: "#e2e8f0",
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 - 95, "LICENSED ARMS DISTRIBUTION TERMINAL", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#94a3b8",
      })
      .setOrigin(0.5);

    this.menuItems = this.commands.map((command, index) => {
      const menuItem = this.add
        .text(width / 2, height / 2 + index * 48, command.label, {
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
      .text(width / 2, height / 2 + 175, "", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#38bdf8",
      })
      .setOrigin(0.5);

    this.input.keyboard.on("keydown-UP", () => this.selectCommand(-1));
    this.input.keyboard.on("keydown-DOWN", () => this.selectCommand(1));
    this.input.keyboard.on("keydown-ENTER", () => this.activateCommand());

    this.updateMenuAppearance();

    this.settingsPanel = new SettingsPanel();
    this.events.once("shutdown", () => this.settingsPanel.destroy());
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

  showStatus(message) {
    this.statusText.setText(message);
  }
}
