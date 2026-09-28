import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

// ES6 Module fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMMON_RESOLUTIONS = [
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];

function getDisplaySettings(win) {
  const display = screen.getDisplayMatching(win.getBounds());
  const [width, height] = win.getContentSize();
  const resolutions = [...COMMON_RESOLUTIONS, { width, height }]
    .filter(
      (resolution) =>
        resolution.width <= display.workAreaSize.width &&
        resolution.height <= display.workAreaSize.height,
    )
    .filter(
      (resolution, index, list) =>
        list.findIndex(
          (candidate) =>
            candidate.width === resolution.width &&
            candidate.height === resolution.height,
        ) === index,
    )
    .sort((first, second) => first.width - second.width);

  return {
    current: { width, height },
    resolutions,
    displayMode: getDisplayMode(win),
  };
}

const displayModes = new WeakMap();

function getDisplayMode(win) {
  return displayModes.get(win) ?? "windowed";
}

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  displayModes.set(win, "fullscreen");
  win.loadURL("http://localhost:5173");
};

ipcMain.handle("display:get-settings", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return getDisplaySettings(win);
});

ipcMain.handle("display:set-resolution", (event, resolution) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const display = screen.getDisplayMatching(win.getBounds());
  const isAvailable =
    Number.isInteger(resolution.width) &&
    Number.isInteger(resolution.height) &&
    resolution.width > 0 &&
    resolution.height > 0 &&
    resolution.width <= display.workAreaSize.width &&
    resolution.height <= display.workAreaSize.height;

  if (!isAvailable) {
    throw new Error("Unsupported resolution");
  }

  win.setContentSize(resolution.width, resolution.height);
  const [width, height] = win.getContentSize();
  return { width, height };
});

ipcMain.handle("display:set-mode", (event, mode) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  if (!["windowed", "borderless", "fullscreen"].includes(mode)) {
    throw new Error("Unsupported display mode");
  }

  if (mode === "windowed") {
    win.setKiosk(false);
    win.setFullScreen(false);
  }

  if (mode === "borderless") {
    win.setFullScreen(false);
    win.setKiosk(true);
  }

  if (mode === "fullscreen") {
    win.setKiosk(false);
    win.setFullScreen(true);
  }

  displayModes.set(win, mode);
  return getDisplaySettings(win);
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

const SAVE_FILE_PATH = path.join(app.getPath("userData"), "savegame.json");

ipcMain.handle("save:write", async (event, payload) => {
  // fixed filename under userData avoids any path-traversal from renderer input
  await fs.writeFile(SAVE_FILE_PATH, JSON.stringify(payload), "utf-8");
  return true;
});

ipcMain.handle("save:read", async () => {
  try {
    const raw = await fs.readFile(SAVE_FILE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null; // no save yet
    throw err;
  }
});
