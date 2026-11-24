// ==========================================
// FILE: main.js
// ==========================================
// Renderer entry point: global styles plus the Phaser game config and scene list.
import "../../styles/tokens.css";
import "../../styles/windows/shelf-stocking.css";
import "../../styles/space_dealer_window.css";
import "../../styles/windows/hud.css";
import "../../styles/windows/remote-orders.css";
import "../../styles/windows/tutorial.css";
import "../../styles/windows/settings.css";
import "../../styles/windows/pause.css";
import "../../styles/windows/checkout.css";
import "../../styles/windows/contracts.css";
import "../../styles/windows/employee.css";
import "../../styles/windows/fixture-layout.css";
import "../../styles/windows/finances.css";
import "../../styles/windows/handbook.css";
import "../../styles/windows/inventory.css";
import "../../styles/windows/reviews.css";
import "../../styles/windows/supply.css";
import Phaser from "phaser";
import { TitleScene } from "./title.js";
import { GameScene } from "./game.js";
import { BootScene } from "./boot.js";
import { ShelfLabScene } from "./shelfLab.js";
import { CrateLabScene } from "./crateLab.js";
import { ShelfCollisionLabScene } from "./shelfCollisionLab.js";
import { DeliveryCrateLabScene } from "./deliveryCrateLab.js";
import { watchKeyboardAndMouse } from "../input/InputDevice.js";
import { installGameCursor } from "../logic/GameCursor.js";
import { ErrorReportPrompt } from "../debug/ErrorReportPrompt.js";
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  applyGameRenderResolution,
  resizeGameContainer,
  setGameDisplaySettings,
} from "../logic/GameViewport.js";

// Touching the keyboard or mouse switches on-screen prompts back from controller buttons.
watchKeyboardAndMouse();
const errorReportPrompt = new ErrorReportPrompt(window);
window.__earlyErrorCapture?.();
window.addEventListener("beforeunload", () => errorReportPrompt.destroy(), { once: true });
const removeGameCursor = installGameCursor();
window.addEventListener("beforeunload", removeGameCursor, { once: true });

const gameContainer = document.getElementById("game-container");
let game;
const resizeViewport = () => {
  resizeGameContainer(gameContainer);
  if (game?.canvas) {
    game.scale.refresh();
    applyGameRenderResolution(game);
  }
};
resizeViewport();
window.addEventListener("resize", resizeViewport);
window.addEventListener("game-viewport-changed", resizeViewport);

const config = {
  type: Phaser.AUTO,
  parent: gameContainer,
  scale: {
    mode: Phaser.Scale.NONE,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false, // true only when tuning counter or wall hitboxes
    },
  },
  scene: [BootScene, TitleScene, GameScene, ShelfLabScene, CrateLabScene, ShelfCollisionLabScene, DeliveryCrateLabScene],
};

// Exposed for devtools/debugging convenience (e.g. `window.__game.scene.getScene(...)`).
window.__game = game = new Phaser.Game(config);
game.events.once("ready", () => applyGameRenderResolution(game));
if (window.desktopApi) {
  window.desktopApi.getDisplaySettings()
    .then(setGameDisplaySettings)
    .catch((error) => console.error("Could not load display settings:", error));
}
