// ==========================================
// FILE: CustomerSprites.js
// ==========================================
// Customer character art: the roster of distinct sprite characters (faction + number) and
// their four facing textures, derived from CustomerSpriteManifest.json.
import customerSpriteManifest from "../../data/CustomerSpriteManifest.json";

// Built from the manifest so adding or removing sprites needs no hardcoded count.
const ROSTER = (() => {
  const seen = new Map(); // "faction_num" -> { faction, num }
  const pattern = /^customer_([a-z]+)_(\d+)_(down|up|left|right)$/;

  for (const { key } of customerSpriteManifest) {
    const match = key.match(pattern);
    if (!match) continue;
    const [, faction, num] = match;
    seen.set(`${faction}_${num}`, { faction, num });
  }

  return [...seen.values()];
})();

// Sprite-name faction -> game faction id.
const FACTION_IDS = {
  mercenary: "mercenaries",
  explorer: "explorers",
  scavenger: "scavengers",
};

function characterTextures(entry) {
  return {
    down: `customer_${entry.faction}_${entry.num}_down`,
    up: `customer_${entry.faction}_${entry.num}_up`,
    left: `customer_${entry.faction}_${entry.num}_left`,
    right: `customer_${entry.faction}_${entry.num}_right`,
  };
}

/**
 * @param {string | null} [factionId] - game faction id; null picks any art but keeps a null
 *   faction (neutral customer), undefined picks any art and reports its faction
 * @returns {{factionId: string | null, facingTextures: object}}
 */
export function pickRandomCustomerCharacter(factionId) {
  if (factionId !== undefined && factionId !== null &&
    !Object.values(FACTION_IDS).includes(factionId)) {
    throw new Error(`Unknown customer faction "${factionId}".`);
  }
  const candidates = factionId === undefined || factionId === null
    ? ROSTER
    : ROSTER.filter((entry) => FACTION_IDS[entry.faction] === factionId);
  if (candidates.length === 0) {
    throw new Error(`No customer sprites are available for faction "${factionId}".`);
  }
  const entry = Phaser.Utils.Array.GetRandom(candidates);
  return {
    factionId: factionId === undefined
      ? FACTION_IDS[entry.faction] || null
      : factionId,
    facingTextures: characterTextures(entry),
  };
}

// Deterministic so the player's look stays stable across sessions. No player sprite exists
// yet, so this reuses customer art; Player.js tints it to stand apart from NPCs.
export function pickPlayerCharacterTextures() {
  return characterTextures(ROSTER[0]);
}
