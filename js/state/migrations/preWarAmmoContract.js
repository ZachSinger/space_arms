import { isRecord } from "../saveHelpers.js";

const LEGACY_AMMO_LICENSES = new Set(["lic_start_ammo", "lic_start_rifle_ammo"]);
const PRE_WAR_AMMO_LICENSE = "lic_edge_antique_ammo";

export function migratePreWarAmmoContract(data) {
  const player = data.playerState;
  if (!isRecord(player) || !Array.isArray(player.activeLicenses) ||
      player.activeLicenses.includes(PRE_WAR_AMMO_LICENSE) ||
      !player.activeLicenses.some((id) => LEGACY_AMMO_LICENSES.has(id))) {
    return data;
  }

  return {
    ...data,
    playerState: {
      ...player,
      activeLicenses: [...player.activeLicenses, PRE_WAR_AMMO_LICENSE],
    },
  };
}
