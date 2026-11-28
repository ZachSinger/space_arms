// ==========================================
// FILE: harness.mjs
// ==========================================
// Starts the Vite dev server and a hidden Edge window, then lets a script drive the real game.
// Used by the scripted shift and scenario checks (documentation/RebuildPlan.md, Phase 0).
// Needs the local art in img/ (not stored in git).
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export async function startGame({ port = 5391, headless = true, vitePlugins = [] } = {}) {
  // Its own cache, so re-bundling here can't break a dev server the desktop app is using.
  const server = await createServer({ root: ROOT, logLevel: "error", plugins: vitePlugins,
    cacheDir: "node_modules/.vite-harness", server: {
    port,
    strictPort: true,
    // Builds and packaging write here; watching them can crash the server mid-check.
    watch: { ignored: ["**/release/**", "**/dist/**", "**/dist-electron/**", "**/node_modules/**"] },
  } });
  await server.listen();
  const browser = await chromium.launch({
    channel: "msedge",
    headless,
    args: ["--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const problems = [];
  page.on("pageerror", (error) => problems.push({ type: "error", text: String(error?.stack ?? error) }));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push({ type: "missing-file", text: `${response.status()} ${response.url()}` });
  });
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().startsWith("Failed to load resource")) return;
    if (message.type() === "error") problems.push({ type: "console-error", text: message.text() });
    if (message.type() === "warning") problems.push({ type: "warning", text: message.text() });
  });
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.__game?.scene?.getScene("scene-title")?.sys.isActive(), null,
    { timeout: 120000 });

  const harness = {
    page,
    problems,
    /** Errors only; warnings such as "Customer gave up" are counted separately. */
    errors: () => problems.filter((problem) => problem.type !== "warning"),
    warnings: (pattern) => problems.filter((problem) => problem.type === "warning" && pattern.test(problem.text)),
    async newGame(data = {}) {
      await page.evaluate(async (startData) => {
        const previous = window.__game.scene.getScene("scene-game");
        if (previous?.sys.isActive()) {
          previous.setGamePaused(true);
          await previous.saves.waitForSave();
        }
        window.localStorage.clear();
        window.__previousPlayer = window.__game.scene.getScene("scene-game")?.player ?? null;
        window.__game.scene.getScene("scene-title").scene.start("scene-game", startData);
      }, data);
      // A running game restarts on the next frame; wait for the new one, not the old one.
      await page.waitForFunction(() => {
        const scene = window.__game.scene.getScene("scene-game");
        return scene?.sys.isActive() && scene.player && scene.player !== window.__previousPlayer && scene.hud;
      }, null, { timeout: 60000 });
    },
    async loadSave(shopData) {
      await page.evaluate((savedShopData) => {
        const scene = window.__game.scene.getScene("scene-game");
        const manager = scene?.sys.isActive() ? scene.scene : window.__game.scene.getScene("scene-title").scene;
        window.__previousPlayer = scene?.player ?? null;
        manager.start("scene-game", { savedShopData });
      }, shopData);
      await page.waitForFunction(() => {
        const scene = window.__game.scene.getScene("scene-game");
        return scene?.sys.isActive() && scene.player && scene.player !== window.__previousPlayer &&
          scene.hud && scene.saves.lastSavedSnapshot;
      }, null, { timeout: 60000 });
    },
    /** Runs a function inside the page with the game scene as `scene`. */
    game(fn, arg) {
      return page.evaluate(([source, value]) => {
        const scene = window.__game.scene.getScene("scene-game");
        return new Function("scene", "arg", `return (${source})(scene, arg);`)(scene, value);
      }, [fn.toString(), arg]);
    },
    wait: (ms) => page.waitForTimeout(ms),
    /**
     * Stops the game's own loop and plays `steps` equal-size game steps by hand, `perFrame` of
     * them per browser frame. More per frame is fast-forward; every step is still normal size,
     * so movement and physics behave the same. `window.__onStep(index)` runs before each step.
     * The loop stays stopped afterwards (so results can be read untouched) until `resumeLoop`.
     */
    async step(steps, { perFrame = 1, stepMs = 1000 / 60 } = {}) {
      await page.evaluate(async ({ steps, perFrame, stepMs }) => {
        const game = window.__game;
        if (game.loop.running) game.loop.sleep();
        window.__stepIndex ??= 0;
        for (let done = 0; done < steps;) {
          for (let inFrame = 0; inFrame < perFrame && done < steps; inFrame += 1, done += 1) {
            window.__onStep?.(window.__stepIndex);
            window.__stepIndex += 1;
            game.headlessStep(1e6 + window.__stepIndex * stepMs, stepMs);
          }
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }, { steps, perFrame, stepMs });
    },
    async resumeLoop() {
      await page.evaluate(() => {
        window.__stepIndex = 0;
        window.__onStep = null;
        if (!window.__game.loop.running) window.__game.loop.wake();
      });
    },
    async close() {
      await browser.close();
      await server.close();
    },
  };
  return harness;
}
