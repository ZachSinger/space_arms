// ==========================================
// FILE: steam.js
// ==========================================
// Main-process Steam connection. Only starts when the game is launched with `--steam`
// (`npm run start:steam`), so normal development runs never touch Steam.
//
// Until the game has its own Steam app ID, this uses Valve's public test app, Spacewar (480).
// Steam will show the player as "playing Spacewar" while testing.
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const SPACEWAR_APP_ID = 480;
const REPAINT_INTERVAL_MS = 1000 / 60;

export function isSteamRequested() {
  return process.argv.includes("--steam") || process.env.SPACE_ARMS_STEAM === "1";
}

/**
 * Connect to Steam and prepare Electron for the Shift+Tab overlay. Must run before the app is
 * ready, because the overlay hooks the graphics device when it is created.
 * @param {import("electron").App} app
 */
export function startSteam(app) {
  if (!isSteamRequested()) return null;
  try {
    const steamworks = require("steamworks.js");
    const client = steamworks.init(SPACEWAR_APP_ID);
    // Steam injects its overlay into this process, so draw the game here too.
    app.commandLine.appendSwitch("in-process-gpu");
    // The overlay needs a full frame every frame, but Chromium only repaints changed areas.
    app.on("browser-window-created", (_event, win) => {
      const timer = setInterval(() => {
        if (win.isDestroyed()) clearInterval(timer);
        else win.webContents.invalidate();
      }, REPAINT_INTERVAL_MS);
    });
    console.log(`Steam connected as ${client.localplayer.getName()}.`);
    return client;
  } catch (error) {
    console.error("Steam could not start:", error);
    return null;
  }
}
