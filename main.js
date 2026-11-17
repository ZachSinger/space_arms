// ==========================================
// FILE: main.js
// ==========================================
// Electron main process: creates the game window, and serves the renderer's IPC calls for
// display settings, the save file, and debug captures.
// See also: preload.cjs (the renderer-side API for these channels).
import { app, BrowserWindow, ipcMain, net, protocol, screen, shell } from "electron";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import fs from "fs/promises";

// ES modules have no __dirname.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Packaged builds load the game from dist/ through app://game/; development uses Vite.
const DEV_SERVER_URL = "http://localhost:5173";
const GAME_URL = "app://game/index.html";
const DIST_DIRECTORY = path.join(__dirname, "dist");

// Pin the save folder so it doesn't move with the packaged app's display name.
app.setPath("userData", path.join(app.getPath("appData"), "space-arms-dealer"));

// A standard, secure scheme behaves like a website for relative paths, fetch, and storage.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/**
 * Serve a file from dist/, refusing any path that escapes it.
 * @param {Request} request
 */
function serveGameFile(request) {
  const { pathname } = new URL(request.url);
  const filePath = path.join(DIST_DIRECTORY, decodeURIComponent(pathname));
  if (!filePath.startsWith(DIST_DIRECTORY + path.sep)) {
    return new Response("Not found", { status: 404 });
  }
  return net.fetch(pathToFileURL(filePath).toString());
}

// Resolutions offered in settings, filtered to what fits the current display (physical px).
const COMMON_RESOLUTIONS = [
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];

const displayModes = new WeakMap();
const displayResolutions = new WeakMap();

function getDisplayMode(win) {
  return displayModes.get(win) ?? "windowed";
}

function toPhysicalSize(size, scaleFactor) {
  return {
    width: Math.round(size.width * scaleFactor),
    height: Math.round(size.height * scaleFactor),
  };
}

function getContentSizeInPixels(win, display) {
  const [width, height] = win.getContentSize();
  return toPhysicalSize({ width, height }, display.scaleFactor);
}

function resizeWindowContent(win, resolution, display) {
  const [contentWidth, contentHeight] = win.getContentSize();
  const bounds = win.getBounds();
  const maxWidth = Math.max(1, display.workAreaSize.width - Math.max(0, bounds.width - contentWidth));
  const maxHeight = Math.max(1, display.workAreaSize.height - Math.max(0, bounds.height - contentHeight));
  const width = resolution.width / display.scaleFactor;
  const height = resolution.height / display.scaleFactor;
  const fit = Math.min(1, maxWidth / width, maxHeight / height);
  win.setContentSize(Math.max(1, Math.round(width * fit)), Math.max(1, Math.round(height * fit)));
  return getContentSizeInPixels(win, display);
}

/**
 * The selected resolution, available display resolutions, and the display mode.
 * @param {BrowserWindow} win
 */
function getDisplaySettings(win) {
  const display = screen.getDisplayMatching(win.getBounds());
  const displaySize = toPhysicalSize(display.size, display.scaleFactor);
  const displayMode = getDisplayMode(win);
  const contentSize = getContentSizeInPixels(win, display);
  let current = displayMode === "windowed" ? contentSize : displayResolutions.get(win) ?? contentSize;
  if (displayMode !== "windowed" &&
    (current.width > displaySize.width || current.height > displaySize.height)) {
    current = displaySize;
    displayResolutions.set(win, current);
  }
  const resolutions = [...COMMON_RESOLUTIONS, displaySize, current]
    .filter(
      (resolution) =>
        (resolution.width <= displaySize.width && resolution.height <= displaySize.height) ||
        (resolution.width === current.width && resolution.height === current.height),
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
    current,
    resolutions,
    displayMode,
    displaySize,
  };
}

// Writes in flight; closing the window waits for these so a save is never cut off.
const pendingFileWrites = new Set();
// Serialize writes so two saves (or two captures) never interleave.
let saveQueue = Promise.resolve();
let debugQueue = Promise.resolve();
// One debug folder per app run, created on the first capture.
let debugSession = null;

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
  win.setMenuBarVisibility(false);
  win.on("close", (event) => {
    if (pendingFileWrites.size === 0) return;
    event.preventDefault();
    win.setEnabled(false);
    Promise.allSettled([...pendingFileWrites]).then(() => {
      if (!win.isDestroyed()) win.destroy();
    });
  });
  win.loadURL(app.isPackaged ? GAME_URL : DEV_SERVER_URL);
};

ipcMain.handle("display:get-settings", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return getDisplaySettings(win);
});

ipcMain.handle("display:set-resolution", (event, resolution) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const display = screen.getDisplayMatching(win.getBounds());
  const displaySize = toPhysicalSize(display.size, display.scaleFactor);
  const isAvailable =
    resolution &&
    Number.isInteger(resolution.width) &&
    Number.isInteger(resolution.height) &&
    resolution.width > 0 &&
    resolution.height > 0 &&
    resolution.width <= displaySize.width &&
    resolution.height <= displaySize.height;

  if (!isAvailable) {
    throw new Error("Unsupported resolution");
  }

  const applied = getDisplayMode(win) === "windowed"
    ? resizeWindowContent(win, resolution, display)
    : { width: resolution.width, height: resolution.height };
  displayResolutions.set(win, applied);
  return getDisplaySettings(win);
});

// Borderless uses kiosk mode: screen-sized without exclusive fullscreen.
ipcMain.handle("display:set-mode", (event, mode) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  if (!["windowed", "borderless", "fullscreen"].includes(mode)) {
    throw new Error("Unsupported display mode");
  }

  const resolution = getDisplaySettings(win).current;
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
  win.setMenuBarVisibility(mode === "windowed");
  if (mode === "windowed") {
    const display = screen.getDisplayMatching(win.getBounds());
    displayResolutions.set(win, resizeWindowContent(win, resolution, display));
  } else {
    displayResolutions.set(win, resolution);
  }
  return getDisplaySettings(win);
});

app.whenReady().then(() => {
  protocol.handle("app", serveGameFile);
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
  // Fixed filename under userData avoids any path traversal from renderer input. Write to
  // a temp file and rename so a crash mid-write can't corrupt the existing save.
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

// Writes a numbered screenshot + text report pair into this run's debug session folder.
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
    // "wx" refuses to overwrite an existing capture.
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
