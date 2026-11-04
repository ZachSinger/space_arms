// ==========================================
// FILE: preload.cjs
// ==========================================
// Electron preload: exposes `window.desktopApi`, the renderer's only bridge to the main
// process (display settings, save files, debug capture), via IPC.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  getDisplaySettings: () => ipcRenderer.invoke("display:get-settings"),
  setResolution: (resolution) =>
    ipcRenderer.invoke("display:set-resolution", resolution),
  setDisplayMode: (mode) => ipcRenderer.invoke("display:set-mode", mode),
  saveGame: (payload) => ipcRenderer.invoke("save:write", payload),
  loadGame: () => ipcRenderer.invoke("save:read"),
  captureDebugInfo: (snapshot) => ipcRenderer.invoke("debug:capture", snapshot),
  openDebugFolder: () => ipcRenderer.invoke("debug:open-folder"),
});
