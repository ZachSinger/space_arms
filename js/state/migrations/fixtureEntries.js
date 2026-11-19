// Upgrade step: fixture entries from before fixture types get their type, and the old 2x4 id,
// which was sold as a three-level shelf, keeps that shelf.
import { migrateFixtureEntry } from "../../logic/FixtureLayout.js";

/** @param {object} data */
export function upgradeFixtureEntries(data) {
  if (!Array.isArray(data.fixtures)) return data;
  return { ...data, fixtures: data.fixtures.map((raw) => {
    const entry = migrateFixtureEntry(raw);
    return entry?.type === "shelf_budget_2x4" && entry.stockingVersion === undefined
      ? { ...entry, type: "shelf_budget_3x4" } : { ...entry };
  }) };
}
