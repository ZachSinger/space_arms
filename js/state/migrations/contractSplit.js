// Upgrade step: some supplier contracts were split into two. Saves from before the split keep
// every product they could already order, so they also get each follow-up contract.
import licenseRoster from "../../../data/Licenses.json" with { type: "json" };
import { isRecord } from "../saveHelpers.js";

/** @param {object} data */
export function upgradeContractSplit(data) {
  const player = data.playerState;
  if (!isRecord(player) || player.contractsSplit === true || !Array.isArray(player.activeLicenses)) return data;
  const added = licenseRoster
    .filter((license) => license.splitFrom && player.activeLicenses.includes(license.splitFrom) &&
      !player.activeLicenses.includes(license.id))
    .map((license) => license.id);
  return {
    ...data,
    playerState: { ...player, activeLicenses: [...player.activeLicenses, ...added], contractsSplit: true },
  };
}
