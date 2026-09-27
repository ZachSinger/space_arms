import "../../styles/space_dealer_window.css";
import Phaser from "phaser";
import { TitleScene } from "./title.js";
import { GameScene } from "./game.js";
import { BootScene } from "./boot.js";

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
      debug: false, // Toggle to true only when tuning counter or wall hitboxes
    },
  },
  scene: [BootScene, TitleScene, GameScene],
};

new Phaser.Game(config);
