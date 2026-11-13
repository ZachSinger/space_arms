// ==========================================
// FILE: main.js
// ==========================================
// Renderer entry point: global styles plus the Phaser game config and scene list.
import "../../styles/space_dealer_window.css";
import Phaser from "phaser";
import { TitleScene } from "./title.js";
import { GameScene } from "./game.js";
import { BootScene } from "./boot.js";
import { ShelfLabScene } from "./shelfLab.js";
import { watchKeyboardAndMouse } from "../logic/InputDevice.js";

// Touching the keyboard or mouse switches on-screen prompts back from controller buttons.
watchKeyboardAndMouse();

const config = {
  type: Phaser.AUTO,
  parent: "game-container",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: "100%",
    height: "100%",
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false, // true only when tuning counter or wall hitboxes
    },
  },
  scene: [BootScene, TitleScene, GameScene, ShelfLabScene],
};

// Exposed for devtools/debugging convenience (e.g. `window.__game.scene.getScene(...)`).
window.__game = new Phaser.Game(config);
