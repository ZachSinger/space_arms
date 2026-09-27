import Phaser from "phaser";

export class TitleScene extends Phaser.Scene {
  constructor() {
    super("scene-title");
  }

  create() {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2 - 20, "SPACE ARMS DEALER", {
        fontFamily: "monospace",
        fontSize: "32px",
        color: "#e2e8f0",
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 30, "Click or press any key to start", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#94a3b8",
      })
      .setOrigin(0.5);

    this.input.once("pointerdown", () => this.scene.start("scene-game"));
    this.input.keyboard.once("keydown", () => this.scene.start("scene-game"));
  }
}
