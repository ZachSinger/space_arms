import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("native display choices work across modes and Windows display scaling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "space-arms-display-test-"));
  const handlers = new Map();
  const sender = {};
  const display = {
    size: { width: 1280, height: 720 },
    workAreaSize: { width: 1280, height: 680 },
    scaleFactor: 2,
  };
  let window;
  let server;
  globalThis.__nativeDisplayTest = {
    app: { getPath: () => directory, setPath() {}, whenReady: () => Promise.resolve(), on() {} },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    net: {},
    shell: {},
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    screen: { getDisplayMatching: () => display },
    BrowserWindow: class {
      static fromWebContents(value) { return value === sender ? window : null; }
      constructor() {
        window = this;
        this.content = [display.size.width, display.size.height];
        this.fullscreen = true;
        this.kiosk = false;
        this.menuVisible = true;
      }
      on() {}
      loadURL() {}
      getContentSize() { return [...this.content]; }
      getBounds() {
        const frame = this.fullscreen || this.kiosk ? { width: 0, height: 0 } : { width: 16, height: 40 };
        return { x: 0, y: 0, width: this.content[0] + frame.width, height: this.content[1] + frame.height };
      }
      setContentSize(width, height) { this.content = [width, height]; }
      setFullScreen(value) {
        this.fullscreen = value;
        if (value) this.content = [display.size.width, display.size.height];
      }
      setKiosk(value) {
        this.kiosk = value;
        if (value) this.content = [display.size.width, display.size.height];
      }
      setMenuBarVisibility(value) { this.menuVisible = value; }
    },
  };

  try {
    server = await createServer({
      root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
      logLevel: "silent", cacheDir: join(directory, "vite-cache"),
      optimizeDeps: { noDiscovery: true, include: [] },
      ssr: { noExternal: ["electron"] }, server: { middlewareMode: true },
      plugins: [{
        name: "display-electron-stub", enforce: "pre",
        resolveId: (source) => source === "electron" ? "\0display-test-electron" : null,
        load: (id) => id === "\0display-test-electron"
          ? "export const { app, BrowserWindow, ipcMain, net, protocol, screen, shell } = globalThis.__nativeDisplayTest;" : null,
      }],
    });
    await server.ssrLoadModule("/main.js");
    const event = { sender };
    const getSettings = handlers.get("display:get-settings");
    const setResolution = handlers.get("display:set-resolution");
    const setMode = handlers.get("display:set-mode");

    assert.deepEqual(getSettings(event).current, { width: 2560, height: 1440 });
    assert.deepEqual(getSettings(event).displaySize, { width: 2560, height: 1440 });
    assert.equal(window.menuVisible, false);
    const small = { width: 1280, height: 720 };
    assert.deepEqual(setResolution(event, small).current, small);
    assert.deepEqual(window.getContentSize(), [1280, 720]);
    assert.throws(() => setResolution(event, { width: 3840, height: 2160 }), /Unsupported resolution/);

    assert.deepEqual(setMode(event, "windowed").current, small);
    assert.equal(window.menuVisible, true);
    assert.deepEqual(window.getContentSize(), [640, 360]);
    const large = { width: 1920, height: 1080 };
    assert.deepEqual(setResolution(event, large).current, large);
    assert.deepEqual(window.getContentSize(), [960, 540]);

    const fitted = setResolution(event, { width: 2560, height: 1440 }).current;
    assert.ok(fitted.width < 2560 && fitted.height < 1440);
    assert.ok(window.getBounds().width <= display.workAreaSize.width);
    assert.ok(window.getBounds().height <= display.workAreaSize.height);
    assert.ok(Math.abs(fitted.width / fitted.height - 16 / 9) < 0.01);
    setResolution(event, large);

    const borderless = setMode(event, "borderless");
    assert.equal(borderless.displayMode, "borderless");
    assert.deepEqual(borderless.current, large);
    assert.equal(window.menuVisible, false);
    setResolution(event, small);
    const fullscreen = setMode(event, "fullscreen");
    assert.equal(fullscreen.displayMode, "fullscreen");
    assert.deepEqual(fullscreen.current, small);
    assert.equal(window.menuVisible, false);
    assert.deepEqual(window.getContentSize(), [1280, 720]);
  } finally {
    delete globalThis.__nativeDisplayTest;
    if (server) await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
