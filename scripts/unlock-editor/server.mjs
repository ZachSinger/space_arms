// ==========================================
// FILE: scripts/unlock-editor/server.mjs
// ==========================================
// A developer tool, not part of the game: a page for editing when things unlock and what they
// cost (shop level reputation, contracts, expansions, staff, the hovercart, fixtures, and
// starting money). Run with `npm run unlocks`, then use the page it opens.
// Saving changes only the edited numbers in each data file and leaves their layout alone.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatItems } from "../item-editor/server.mjs";
import { ZONES, EXPANSION_ORDER, BACKROOM_UPGRADE_ORDER } from "../../js/logic/RoomLayout.js";

const PORT = 5181;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const FILES = {
  progression: path.join(ROOT, "data", "Progression.json"),
  licenses: path.join(ROOT, "data", "Licenses.json"),
  fixtures: path.join(ROOT, "data", "Fixtures.json"),
  start: path.join(ROOT, "data", "StartingTemplate.json"),
  items: path.join(ROOT, "data", "Items.json"),
};
const CHARGER_ID = "hovercart_charger";
const ZONE_IDS = [...EXPANSION_ORDER, ...BACKROOM_UPGRADE_ORDER];
const UPGRADE_PATHS = ["speed", "length", "battery"];

/** Everything the page shows; the numbers in it are what you can edit. */
export function buildState(texts) {
  const progression = JSON.parse(texts.progression);
  const licenses = JSON.parse(texts.licenses);
  const fixtures = JSON.parse(texts.fixtures);
  const items = JSON.parse(texts.items);
  const licenseNames = new Map(licenses.map((license) => [license.id, license.name]));
  return {
    money: JSON.parse(texts.start).money,
    reputation: [...progression.shopLevelReputation],
    staffLevels: [...progression.staffLimitLevels],
    hireCost: progression.employees.hireCost,
    baseWage: progression.employees.baseWage,
    hovercartLevel: progression.hovercart.level,
    hovercartPrice: fixtures[CHARGER_ID].price,
    upgrades: Object.fromEntries(UPGRADE_PATHS.map((name) => [name, progression.hovercart.upgrades[name].map((step) => ({ ...step }))])),
    zones: ZONE_IDS.map((id) => ({
      id,
      name: ZONES.find((zone) => zone.id === id).name,
      cost: progression.zones[id].cost,
      level: progression.zones[id].requiredShopLevel,
    })),
    licenses: licenses.map((license) => ({
      id: license.id,
      name: license.name,
      cost: license.baseCost,
      level: license.requiredShopLevel ?? null,
      itemCount: items.filter((item) => item.license === license.id).length,
      fixtureCount: license.unlocksFixtures?.length ?? 0,
    })),
    fixtures: Object.values(fixtures)
      .filter((fixture) => fixture.id !== CHARGER_ID)
      .map((fixture) => ({ id: fixture.id, name: fixture.name, price: fixture.price, contract: licenseNames.get(fixture.licenseId) ?? "" })),
  };
}

/** Just the editable numbers, for checking a save wrote exactly what was asked. */
function editable(state) {
  return {
    money: state.money,
    reputation: state.reputation,
    staffLevels: state.staffLevels,
    hireCost: state.hireCost,
    baseWage: state.baseWage,
    hovercartLevel: state.hovercartLevel,
    hovercartPrice: state.hovercartPrice,
    upgrades: UPGRADE_PATHS.map((name) => state.upgrades[name].map(({ level, cost }) => [level, cost])),
    zones: state.zones.map(({ id, cost, level }) => [id, cost, level]),
    licenses: state.licenses.map(({ id, cost, level }) => [id, cost, level]),
    fixtures: state.fixtures.map(({ id, price }) => [id, price]),
  };
}

const isWhole = (value) => Number.isSafeInteger(value);
const isAmount = (value) => Number.isFinite(value) && value >= 0;

/** Readable reasons the edits can't be saved; empty when they can. */
export function problemsIn(state) {
  const problems = [];
  const maxLevel = state.reputation.length;
  const checkLevel = (label, level) => {
    if (!isWhole(level) || level < 1 || level > maxLevel) problems.push(`${label}: unlock level must be a whole number from 1 to ${maxLevel}.`);
  };
  const checkCost = (label, cost) => {
    if (!isAmount(cost)) problems.push(`${label}: cost must be 0 or more.`);
  };
  if (!isWhole(state.money) || state.money < 0) problems.push("Starting money must be a whole number, 0 or more.");
  state.reputation.forEach((value, index) => {
    if (!isWhole(value)) problems.push(`Shop level ${index + 1}: reputation must be a whole number.`);
    else if (index === 0 && value !== 0) problems.push("Shop level 1 must need 0 reputation.");
    else if (index > 0 && value <= state.reputation[index - 1]) problems.push(`Shop level ${index + 1}: must need more reputation than level ${index}.`);
  });
  state.staffLevels.forEach((level, index) => {
    checkLevel(`Employee ${index + 1}`, level);
    if (index > 0 && level < state.staffLevels[index - 1]) problems.push(`Employee ${index + 1}: can't unlock before employee ${index}.`);
  });
  checkCost("Hiring cost", state.hireCost);
  checkCost("Wage per shift", state.baseWage);
  checkLevel("Hovercart", state.hovercartLevel);
  checkCost("Hovercart", state.hovercartPrice);
  for (const name of UPGRADE_PATHS) {
    state.upgrades[name].forEach((step, index) => {
      const label = `Hovercart ${name} upgrade ${index + 1}`;
      checkLevel(label, step.level);
      checkCost(label, step.cost);
      if (index > 0 && step.level < state.upgrades[name][index - 1].level) problems.push(`${label}: can't unlock before upgrade ${index}.`);
    });
  }
  for (const zone of state.zones) {
    checkLevel(zone.name, zone.level);
    checkCost(zone.name, zone.cost);
  }
  for (const license of state.licenses) {
    if (license.level !== null) checkLevel(license.name, license.level);
    checkCost(license.name, license.cost);
  }
  for (const fixture of state.fixtures) checkCost(fixture.name, fixture.price);
  return problems;
}

/** Replaces the first `"key": number` inside text[start, end). */
function setValue(text, [start, end], key, value, where) {
  const match = new RegExp(`("${key}":\\s*)(-?[\\d.]+)`).exec(text.slice(start, end));
  if (!match) throw new Error(`Couldn't find ${key} for ${where}.`);
  const at = start + match.index + match[1].length;
  return text.slice(0, at) + JSON.stringify(value) + text.slice(at + match[2].length);
}

/** Start and end of the entry with this id in a list file like Licenses.json. */
function listEntry(text, id) {
  const start = text.indexOf(`"id": ${JSON.stringify(id)}`);
  if (start < 0) throw new Error(`Couldn't find ${id}.`);
  const next = text.indexOf('"id": "', start + 1);
  return [start, next < 0 ? text.length : next];
}

/** Start and end of a top-level entry in a keyed file like Fixtures.json. */
function keyedEntry(text, id) {
  const start = text.indexOf(`\n  ${JSON.stringify(id)}: {`);
  if (start < 0) throw new Error(`Couldn't find ${id}.`);
  const after = /\n {2}"[^"]+": \{/g;
  after.lastIndex = start + 1;
  const next = after.exec(text);
  return [start, next ? next.index : text.length];
}

/** New file texts with the state's numbers written in; files with no changes stay identical. */
export function applyState(texts, state) {
  const progression = JSON.parse(texts.progression);
  progression.shopLevelReputation = [...state.reputation];
  progression.staffLimitLevels = [...state.staffLevels];
  progression.employees.hireCost = state.hireCost;
  progression.employees.baseWage = state.baseWage;
  progression.hovercart.level = state.hovercartLevel;
  for (const name of UPGRADE_PATHS) {
    progression.hovercart.upgrades[name].forEach((step, index) => {
      step.level = state.upgrades[name][index].level;
      step.cost = state.upgrades[name][index].cost;
    });
  }
  for (const zone of state.zones) {
    progression.zones[zone.id].cost = zone.cost;
    progression.zones[zone.id].requiredShopLevel = zone.level;
  }

  const oldLicenses = new Map(JSON.parse(texts.licenses).map((license) => [license.id, license]));
  let licenses = texts.licenses;
  for (const license of state.licenses) {
    const old = oldLicenses.get(license.id);
    if (old.baseCost !== license.cost) licenses = setValue(licenses, listEntry(licenses, license.id), "baseCost", license.cost, license.name);
    if (license.level !== null && old.requiredShopLevel !== license.level) {
      licenses = setValue(licenses, listEntry(licenses, license.id), "requiredShopLevel", license.level, license.name);
    }
  }

  const oldFixtures = JSON.parse(texts.fixtures);
  let fixtures = texts.fixtures;
  for (const [id, price] of [...state.fixtures.map((fixture) => [fixture.id, fixture.price]), [CHARGER_ID, state.hovercartPrice]]) {
    if (oldFixtures[id].price !== price) fixtures = setValue(fixtures, keyedEntry(fixtures, id), "price", price, id);
  }

  let start = texts.start;
  if (JSON.parse(start).money !== state.money) start = setValue(start, [0, start.length], "money", state.money, "starting money");

  const next = { ...texts, progression: formatItems(progression), licenses, fixtures, start };
  if (JSON.stringify(editable(buildState(next))) !== JSON.stringify(editable(state))) {
    throw new Error("The files didn't come out matching the edits, so nothing was saved.");
  }
  return next;
}

async function readTexts() {
  const entries = await Promise.all(Object.entries(FILES).map(async ([key, file]) => [key, await readFile(file, "utf8")]));
  return Object.fromEntries(entries);
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
    return send(response, 200, buildState(await readTexts()));
  }
  if (request.method === "POST" && url.pathname === "/api/save") {
    const state = JSON.parse(await readBody(request));
    const problems = problemsIn(state);
    if (problems.length) return send(response, 400, { problems });
    const texts = await readTexts();
    const next = applyState(texts, state);
    for (const key of ["progression", "licenses", "fixtures", "start"]) {
      if (next[key] !== texts[key]) await writeFile(FILES[key], next[key], "utf8");
    }
    return send(response, 200, { saved: true });
  }
  return send(response, 404, { error: "Not found" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const address = `http://localhost:${PORT}`;
  const openPage = () => {
    if (!process.argv.includes("--no-open")) exec(process.platform === "win32" ? `start "" ${address}` : `open ${address}`);
  };
  createServer((request, response) => {
    handle(request, response).catch((error) => send(response, 500, { problems: [String(error?.message ?? error)] }));
  }).on("error", (error) => {
    if (error.code !== "EADDRINUSE") throw error;
    console.log(`The unlock editor is already running at ${address}, so this opens that one instead.`);
    openPage();
  }).listen(PORT, "127.0.0.1", () => {
    console.log(`Unlock editor running at ${address} (Ctrl+C to stop).`);
    openPage();
  });
}
