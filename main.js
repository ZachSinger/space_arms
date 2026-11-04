import { app, BrowserWindow, ipcMain, screen, shell } from "electron";
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
const pendingFileWrites = new Set();
let saveQueue = Promise.resolve();
let debugQueue = Promise.resolve();
let debugSession = null;

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
  win.on("close", (event) => {
    if (pendingFileWrites.size === 0) return;
    event.preventDefault();
    win.setEnabled(false);
    Promise.allSettled([...pendingFileWrites]).then(() => {
      if (!win.isDestroyed()) win.destroy();
    });
  });
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
  const write = saveQueue.then(async () => {
    const temporaryPath = `${SAVE_FILE_PATH}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(payload), "utf-8");
    await fs.rename(temporaryPath, SAVE_FILE_PATH);
    return true;
  });
  saveQueue = write.catch((error) => console.error("Save file write failed", error));
  pendingFileWrites.add(write);
  try {
    return await write;
  } finally {
    pendingFileWrites.delete(write);
  }
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

ipcMain.handle("debug:capture", async (event, snapshot) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) throw new Error("The game window is unavailable.");
  if (!snapshot || snapshot.formatVersion !== 1 || typeof snapshot.requestedAt !== "string") {
    throw new Error("Invalid debug snapshot.");
  }
  const snapshotJSON = JSON.stringify(snapshot, null, 2);
  const write = debugQueue.then(async () => {
    const image = await event.sender.capturePage();
    if (image.isEmpty()) throw new Error("The game window screenshot was empty.");
    const screenshotAt = new Date().toISOString();
    if (!debugSession) {
      const root = path.join(app.getPath("userData"), "debug-sessions");
      await fs.mkdir(root, { recursive: true });
      const stamp = screenshotAt.replace(/[:.]/g, "-");
      debugSession = {
        directory: await fs.mkdtemp(path.join(root, `session-${stamp}-`)),
        nextCapture: 1,
      };
    }
    const captureNumber = debugSession.nextCapture++;
    const prefix = String(captureNumber).padStart(4, "0");
    const screenshotPath = path.join(debugSession.directory, `${prefix}-screen.png`);
    const reportPath = path.join(debugSession.directory, `${prefix}-info.txt`);
    const report = [
      "SPACE ARMS DEALER - DEBUG INFO",
      `Session: ${path.basename(debugSession.directory)}`,
      `Capture: ${captureNumber}`,
      `Game version: ${app.getVersion()}`,
      `Runtime: Electron ${process.versions.electron}; ${process.platform} ${process.arch}`,
      `Snapshot requested: ${snapshot.requestedAt}`,
      `Screenshot captured: ${screenshotAt}`,
      `Screenshot: ${path.basename(screenshotPath)}`,
      "Local diagnostic capture only. This is NOT a loadable saved game.",
      "Gameplay continues during capture; the screenshot can be a few frames later than the state.",
      "",
      snapshotJSON,
      "",
    ].join("\n");
    await fs.writeFile(screenshotPath, image.toPNG(), { flag: "wx" });
    await fs.writeFile(reportPath, report, { encoding: "utf8", flag: "wx" });
    return { captureNumber, directory: debugSession.directory, reportPath, screenshotPath };
  });
  debugQueue = write.catch((error) => console.error("Debug capture failed", error));
  pendingFileWrites.add(write);
  try {
    return await write;
  } finally {
    pendingFileWrites.delete(write);
  }
});

ipcMain.handle("debug:open-folder", async () => {
  if (!debugSession) throw new Error("Capture debug info before opening its folder.");
  const error = await shell.openPath(debugSession.directory);
  if (error) throw new Error(`Could not open the debug folder: ${error}`);
  return true;
});
