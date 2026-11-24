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
  quitGame: () => ipcRenderer.invoke("app:quit"),
  sendBugReport: (report) => ipcRenderer.invoke("bug-report:send", report),
  recordRuntimeError: (error) => ipcRenderer.invoke("runtime-error:record", error),
  getPendingRuntimeErrors: () => ipcRenderer.invoke("runtime-error:list"),
  clearPendingRuntimeErrors: (ids) => ipcRenderer.invoke("runtime-error:clear", ids),
  captureDebugInfo: (snapshot) => ipcRenderer.invoke("debug:capture", snapshot),
  openDebugFolder: () => ipcRenderer.invoke("debug:open-folder"),
  // Co-op link (see js/platform/coop.js). Listener functions return an unsubscribe function.
  coop: {
    status: () => ipcRenderer.invoke("coop:status"),
    host: () => ipcRenderer.invoke("coop:host"),
    invite: () => ipcRenderer.invoke("coop:invite"),
    joinAddress: (address) => ipcRenderer.invoke("coop:join-address", address),
    leave: () => ipcRenderer.invoke("coop:leave"),
    send: (text) => ipcRenderer.send("coop:send", text),
    onMessage: (listener) => {
      const handler = (_event, text) => listener(text);
      ipcRenderer.on("coop:message", handler);
      return () => ipcRenderer.off("coop:message", handler);
    },
    onStatus: (listener) => {
      const handler = (_event, status) => listener(status);
      ipcRenderer.on("coop:status", handler);
      return () => ipcRenderer.off("coop:status", handler);
    },
  },
});
