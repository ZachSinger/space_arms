// Fixture art shared by placed fixtures and placement previews.
import { FIXTURE_FACINGS } from "./FixtureLayout.js";
import { PLAYER_DISPLAY_WIDTH, PLAYER_SPRITE } from "./Player.js";

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

export function getFixtureTexture(spec, rotation = 0) {
  if (hasFacingTextures(spec)) return spec.facingTextures[FIXTURE_FACINGS[rotation % 4]];
  return spec.texture;
}
