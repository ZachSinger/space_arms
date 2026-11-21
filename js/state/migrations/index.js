// The save upgrade chain. A shop save names its format with `layoutVersion`; older formats
// are upgraded step by step, in order, to the current one. Steps marked `always` look at the
// save's fields rather than its version (they date from before versions were bumped for every
// change), so each is written to do nothing on a save that doesn't need it.
//
// Formats that exist today:
//   layoutVersion 9   before stock fixtures were removed (also: retired job, old shelves)
//   layoutVersion 10  before crates had stable IDs
//   layoutVersion 11  before employees had the cleaning job
//   layoutVersion 12  before heavy ammo moved into its own contract
//   layoutVersion 13  current
// Any may also be from before the contract split (no `contractsSplit`), hold retired
// fixtures, crates, licenses, or a hovercart, or hold shelves stocked under the old rule.
import { requireSave, isRecord } from "../saveHelpers.js";
import { upgradeFixtureEntries } from "./fixtureEntries.js";
import { retireRemovedEquipment } from "./retiredEquipment.js";
import { migrateRemovedEmployeeJob } from "./employeeJobs.js";
import { upgradeContractSplit } from "./contractSplit.js";
import { upgradeShelfStocking } from "./shelfStocking.js";
import { upgradeCrateIds } from "./crateIds.js";
import { addEmployeeCleaningJob } from "./cleaningJob.js";
import { migratePreWarAmmoContract } from "./preWarAmmoContract.js";

// The fixture-retirement upgrade removes stock fixtures and moves their contents into Go-Backs.
export const SHOP_LAYOUT_VERSION = 13;
const OLDEST_SUPPORTED_VERSION = 9;

/**
 * @typedef {{ name: string, always?: boolean, fromVersion?: number,
 *   run: (data: object, database: object) => object }} SaveUpgrade
 */

/** @type {SaveUpgrade[]} */
export const SAVE_UPGRADES = [
  { name: "fixture types", always: true, run: upgradeFixtureEntries },
  { name: "retired equipment refund", always: true, run: retireRemovedEquipment },
  { name: "retired employee job", fromVersion: 9, run: migrateRemovedEmployeeJob },
  { name: "contract split", always: true, run: upgradeContractSplit },
  { name: "hands-on shelf stocking", always: true, run: upgradeShelfStocking },
  { name: "stable crate IDs", fromVersion: 10, run: upgradeCrateIds },
  { name: "employee cleaning job", fromVersion: 11, run: addEmployeeCleaningJob },
  { name: "pre-war ammo contract", fromVersion: 12, run: migratePreWarAmmoContract },
];

/**
 * Brings any supported shop save up to the current format. Never mutates its input.
 * Throws if the save's format is unknown or no longer supported.
 * @param {object} data
 * @param {object} database - item and license lookup
 * @returns {object}
 */
export function upgradeShopSave(data, database) {
  requireSave(isRecord(data), "missing shop state.");
  const version = data.layoutVersion;
  requireSave(Number.isSafeInteger(version) && version >= OLDEST_SUPPORTED_VERSION &&
    version <= SHOP_LAYOUT_VERSION,
    version === undefined || Number.isSafeInteger(version) && version < OLDEST_SUPPORTED_VERSION
      ? "this save uses an unsupported shop layout."
      : "unknown shop layout version.");
  requireSave(Array.isArray(data.fixtures) && data.fixtures.length > 0, "missing fixture layout.");
  let upgraded = data;
  for (const step of SAVE_UPGRADES) {
    if (step.always || version <= step.fromVersion) upgraded = step.run(upgraded, database);
  }
  return upgraded === data
    ? { ...data, layoutVersion: SHOP_LAYOUT_VERSION }
    : Object.assign(upgraded, { layoutVersion: SHOP_LAYOUT_VERSION });
}
