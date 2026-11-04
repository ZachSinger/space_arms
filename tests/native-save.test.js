import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import { createServer } from "vite";

test("native saves replace atomically, serialize writes, recover from errors, and finish before closing", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "space-arms-native-save-test-"));
  const handlers = new Map();
  let window;
  let server;
  const errorLog = context.mock.method(console, "error", () => {});
  globalThis.__nativeSaveTest = {
    app: { getPath: () => directory, setPath() {}, whenReady: () => Promise.resolve(), on() {} },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    net: {},
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    screen: {},
    BrowserWindow: class {
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
      root: fileURLToPath(new URL("..", import.meta.url)),
      configFile: false,
      logLevel: "silent",
      cacheDir: join(directory, "vite-cache"),
      optimizeDeps: { noDiscovery: true, include: [] },
      ssr: { noExternal: ["electron"] },
      server: { middlewareMode: true },
      plugins: [{
        name: "native-save-electron-stub",
        enforce: "pre",
        resolveId: (source) => source === "electron" ? "\0native-test-electron" : null,
        load: (id) => id === "\0native-test-electron"
          ? "export const { app, BrowserWindow, ipcMain, net, protocol, screen, shell } = globalThis.__nativeSaveTest;" : null,
      }],
    });
    await server.ssrLoadModule("/main.js");
    const save = handlers.get("save:write");
    const load = handlers.get("save:read");
    assert.equal(await load(), null);
    await Promise.all([save({}, { value: 1 }), save({}, { value: 2 })]);
    assert.deepEqual(await load(), { value: 2 });
    assert.equal((await readdir(directory)).includes("savegame.json.tmp"), false);

    const circular = {};
    circular.self = circular;
    await assert.rejects(save({}, circular), /circular/i);
    assert.equal(errorLog.mock.callCount(), 1);
    assert.deepEqual(await load(), { value: 2 });
    await save({}, { value: 3 });
    assert.deepEqual(await load(), { value: 3 });

    const pending = save({}, { value: 4 });
    let prevented = false;
    window.handlers.get("close")({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(window.enabled, false);
    assert.equal(window.destroyed, false);
    await pending;
    await setImmediate();
    assert.equal(window.destroyed, true);
    assert.deepEqual(JSON.parse(await readFile(join(directory, "savegame.json"), "utf8")), { value: 4 });

    await writeFile(join(directory, "savegame.json"), "{broken", "utf8");
    await assert.rejects(load(), SyntaxError);
  } finally {
    errorLog.mock.restore();
    delete globalThis.__nativeSaveTest;
    if (server) await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
