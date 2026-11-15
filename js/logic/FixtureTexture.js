// Fixture art shared by placed fixtures and placement previews.
import { FIXTURE_FACINGS } from "./FixtureLayout.js";

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
