// Fixture art shared by placed fixtures and placement previews. Shelves without drawn art
// get a temporary overhead placeholder.
import { TILE_SIZE } from "./RoomLayout.js";
import { FIXTURE_FACINGS, SHELF_VISUAL_SLOTS_PER_TILE } from "./FixtureLayout.js";
import { PLAYER_DISPLAY_WIDTH, PLAYER_SPRITE } from "./Player.js";

export const TEST_SHELF_SURFACE_COLOR = 0x18212c;

export const SINGLE_LOCKER_SPRITES = Object.freeze({
  down: { key: "locker_single_animated", path: "img/Icons_Extracted/Tileset/Fixtures/locker_single_opening.png", frameWidth: 54, frameHeight: 102, originX: 0.5 },
  left: { key: "locker_single_left_animated", path: "img/Icons_Extracted/Tileset/Fixtures/locker_single_left_opening.png", frameWidth: 54, frameHeight: 102, originX: 2 / 3 },
  up: { key: "locker_single_up_animated", path: "img/Icons_Extracted/Tileset/Fixtures/locker_single_up_opening.png", frameWidth: 72, frameHeight: 102, originX: 0.625 },
  right: { key: "locker_single_right_animated", path: "img/Icons_Extracted/Tileset/Fixtures/locker_single_right_opening.png", frameWidth: 54, frameHeight: 102, originX: 1 / 3 },
});

export function getSingleLockerSprite(rotation = 0) {
  return SINGLE_LOCKER_SPRITES[FIXTURE_FACINGS[rotation]];
}

export function sizeSingleLocker(sprite, rotation = 0) {
  const sheet = getSingleLockerSprite(rotation);
  const scale = PLAYER_DISPLAY_WIDTH / PLAYER_SPRITE.frameWidth;
  return sprite.setDisplaySize(
    sheet.frameWidth * scale, sheet.frameHeight * scale,
  ).setOrigin(sheet.originX, 0.5);
}

/**
 * Fixtures with art drawn for each facing show that art upright instead of a spun image.
 * @param {object} spec
 */
export function hasFacingTextures(spec) {
  return Boolean(spec?.facingTextures);
}

export function getFixtureTexture(scene, spec, rotation = 0) {
  if (hasFacingTextures(spec)) return spec.facingTextures[FIXTURE_FACINGS[rotation % 4]];
  if (spec.kind !== "shelf") return spec.texture;
  const key = `test-shelf:${spec.id}`;
  if (scene.textures.exists(key)) return key;

  const width = spec.w * TILE_SIZE;
  const height = spec.h * TILE_SIZE;
  const slotSize = TILE_SIZE / SHELF_VISUAL_SLOTS_PER_TILE;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  try {
    graphics.fillStyle(0x526576).fillRect(0, 0, width, height);
    graphics.fillStyle(TEST_SHELF_SURFACE_COLOR).fillRect(2, 2, width - 4, height - 4);
    graphics.fillStyle(0x324353);
    for (let x = slotSize; x < width; x += slotSize) {
      graphics.fillRect(x - 1, 2, 2, height - 4);
    }
    for (let y = slotSize; y < height; y += slotSize) {
      graphics.fillRect(2, y - 1, width - 4, 2);
    }
    // The light front edge faces the customer; stock boxes leave this rim visible.
    graphics.fillStyle(0xb7cad6).fillRect(2, height - 2, width - 4, 2);
    graphics.generateTexture(key, width, height);
  } finally {
    graphics.destroy();
  }
  return key;
}
