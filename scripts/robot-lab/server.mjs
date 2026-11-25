// ==========================================
// FILE: scripts/robot-lab/server.mjs
// ==========================================
// A developer tool, not part of the game: the robot lab, a page for writing robot programs
// (if-this-then-that rules, like gambits) and watching them run a pretend store.
// Run with `npm run robots`. Saving writes data/RobotPrograms.json.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProblems, partsProblems } from "../../js/logic/RobotParts.js";

const PORT = 5186;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const DATA_PATH = path.join(ROOT, "data", "RobotPrograms.json");
const SETTING_KEYS = ["shiftSeconds", "registers", "shelves", "stations", "customersPerMinute", "deliveryEverySeconds", "cratesPerDelivery", "backroomCapacity", "startingBackroomCrates", "standardDrain"];

/** Readable reasons the lab setup can't be saved; empty when it can. */
export function setupProblems(setup) {
  const problems = [];
  for (const key of SETTING_KEYS) {
    const value = setup?.settings?.[key];
    if (!Number.isFinite(value) || value < 0) problems.push(`Store setting ${key} must be a number, 0 or more.`);
  }
  for (const key of ["shiftSeconds", "registers", "shelves", "deliveryEverySeconds"]) {
    if (!(setup?.settings?.[key] >= 1)) problems.push(`Store setting ${key} must be at least 1.`);
  }
  const parts = partsProblems(setup?.parts);
  if (parts.length) return [...problems, ...parts];
  if (!Array.isArray(setup?.robots)) return [...problems, "The robot list is missing."];
  setup.robots.forEach((robot, index) => {
    const label = robot?.name?.trim() || `Robot ${index + 1}`;
    if (typeof robot?.name !== "string" || !robot.name.trim()) problems.push(`Robot ${index + 1}: needs a name.`);
    for (const problem of buildProblems(robot, setup.parts)) problems.push(`${label}: ${problem}`);
  });
  return problems;
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

async function handle(request, response, dataPath) {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  if (url.pathname === "/favicon.ico") return response.writeHead(204).end();
  if (request.method === "GET" && url.pathname === "/") {
    return send(response, 200, await readFile(path.join(HERE, "index.html"), "utf8"), "text/html; charset=utf-8");
  }
  if (request.method === "GET" && url.pathname === "/api/data") {
    return send(response, 200, JSON.parse(await readFile(dataPath, "utf8")));
  }
  if (request.method === "POST" && url.pathname === "/api/save") {
    const setup = JSON.parse(await readBody(request));
    const problems = setupProblems(setup);
    if (problems.length) return send(response, 400, { problems });
    await writeFile(dataPath, `${JSON.stringify(setup, null, 2)}\n`, "utf8");
    return send(response, 200, { saved: true });
  }
  if (request.method === "GET" && url.pathname.endsWith(".js")) {
    const file = path.resolve(ROOT, decodeURIComponent(url.pathname.slice(1)));
    const allowed = [path.join(ROOT, "js") + path.sep, HERE + path.sep].some((folder) => file.startsWith(folder));
    if (!allowed) return send(response, 404, { error: "Not found" });
    try {
      return send(response, 200, await readFile(file, "utf8"), "text/javascript; charset=utf-8");
    } catch {
      return send(response, 404, { error: "Not found" });
    }
  }
  return send(response, 404, { error: "Not found" });
}

export function createLabServer({ dataPath = DATA_PATH } = {}) {
  return createServer((request, response) => {
    handle(request, response, dataPath).catch((error) => send(response, 500, { problems: [String(error?.message ?? error)] }));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const address = `http://localhost:${PORT}`;
  const openPage = () => {
    if (!process.argv.includes("--no-open")) exec(process.platform === "win32" ? `start "" ${address}` : `open ${address}`);
  };
  createLabServer().on("error", (error) => {
    if (error.code !== "EADDRINUSE") throw error;
    console.log(`The robot lab is already running at ${address}, so this opens that one instead.`);
    openPage();
  }).listen(PORT, "127.0.0.1", () => {
    console.log(`Robot lab running at ${address} (Ctrl+C to stop).`);
    openPage();
  });
}
