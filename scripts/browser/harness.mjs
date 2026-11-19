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

export async function startGame({ port = 5391, headless = true } = {}) {
  const server = await createServer({ root: ROOT, logLevel: "error", server: {
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
      await page.evaluate((startData) => {
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
          scene.hud && scene.lastSavedSnapshot;
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
    async close() {
      await browser.close();
      await server.close();
    },
  };
  return harness;
}
