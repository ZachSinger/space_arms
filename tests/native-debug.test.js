import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import { createServer } from "vite";
import { runInNewContext } from "node:vm";

test("preload exposes only the fixed debug capture and folder IPC commands", async () => {
  let api;
  const calls = [];
  runInNewContext(await readFile(new URL("../preload.cjs", import.meta.url), "utf8"), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, "desktopApi"); api = value; } },
      ipcRenderer: { invoke: (...args) => { calls.push(args); return true; } },
    }),
  });
  const snapshot = { formatVersion: 1 };
  api.captureDebugInfo(snapshot);
  api.openDebugFolder();
  assert.deepEqual(calls, [["debug:capture", snapshot], ["debug:open-folder"]]);
});

test("native debug captures keep numbered screenshot/report pairs and wait for writes on close", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "space-arms-debug-test-"));
  const handlers = new Map();
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const image = { isEmpty: () => false, toPNG: () => png };
  let screenshot = async () => image;
  const sender = { capturePage: () => screenshot() };
  let window;
  let openedPath;
  let openError = "";
  let server;
  const errors = context.mock.method(console, "error", () => {});
  globalThis.__nativeDebugTest = {
    app: {
      getPath: () => directory, getVersion: () => "1.0.0",
      whenReady: () => Promise.resolve(), on() {},
    },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    screen: {},
    shell: { openPath: async (value) => { openedPath = value; return openError; } },
    BrowserWindow: class {
      static fromWebContents(value) { return value === sender ? window : null; }
      constructor() {
        window = this;
        this.handlers = new Map();
        this.destroyed = false;
        this.enabled = true;
      }
      on(name, handler) { this.handlers.set(name, handler); }
      loadURL() {}
      setEnabled(value) { this.enabled = value; }
      isDestroyed() { return this.destroyed; }
      destroy() { this.destroyed = true; }
    },
  };
  try {
    server = await createServer({
      root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
      logLevel: "silent", cacheDir: join(directory, "vite-cache"),
      optimizeDeps: { noDiscovery: true, include: [] },
      ssr: { noExternal: ["electron"] }, server: { middlewareMode: true },
      plugins: [{
        name: "debug-electron-stub", enforce: "pre",
        resolveId: (source) => source === "electron" ? "\0debug-test-electron" : null,
        load: (id) => id === "\0debug-test-electron"
          ? "export const { app, BrowserWindow, ipcMain, screen, shell } = globalThis.__nativeDebugTest;" : null,
      }],
    });
    await server.ssrLoadModule("/main.js");
    const capture = handlers.get("debug:capture");
    const open = handlers.get("debug:open-folder");
    const snapshot = { formatVersion: 1, requestedAt: new Date().toISOString(), player: { credits: 1500 } };
    await assert.rejects(open(), /Capture debug info/);
    await assert.rejects(capture({ sender }, {}), /Invalid debug snapshot/);
    await assert.rejects(capture({ sender: {} }, snapshot), /window is unavailable/);
    await writeFile(join(directory, "savegame.json"), "leave this save alone");
    const [first, second] = await Promise.all([
      capture({ sender }, snapshot),
      capture({ sender }, { ...snapshot, player: { credits: 1400 } }),
    ]);
    assert.equal(first.captureNumber, 1);
    assert.equal(second.captureNumber, 2);
    assert.equal(first.directory, second.directory);
    assert.deepEqual((await readdir(first.directory)).sort(), [
      "0001-info.txt", "0001-screen.png", "0002-info.txt", "0002-screen.png",
    ]);
    assert.deepEqual(await readFile(first.screenshotPath), png);
    const report = await readFile(first.reportPath, "utf8");
    assert.match(report, /Game version: 1.0.0/);
    assert.match(report, /NOT a loadable saved game/);
    assert.deepEqual(JSON.parse(report.slice(report.indexOf("{\n"))), snapshot);
    assert.equal(await readFile(join(directory, "savegame.json"), "utf8"), "leave this save alone");
    assert.equal(await open(), true);
    assert.equal(openedPath, first.directory);
    openError = "OS refused";
    await assert.rejects(open(), /OS refused/);

    const blockedReport = join(first.directory, "0003-info.txt");
    await writeFile(blockedReport, "Do not overwrite this existing report.");
    await assert.rejects(capture({ sender }, snapshot), /EEXIST/);
    assert.equal(await readFile(blockedReport, "utf8"), "Do not overwrite this existing report.");
    screenshot = async () => ({ isEmpty: () => true });
    await assert.rejects(capture({ sender }, snapshot), /screenshot was empty/);
    assert.equal(errors.mock.callCount(), 2);
    let finishScreenshot;
    screenshot = () => new Promise((resolve) => { finishScreenshot = resolve; });
    const pending = capture({ sender }, snapshot);
    await setImmediate();
    let prevented = false;
    window.handlers.get("close")({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(window.enabled, false);
    assert.equal(window.destroyed, false);
    finishScreenshot(image);
    const recovered = await pending;
    assert.equal(recovered.captureNumber, 4);
    await setImmediate();
    assert.equal(window.destroyed, true);
    assert.match(await readFile(recovered.reportPath, "utf8"), /Capture: 4/);
  } finally {
    errors.mock.restore();
    delete globalThis.__nativeDebugTest;
    if (server) await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
