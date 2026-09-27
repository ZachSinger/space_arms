import { DialogueWindow } from "../logic/DialogueWindow.js";

export class GameScene extends Phaser.Scene {
  constructor() {
    super("scene-game");
  }

  preload() {}

  create() {
    this.dialogue = new DialogueWindow({
      onComplete: () => console.log("Dialogue finished"),
    });

    this.dialogue.show(
      "Welcome, dealer. A cargo shuttle will arrive shortly. Review its manifest before accepting delivery.",
    );

    this.events.once("shutdown", () => this.dialogue.destroy());
  }

  update() {}
}
