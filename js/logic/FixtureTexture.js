// Fixture art shared by placed fixtures and placement previews.
import { FIXTURE_FACINGS } from "./FixtureLayout.js";
import { budgetShelfSideTexture } from "./BudgetShelfArt.js";
import { DEFAULT_SHELF_PAINT, isPaintableFixture, paintsWithTint, shelfPaintTint } from "./ShelfPaint.js";
import { ensureGrayTexture, ensureRepaintedTexture, grayTextureKey } from "./TintableArt.js";

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
  return paintsWithTint(spec) ? grayTextureKey(key) : key;
}

/**
 * Shows a fixture's art in its paint: a tint for shelves, a recolored copy for registers
 * (whose default paint is the art as drawn).
 * @param {Phaser.GameObjects.Image} image - already showing getFixtureTexture(spec, rotation)
 */
export function showFixturePaint(scene, image, spec, rotation, paintId) {
  if (paintsWithTint(spec)) {
    image.setTint(shelfPaintTint(paintId));
  } else if (isPaintableFixture(spec)) {
    const key = getUnpaintedFixtureTexture(spec, rotation);
    image.setTexture(!paintId || paintId === DEFAULT_SHELF_PAINT
      ? key : ensureRepaintedTexture(scene, key, shelfPaintTint(paintId)));
  }
  return image;
}

/** Makes the gray copies of every paintable shelf's art, after the narrowed side views exist. */
export function ensureShelfPaintTextures(scene, fixtureTypes) {
  for (const spec of Object.values(fixtureTypes)) {
    if (!paintsWithTint(spec)) continue;
    for (let rotation = 0; rotation < FIXTURE_FACINGS.length; rotation++) {
      ensureGrayTexture(scene, getUnpaintedFixtureTexture(spec, rotation));
    }
  }
}
