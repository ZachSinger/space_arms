const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  getDisplaySettings: () => ipcRenderer.invoke("display:get-settings"),
  setResolution: (resolution) =>
    ipcRenderer.invoke("display:set-resolution", resolution),
});
