// ==========================================
// FILE: scripts/arcade-tester/server.mjs
// ==========================================
// A developer tool, not part of the game: a page for playing the arcade cabinet games in
// js/arcade/games/ outside the shop, with sound, keyboard and controllers. Run with `npm run arcade`.
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 5185;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCADE = path.resolve(HERE, "../../js/arcade");

function send(response, status, body, type) {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(body);
}

async function handle(request, response) {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  if (request.method !== "GET") return send(response, 404, "Not found", "text/plain");
  if (url.pathname === "/") return send(response, 200, await readFile(path.join(HERE, "index.html")), "text/html; charset=utf-8");
  if (url.pathname === "/games") {
    const files = (await readdir(path.join(ARCADE, "games"))).filter((name) => name.endsWith(".js"));
    return send(response, 200, JSON.stringify(files.map((name) => name.slice(0, -3))), "application/json");
  }
  if (url.pathname.startsWith("/js/arcade/")) {
    const file = path.resolve(ARCADE, decodeURIComponent(url.pathname.slice("/js/arcade/".length)));
    if (!file.startsWith(ARCADE + path.sep) || path.extname(file) !== ".js") return send(response, 404, "Not found", "text/plain");
    try {
      return send(response, 200, await readFile(file), "text/javascript; charset=utf-8");
    } catch {
      return send(response, 404, "Not found", "text/plain");
    }
  }
  return send(response, 404, "Not found", "text/plain");
}

const address = `http://localhost:${PORT}`;
const openPage = () => {
  if (!process.argv.includes("--no-open")) exec(process.platform === "win32" ? `start "" ${address}` : `open ${address}`);
};
createServer((request, response) => {
  handle(request, response).catch((error) => send(response, 500, String(error?.message ?? error), "text/plain"));
}).on("error", (error) => {
  if (error.code !== "EADDRINUSE") throw error;
  console.log(`The arcade tester is already running at ${address}, so this opens that one instead.`);
  openPage();
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Arcade tester running at ${address} (Ctrl+C to stop).`);
  openPage();
});
