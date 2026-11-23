// ==========================================
// FILE: StartingTemplate.js
// ==========================================
// How every new shop starts: the money in hand and each placed fixture, shelf stock included.
// The DEV "Starting Template" area edits it and its Snapshot button rewrites
// data/StartingTemplate.json through the dev server (see vite.config.js).
import template from "../../data/StartingTemplate.json" with { type: "json" };
import { getFixtureType } from "./FixtureLayout.js";

export const STARTING_TEMPLATE_ENDPOINT = "/__dev/starting-template";

// Replaced in place after a snapshot, so a new game started without reloading uses it too.
const current = structuredClone(template);

/** @returns {number} */
export function startingMoney() {
  return current.money;
}

/** @returns {object[]} copies of the saved fixture entries, safe to build models from */
export function startingFixtures() {
  return structuredClone(current.fixtures);
}

/**
 * @param {unknown} data
 * @returns {string | null} why it can't be a starting template, or null if it can
 */
export function startingTemplateProblem(data) {
  if (!data || typeof data !== "object") return "The template is missing.";
  if (!Number.isInteger(data.money) || data.money < 0) return "Starting money must be a whole number, zero or more.";
  if (!Array.isArray(data.fixtures)) return "The template has no fixture list.";
  for (const entry of data.fixtures) {
    if (!entry || typeof entry.id !== "string" || typeof entry.type !== "string" ||
      !Number.isFinite(entry.gx) || !Number.isFinite(entry.gy)) return "A fixture in the template is incomplete.";
  }
  if (!data.fixtures.some((entry) => getFixtureType(entry.type)?.kind === "register")) return "The shop needs a register.";
  return null;
}

/**
 * Uses this starting template for every new game from now on, without saving it to disk.
 * @param {{ money: number, fixtures: object[] }} data
 */
export function useStartingTemplate(data) {
  const problem = startingTemplateProblem(data);
  if (problem) throw new Error(problem);
  current.money = data.money;
  current.fixtures = structuredClone(data.fixtures);
}

/**
 * Saves a new starting template to data/StartingTemplate.json (dev server only) and uses it
 * for every new game from now on.
 * @param {{ money: number, fixtures: object[] }} data
 * @param {typeof fetch} [fetcher]
 */
export async function saveStartingTemplate(data, fetcher = fetch) {
  const problem = startingTemplateProblem(data);
  if (problem) throw new Error(problem);
  const response = await fetcher(STARTING_TEMPLATE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (response.status === 404) throw new Error("Snapshot only works while the game runs from the dev server.");
  if (!response.ok) throw new Error((await response.text()) || `The dev server said ${response.status}.`);
  useStartingTemplate(data);
}
