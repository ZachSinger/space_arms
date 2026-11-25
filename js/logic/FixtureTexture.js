// Fixture art shared by placed fixtures and placement previews.
import { FIXTURE_FACINGS } from "./FixtureLayout.js";
import { budgetShelfSideTexture } from "./BudgetShelfArt.js";

/**
 * Fixtures with art drawn for each facing show that art upright instead of a spun image.
 * @param {object} spec
 */
export function hasFacingTextures(spec) {
  return Boolean(spec?.facingTextures);
}

export function getFixtureTexture(spec, rotation = 0) {
  if (hasFacingTextures(spec)) {
    const facing = FIXTURE_FACINGS[rotation % 4];
    const key = spec.facingTextures[facing];
    return spec.artLayout === "budget" && (facing === "left" || facing === "right")
      ? budgetShelfSideTexture(key) : key;
  }
  return spec.texture;
}
