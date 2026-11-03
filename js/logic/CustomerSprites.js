// ==========================================
// FILE: CustomerSprites.js
// ==========================================
import customerSpriteManifest from "../../data/CustomerSpriteManifest.json";

// Derives the roster of distinct characters (faction + number) from the manifest itself,
// so this stays correct automatically if sprites are added/removed/regenerated later --
// the roster itself has no hardcoded character count.
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

export function pickRandomCustomerCharacter() {
  const entry = Phaser.Utils.Array.GetRandom(ROSTER);
  return {
    factionId: FACTION_IDS[entry.faction] || null,
    facingTextures: characterTextures(entry),
  };
}

// Deterministic (not random, unlike pickRandomCustomerCharacter) so the player's look is
// stable across every session instead of reshuffling each time the game loads. Temporary:
// no dedicated player sprite exists yet, so this reuses customer art -- see Player.js,
// which tints it at render time to stay visually distinct from NPC customers. Tracked in
// TODO.md for real player-specific art later.
export function pickPlayerCharacterTextures() {
  return characterTextures(ROSTER[0]);
}
