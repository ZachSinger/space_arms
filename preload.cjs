const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  getDisplaySettings: () => ipcRenderer.invoke("display:get-settings"),
  setResolution: (resolution) =>
    ipcRenderer.invoke("display:set-resolution", resolution),
  setDisplayMode: (mode) => ipcRenderer.invoke("display:set-mode", mode),
  saveGame: (payload) => ipcRenderer.invoke("save:write", payload),
  loadGame: () => ipcRenderer.invoke("save:read"),
});
