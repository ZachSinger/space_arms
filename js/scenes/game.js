import { DialogueWindow } from "../logic/DialogueWindow.js";
import { WindowManager } from "../logic/WindowManager.js";
import { UIWindow } from "../logic/UIWindow.js";
import { InventoryRenderer } from "../logic/InventoryRenderer.js";
import { database } from "./boot.js"; // the exported DatabaseManager singleton

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

    this.windowManager = new WindowManager();
    this.inventoryWindow = new UIWindow(
      {
        id: "inventory-window",
        title: "INVENTORY DATABASE",
        contentHTML: InventoryRenderer.generateHTML(database),
        width: "40vw",
        height: "60vh",
        x: 60,
        y: 60,
      },
      this.windowManager,
    );
    this.disableInventoryNavigation = InventoryRenderer.enableListNavigation(
      this.inventoryWindow.element,
    );

    this.input.keyboard.on("keydown-I", () =>
      this.inventoryWindow.openWindow(),
    );

    this.events.once("shutdown", () => {
      this.dialogue.destroy();
      this.disableInventoryNavigation();
    });
  }

  update() {}
}
