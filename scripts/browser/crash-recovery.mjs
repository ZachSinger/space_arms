// Runs as both the test driver and the isolated Electron entry point.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROFILE_VARIABLE = "SPACE_ARMS_CRASH_CHECK_PROFILE";

if (process.versions.electron) {
  const { app } = await import("electron");
  const profile = process.env[PROFILE_VARIABLE];
  if (!profile || !path.isAbsolute(profile)) throw new Error("Crash check requires an isolated profile.");
  const userData = path.join(profile, "space-arms-dealer");
  mkdirSync(userData, { recursive: true });
  app.setPath("appData", profile);
  app.setPath("userData", userData);

  // Load the built game through the same app:// protocol as a packaged game.
  Object.defineProperty(app, "isPackaged", { value: true });
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.on("browser-window-created", (_event, win) => {
    win.on("show", () => win.hide());
    win.hide();
  });

  // Exercise the real report form and IPC without sending a test report to Discord.
  globalThis.__crashCheckReports = [];
  globalThis.fetch = async (url, options) => {
    const form = options.body;
    globalThis.__crashCheckReports.push({
      url: String(url),
      title: form.get("title"),
      message: form.get("message"),
      gameData: JSON.parse(form.get("gameData")),
    });
    return new Response('{"ok":true}', { status: 200 });
  };
  await import("../../main.js");
} else {
  const { _electron } = await import("playwright-core");
  const { default: electronPath } = await import("electron");
  const { BUG_REPORT_URL } = await import("../../js/logic/BugReport.js");
  const profile = await mkdtemp(path.join(tmpdir(), "space-arms-crash-check-"));
  const userData = path.join(profile, "space-arms-dealer");
  const errorFile = path.join(userData, "pending-errors.json");
  let application;

  async function launch() {
    application = await _electron.launch({
      executablePath: electronPath,
      args: [fileURLToPath(import.meta.url)],
      env: { ...process.env, [PROFILE_VARIABLE]: profile },
      timeout: 60000,
    });
    const actualPaths = await application.evaluate(({ app }) => ({
      appData: app.getPath("appData"),
      userData: app.getPath("userData"),
    }));
    assert.deepEqual(actualPaths, { appData: profile, userData }, "the game must use the temporary profile");
    const page = await application.firstWindow();
    await page.waitForFunction(() => window.__game?.scene?.getScene("scene-title")?.sys.isActive(),
      null, { polling: 100, timeout: 60000 });
    assert.equal(await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible()), false, "the test window must stay hidden");
    return page;
  }

  async function close() {
    await application.close();
    application = null;
  }

  async function verifyPrompt(page, crash) {
    await page.locator("#runtime-error-dialog").waitFor({ state: "visible", timeout: 30000 });
    const title = await page.locator("[data-runtime-error-title]").inputValue();
    const message = await page.locator("[data-runtime-error-message]").inputValue();
    assert.ok(title.includes(crash.message), "the report title must include the saved crash");
    assert.ok(message.includes(crash.type), "the report must identify a renderer crash");
    assert.ok(message.includes(crash.message), "the report must describe the saved crash");
    assert.deepEqual(await page.evaluate(() => window.desktopApi.getPendingRuntimeErrors()), [crash]);
    assert.equal(await application.evaluate(() => globalThis.__crashCheckReports.length), 0,
      "the report must not be sent without permission");
    return { title, message };
  }

  try {
    let page = await launch();
    assert.deepEqual(await page.evaluate(() => window.desktopApi.getPendingRuntimeErrors()), []);
    assert.equal(await page.locator("#runtime-error-dialog").evaluate((dialog) => dialog.open), false);
    await page.evaluate(() => window.__game.scene.getScene("scene-title").scene.start("scene-game"));
    await page.waitForFunction(() => {
      const scene = window.__game.scene.getScene("scene-game");
      return scene?.sys.isActive() && scene.player && scene.pauseMenu;
    }, null, { polling: 100, timeout: 60000 });

    await Promise.all([
      application.waitForEvent("close", { timeout: 30000 }),
      application.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        setTimeout(() => win.webContents.forcefullyCrashRenderer(), 100);
      }),
    ]);
    application = null;

    const savedErrors = JSON.parse(await readFile(errorFile, "utf8"));
    assert.equal(savedErrors.length, 1, "the crash must be saved before the game exits");
    const [crash] = savedErrors;
    assert.equal(crash.type, "renderer-process-gone");
    assert.ok(["crashed", "killed"].includes(crash.reason), `unexpected crash reason: ${crash.reason}`);
    assert.match(crash.message, /stopped unexpectedly/);

    page = await launch();
    await verifyPrompt(page, crash);
    await page.locator("[data-runtime-error-dismiss]").click();
    assert.equal(await page.locator("#runtime-error-dialog").evaluate((dialog) => dialog.open), false);
    assert.equal(await application.evaluate(() => globalThis.__crashCheckReports.length), 0,
      "choosing Not now must not send a report");
    assert.deepEqual(JSON.parse(await readFile(errorFile, "utf8")), [crash],
      "choosing Not now must keep the crash for later");
    await close();

    page = await launch();
    const prefill = await verifyPrompt(page, crash);
    await page.locator("[data-runtime-error-send]").click();
    await page.waitForFunction(() => !document.getElementById("runtime-error-dialog").open ||
      document.querySelector("[data-runtime-error-status]").textContent.startsWith("Report not sent:"),
    null, { polling: 100, timeout: 30000 });
    const status = await page.locator("[data-runtime-error-status]").textContent();
    assert.equal(await page.locator("#runtime-error-dialog").evaluate((dialog) => dialog.open), false,
      `the report should be accepted: ${status}`);
    const reports = await application.evaluate(() => globalThis.__crashCheckReports);
    assert.equal(reports.length, 1, "choosing Send Report must send one report");
    assert.equal(reports[0].url, BUG_REPORT_URL);
    assert.equal(reports[0].title, prefill.title);
    assert.equal(reports[0].message, prefill.message);
    assert.deepEqual(reports[0].gameData.diagnostics.pendingErrors, [crash],
      "the report must include the saved crash details");
    assert.deepEqual(JSON.parse(await readFile(errorFile, "utf8")), [],
      "successfully reported crashes must be cleared");
    console.log("ok   renderer crash survives restart and opens a prefilled report");
    console.log("ok   deferring keeps the report; sending includes and clears the crash");
  } finally {
    try {
      if (application) await close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
}
