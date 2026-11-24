// ==========================================
// FILE: CustomerSprites.js
// ==========================================
// Customer character art: animated walk sheets (one character per sheet), the faction each
// character belongs to, and the walk/stand animation helpers shared by customers and employees.
// Sheets are 3 columns x 4 rows of 96 px frames: rows face down/left/right/up, and the middle
// column is the standing pose. See CustomerCharacterManifest.json.
import customerCharacterManifest from "../../data/CustomerCharacterManifest.json";
import { gameRandom } from "../core/Random.js";

const FRAME_SIZE = 96;
const FACING_ROWS = Object.freeze({ down: 0, left: 1, right: 2, up: 3 });
// Matches the frame rate the player uses at their own walk speed, scaled to customer speed.
const WALK_FRAME_RATE = 6;

// Sheet pixels are drawn as 2x2 blocks; this keeps one block per 1.33 world px, same as the player.
export const CHARACTER_DISPLAY_SIZE = 64;
// Puts the character's feet at the sprite's position: the feet-sized collision box sits in the
// same spot within the art as the player's (4px above the art's bottom edge).
export const CHARACTER_ORIGIN_Y = 50 / 64;
export { CHARACTER_ART_WIDTH, CHARACTER_ART_HEIGHT, CHARACTER_FEET_DROP } from "./CharacterDimensions.js";
// Pixels trimmed from each side of a character's physics body versus its planning size.
export const CHARACTER_BODY_SLACK = 1;
// px from the sprite's position up to the top of a typical character's head.
export const CHARACTER_HEAD_HEIGHT = 42;

// Sprite-name faction -> game faction id. Civilians and androids belong to no faction.
const FACTION_IDS = Object.freeze({
  mercenary: "mercenaries",
  explorer: "explorers",
  scavenger: "scavengers",
  civilian: null,
  android: null,
});

for (const { key, faction } of customerCharacterManifest) {
  if (!(faction in FACTION_IDS)) throw new Error(`Customer sheet "${key}" has unknown faction "${faction}".`);
}

export function loadCustomerCharacters(load) {
  loadCharacterSheets(load, customerCharacterManifest);
}

export function loadCharacterSheets(load, sheets) {
  for (const { key, path } of sheets) {
    load.spritesheet(key, path, { frameWidth: FRAME_SIZE, frameHeight: FRAME_SIZE });
  }
}

export function registerCustomerAnimations(textures, anims) {
  registerCharacterAnimations(textures, anims, customerCharacterManifest);
}

export function registerCharacterAnimations(textures, anims, sheets) {
  for (const { key } of sheets) {
    textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (const [facing, row] of Object.entries(FACING_ROWS)) {
      const animKey = walkAnimationKey(key, facing);
      if (anims.exists(animKey)) continue;
      anims.create({
        key: animKey,
        frames: [0, 1, 2, 1].map((column) => ({ key, frame: row * 3 + column })),
        frameRate: WALK_FRAME_RATE,
        repeat: -1,
      });
    }
  }
}

function walkAnimationKey(textureKey, facing) {
  return `${textureKey}_walk_${facing}`;
}

export function standingFrame(facing) {
  return FACING_ROWS[facing] * 3 + 1;
}

/**
 * Creates a customer/employee sprite whose collision box sits at its feet, centered on its position.
 * @returns {Phaser.GameObjects.Sprite}
 */
export function addCharacterSprite(scene, x, y, textureKey, navWidth, navHeight) {
  // Paths are planned with the full size and may run flush along a fixture's edge; the
  // slightly smaller body leaves slack so rounding drift can't snag them on that edge.
  const bodyWidth = navWidth - CHARACTER_BODY_SLACK * 2;
  const bodyHeight = navHeight - CHARACTER_BODY_SLACK * 2;
  const sprite = scene.add
    .sprite(x, y, textureKey, standingFrame("down"))
    .setDisplaySize(CHARACTER_DISPLAY_SIZE, CHARACTER_DISPLAY_SIZE)
    .setOrigin(0.5, CHARACTER_ORIGIN_Y);
  scene.physics.add.existing(sprite);
  // Arcade Physics sizes and offsets use unscaled frame pixels.
  const scale = CHARACTER_DISPLAY_SIZE / FRAME_SIZE;
  sprite.body.setSize(bodyWidth / scale, bodyHeight / scale, false);
  sprite.body.setOffset(
    FRAME_SIZE / 2 - bodyWidth / scale / 2,
    FRAME_SIZE * CHARACTER_ORIGIN_Y - bodyHeight / scale / 2,
  );
  sprite.body.updateFromGameObject();
  return sprite;
}

/**
 * Plays the walk cycle for a facing, or holds the standing pose when not moving.
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {"up" | "down" | "left" | "right"} facing
 * @param {boolean} moving
 */
export function showCharacterFacing(sprite, facing, moving) {
  if (moving) {
    sprite.play(walkAnimationKey(sprite.texture.key, facing), true);
    return;
  }
  if (sprite.anims.isPlaying) sprite.anims.stop();
  sprite.setFrame(standingFrame(facing));
}

/**
 * @param {string | null} [factionId] - game faction id; null picks any art but keeps a null
 *   faction (neutral customer), undefined picks any art and reports its faction
 * @returns {{factionId: string | null, textureKey: string}}
 */
export function pickRandomCustomerCharacter(factionId) {
  const knownFactions = Object.values(FACTION_IDS).filter(Boolean);
  if (factionId !== undefined && factionId !== null && !knownFactions.includes(factionId)) {
    throw new Error(`Unknown customer faction "${factionId}".`);
  }
  const candidates = factionId === undefined || factionId === null
    ? customerCharacterManifest
    : customerCharacterManifest.filter((entry) => FACTION_IDS[entry.faction] === factionId);
  if (candidates.length === 0) {
    throw new Error(`No customer sprites are available for faction "${factionId}".`);
  }
  const entry = gameRandom.pick(candidates);
  return {
    factionId: factionId === undefined ? FACTION_IDS[entry.faction] : factionId,
    textureKey: entry.key,
  };
}

/**
 * The same look every time for one name (an employee keeps their face from shift to shift).
 * @param {string} seed - e.g. an employee id
 * @returns {string} texture key
 */
export function characterTextureFor(seed) {
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return customerCharacterManifest[hash % customerCharacterManifest.length].key;
}
