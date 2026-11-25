// Fixture art shared by placed fixtures and placement previews.
import { FIXTURE_FACINGS } from "./FixtureLayout.js";
import { budgetShelfSideTexture } from "./BudgetShelfArt.js";
import { isPaintableFixture } from "./ShelfPaint.js";
import { ensureGrayTexture, grayTextureKey } from "./TintableArt.js";

/**
 * Fixtures with art drawn for each facing show that art upright instead of a spun image.
 * @param {object} spec
 */
export function hasFacingTextures(spec) {
  return Boolean(spec?.facingTextures);
}

/** The art as drawn, before any gray copy for painting. */
export function getUnpaintedFixtureTexture(spec, rotation = 0) {
  if (hasFacingTextures(spec)) {
    const facing = FIXTURE_FACINGS[rotation % 4];
    const key = spec.facingTextures[facing];
    return spec.artLayout === "budget" && (facing === "left" || facing === "right")
      ? budgetShelfSideTexture(key) : key;
  }
  return spec.texture;
}

/** What the map shows. Paintable shelves use a gray copy, tinted by shelfPaintTint. */
export function getFixtureTexture(spec, rotation = 0) {
  const key = getUnpaintedFixtureTexture(spec, rotation);
  return isPaintableFixture(spec) ? grayTextureKey(key) : key;
}

/** Makes the gray copies of every paintable shelf's art, after the narrowed side views exist. */
export function ensureShelfPaintTextures(scene, fixtureTypes) {
  for (const spec of Object.values(fixtureTypes)) {
    if (!isPaintableFixture(spec)) continue;
    for (let rotation = 0; rotation < FIXTURE_FACINGS.length; rotation++) {
      ensureGrayTexture(scene, getUnpaintedFixtureTexture(spec, rotation));
    }
  }
}
