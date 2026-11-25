// ==========================================
// FILE: scripts/room-painter/server.mjs
// ==========================================
// A developer tool, not part of the game: a page for picking the floor, wall and border tiles
// from the game's tile art (shown gray) and coloring each one. Run with `npm run room`.
// Saving writes documentation/Modules/RoomColors.json so the chosen look can be built in later.
import { createServer } from "node:http";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 5183;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const LOOK_FILE = path.join(ROOT, "documentation", "Modules", "RoomColors.json");
const TILESET = path.join(ROOT, "img", "Icons_Extracted", "Tileset");
// The page may read game art and the game's own gray-art code, nothing else.
const SHARED = { "/img/": path.join(ROOT, "img"), "/js/": path.join(ROOT, "js") };
const TYPES = { ".png": "image/png", ".js": "text/javascript; charset=utf-8" };
// The game draws its own floor, wall and border in code (js/world/RoomArt.js); the page adds
// those first. Borders can also use any wall tile, plus the original border art.
const BORDER_ART = [["Shop/shop_border.png", "Shop border (original art)"], ["Backroom/backroom_border.png", "Backroom border (original art)"]];

function send(response, status, body, type = "application/json") {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(type === "application/json" ? JSON.stringify(body) : body);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function label(file, prefix) {
  const words = file.slice(prefix.length, -4).split("_").map((word) => (/^\d+$/.test(word) ? String(Number(word)) : word));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function listTiles() {
  const files = (await readdir(TILESET)).filter((file) => file.endsWith(".png")).sort();
  const tile = (file, name) => ({ id: file, label: name, url: `/img/Icons_Extracted/Tileset/${file}` });
  const pick = (prefix) => files.filter((file) => file.startsWith(prefix)).map((file) => tile(file, label(file, prefix)));
  const walls = pick("wall_");
  return { floors: pick("floor_"), walls, borders: [...BORDER_ART.map(([file, name]) => tile(file, name)), ...walls] };
}

async function readLook() {
  try {
    return JSON.parse(await readFile(LOOK_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function handle(request, response) {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  if (request.method === "GET" && url.pathname === "/") {
    return send(response, 200, await readFile(path.join(HERE, "index.html"), "utf8"), "text/html; charset=utf-8");
  }
  if (request.method === "GET" && url.pathname === "/api/tiles") {
    return send(response, 200, { ...(await listTiles()), look: await readLook() });
  }
  if (request.method === "POST" && url.pathname === "/api/look") {
    const look = JSON.parse(await readBody(request));
    if (["floor", "wall", "border"].some((part) => !look?.[part]?.tile || !look[part].color)) {
      return send(response, 400, { problems: ["The floor, wall or border choice was missing, so nothing was saved."] });
    }
    await writeFile(LOOK_FILE, `${JSON.stringify(look, null, 2)}\n`, "utf8");
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
  console.log(`The room painter is already running at ${address}, so this opens that one instead.`);
  openPage();
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Room painter running at ${address} (Ctrl+C to stop).`);
  openPage();
});
