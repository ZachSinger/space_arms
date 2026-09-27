import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "path";
import { fileURLToPath } from "url";

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

  return { current: { width, height }, resolutions };
}

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
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

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
