// ==========================================
// FILE: scripts/style-planner/server.mjs
// ==========================================
// A developer tool, not part of the game: a page for planning shop decorating (paints, the
// shelf's highlight strip, wall and floor colors, and lighting) on a live mock shop, with
// planning questions to answer as we go. Run with `npm run style`, then use the page it opens.
// Saving writes documentation/Modules/ShopStyle.plan.json, which is the shared plan.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 5182;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PLAN_FILE = path.join(ROOT, "documentation", "Modules", "ShopStyle.plan.json");
// The page may read game art and the game's own gray-art code, nothing else.
const SHARED = { "/img/": path.join(ROOT, "img"), "/js/": path.join(ROOT, "js") };
const TYPES = { ".png": "image/png", ".js": "text/javascript; charset=utf-8" };

function send(response, status, body, type = "application/json") {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(type === "application/json" ? JSON.stringify(body) : body);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function handle(request, response) {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  if (request.method === "GET" && url.pathname === "/") {
    return send(response, 200, await readFile(path.join(HERE, "index.html"), "utf8"), "text/html; charset=utf-8");
  }
  if (request.method === "GET" && url.pathname === "/api/plan") {
    return send(response, 200, JSON.parse(await readFile(PLAN_FILE, "utf8")));
  }
  if (request.method === "POST" && url.pathname === "/api/plan") {
    const plan = JSON.parse(await readBody(request));
    if (!plan || typeof plan !== "object" || !Array.isArray(plan.paints) || !plan.room || !plan.answers) {
      return send(response, 400, { problems: ["The plan was missing a section, so nothing was saved."] });
    }
    await writeFile(PLAN_FILE, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    return send(response, 200, { saved: true });
  }
  if (request.method === "GET") {
    const prefix = Object.keys(SHARED).find((start) => url.pathname.startsWith(start));
    if (prefix) {
      const base = SHARED[prefix];
      const file = path.resolve(base, decodeURIComponent(url.pathname.slice(prefix.length)));
      const type = TYPES[path.extname(file)];
      if (!file.startsWith(base + path.sep) || !type) return send(response, 404, { error: "Not found" });
      try {
        return send(response, 200, await readFile(file), type);
      } catch {
        return send(response, 404, { error: "Not found" });
      }
    }
  }
  return send(response, 404, { error: "Not found" });
}

const address = `http://localhost:${PORT}`;
const openPage = () => {
  if (!process.argv.includes("--no-open")) exec(process.platform === "win32" ? `start "" ${address}` : `open ${address}`);
};
createServer((request, response) => {
  handle(request, response).catch((error) => send(response, 500, { problems: [String(error?.message ?? error)] }));
}).on("error", (error) => {
  if (error.code !== "EADDRINUSE") throw error;
  console.log(`The style planner is already running at ${address}, so this opens that one instead.`);
  openPage();
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Style planner running at ${address} (Ctrl+C to stop).`);
  openPage();
});
