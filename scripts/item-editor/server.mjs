// ==========================================
// FILE: scripts/item-editor/server.mjs
// ==========================================
// A developer tool, not part of the game: a page for seeing, comparing, and editing every
// item in data/Items.json. Run with `npm run items`, then use the page it opens.
// Saving rewrites data/Items.json in its existing layout (2-space indent, short lists on one
// line, Windows line endings), so a save with no edits leaves the file unchanged.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_SUPPLY_RATIO, MAX_SUPPLY_RATIO } from "../../js/logic/Market.js";
import { CRATE_CAPACITY_UNITS } from "../../js/logic/ShelfSlotStocking.js";

const PORT = 5180;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ITEMS_PATH = path.join(ROOT, "data", "Items.json");
const LICENSES_PATH = path.join(ROOT, "data", "Licenses.json");
const IMAGE_ROOT = path.join(ROOT, "img");
const BOX_SIZES = [1, 2, 3, 4, 6, 8, 10, 14, 20];
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

/** Items.json's own layout: lists of plain values stay on one line. */
export function formatItems(items) {
  const value = (entry, indent) => {
    if (Array.isArray(entry)) {
      if (entry.every((part) => part === null || typeof part !== "object")) {
        return `[${entry.map((part) => JSON.stringify(part)).join(", ")}]`;
      }
      const inner = entry.map((part) => `${indent}  ${value(part, `${indent}  `)}`);
      return `[\n${inner.join(",\n")}\n${indent}]`;
    }
    if (entry && typeof entry === "object") {
      const inner = Object.entries(entry).map(([key, part]) => `${indent}  ${JSON.stringify(key)}: ${value(part, `${indent}  `)}`);
      return inner.length ? `{\n${inner.join(",\n")}\n${indent}}` : "{}";
    }
    return JSON.stringify(entry);
  };
  return `${value(items, "")}\n`.replace(/\n/g, "\r\n");
}

export function problemsIn(items, licenseIds) {
  if (!Array.isArray(items)) return ["The item list is missing."];
  const problems = [];
  const seen = new Set();
  items.forEach((item, index) => {
    const label = item?.name || item?.id || `Row ${index + 1}`;
    if (typeof item?.id !== "string" || !item.id.trim()) problems.push(`${label}: needs an id.`);
    else if (seen.has(item.id)) problems.push(`${label}: id "${item.id}" is used twice.`);
    seen.add(item?.id);
    if (typeof item?.name !== "string" || !item.name.trim()) problems.push(`${label}: needs a name.`);
    if (!Number.isFinite(item?.baseCost) || item.baseCost <= 0) problems.push(`${label}: base price must be above 0.`);
    if (!BOX_SIZES.includes(item?.boxSize)) problems.push(`${label}: box size must be one of ${BOX_SIZES.join(", ")}.`);
    if (!licenseIds.has(item?.license)) problems.push(`${label}: unknown contract "${item?.license}".`);
    if (!Array.isArray(item?.tags) || !item.tags.length) problems.push(`${label}: needs at least one tag.`);
  });
  return problems;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

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
  if (request.method === "GET" && url.pathname === "/api/data") {
    const [items, licenses] = await Promise.all([readJson(ITEMS_PATH), readJson(LICENSES_PATH)]);
    return send(response, 200, {
      items,
      licenses: licenses.map(({ id, name, requiredShopLevel }) => ({ id, name, level: requiredShopLevel ?? null })),
      rules: { crateUnits: CRATE_CAPACITY_UNITS, boxSizes: BOX_SIZES, minSupply: MIN_SUPPLY_RATIO, maxSupply: MAX_SUPPLY_RATIO },
    });
  }
  if (request.method === "POST" && url.pathname === "/api/items") {
    const items = JSON.parse(await readBody(request));
    const licenses = await readJson(LICENSES_PATH);
    const problems = problemsIn(items, new Set(licenses.map((license) => license.id)));
    if (problems.length) return send(response, 400, { problems });
    await writeFile(ITEMS_PATH, formatItems(items), "utf8");
    return send(response, 200, { saved: items.length });
  }
  if (request.method === "GET" && url.pathname.startsWith("/js/")) {
    const file = path.resolve(ROOT, decodeURIComponent(url.pathname.slice(1)));
    if (!file.startsWith(path.join(ROOT, "js") + path.sep) || path.extname(file) !== ".js") return send(response, 404, { error: "Not found" });
    try {
      return send(response, 200, await readFile(file, "utf8"), "text/javascript; charset=utf-8");
    } catch {
      return send(response, 404, { error: "Not found" });
    }
  }
  if (request.method === "GET" && url.pathname.startsWith("/img/")) {
    const file = path.resolve(ROOT, decodeURIComponent(url.pathname.slice(1)));
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (!file.startsWith(IMAGE_ROOT + path.sep) || !type) return send(response, 404, { error: "Not found" });
    try {
      return send(response, 200, await readFile(file), type);
    } catch {
      return send(response, 404, { error: "Not found" });
    }
  }
  return send(response, 404, { error: "Not found" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer((request, response) => {
    handle(request, response).catch((error) => send(response, 500, { problems: [String(error?.message ?? error)] }));
  }).listen(PORT, "127.0.0.1", () => {
    const address = `http://localhost:${PORT}`;
    console.log(`Item editor running at ${address} (Ctrl+C to stop).`);
    if (!process.argv.includes("--no-open")) exec(process.platform === "win32" ? `start "" ${address}` : `open ${address}`);
  });
}
