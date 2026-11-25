// ==========================================
// FILE: scripts/ship-painter/server.mjs
// ==========================================
// A developer tool, not part of the game: a page showing the gray faction ship concepts from
// several angles, with sliders to color the hull and the engine flames. Run with `npm run ship`.
// The art lives in art/<ship id>/ and is kept local (images are git-ignored).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 5184;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(HERE, "art");

function send(response, status, body, type) {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(body);
}

async function handle(request, response) {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  if (request.method !== "GET") return send(response, 404, "Not found", "text/plain");
  if (url.pathname === "/") return send(response, 200, await readFile(path.join(HERE, "index.html")), "text/html; charset=utf-8");
  if (url.pathname.startsWith("/art/")) {
    const file = path.resolve(ART, decodeURIComponent(url.pathname.slice(5)));
    if (!file.startsWith(ART + path.sep) || path.extname(file) !== ".png") return send(response, 404, "Not found", "text/plain");
    try {
      return send(response, 200, await readFile(file), "image/png");
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
  console.log(`The ship painter is already running at ${address}, so this opens that one instead.`);
  openPage();
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Ship painter running at ${address} (Ctrl+C to stop).`);
  openPage();
});
