// ==========================================
// FILE: BudgetShelfArt.js
// ==========================================
// Where each item space sits on a Budget Shelf's front-view art, in source-image pixels.
// Every size is built from the same pieces by scripts/generate_budget_shelves.py, so keep
// these measurements in sync with it.
const LEFT_POST = 28;
const SECTION = 78;
const DIVIDER = 8;
const RIGHT_POST = 20;
const WIDTH_STEP = 24;
const HEIGHT = 192;
const LEVEL_OPENINGS = [[48, 88], [92, 132], [136, 172]];
// Board tops hold up single rows and the raised back row.
const LEVEL_BOARD_TOPS = [80, 124, 164];

/**
 * @param {number} levels - 2 or 3
 * @param {number} sections - 2 to 4
 */
export function getBudgetShelfArt(levels, sections) {
  if (![2, 3].includes(levels) || ![2, 3, 4].includes(sections)) {
    throw new RangeError(`No Budget Shelf art for ${levels}x${sections}`);
  }
  const natural = LEFT_POST + sections * SECTION + (sections - 1) * DIVIDER + RIGHT_POST;
  const width = Math.ceil(natural / WIDTH_STEP) * WIDTH_STEP;
  const padLeft = Math.floor((width - natural) / 2);
  const columns = Array.from({ length: sections }, (_, index) => {
    const left = padLeft + LEFT_POST + index * (SECTION + DIVIDER);
    return [left, left + SECTION];
  });
  const skipped = LEVEL_OPENINGS.length - levels;
  return {
    width,
    height: HEIGHT,
    // Empty source-image pixels above the visible shelf; the close-up window crops them.
    top: LEVEL_OPENINGS[skipped][0] - LEVEL_OPENINGS[0][0],
    columns,
    rows: LEVEL_OPENINGS.slice(skipped),
    boardTops: LEVEL_BOARD_TOPS.slice(skipped),
  };
}

/** Art for a fixture type built by the Budget Shelf generator, or null for any other shelf. */
export function getBudgetShelfArtForType(fixtureType) {
  if (fixtureType?.artLayout !== "budget") return null;
  return getBudgetShelfArt(fixtureType.shelfRows, fixtureType.shelfColumns);
}

export function budgetShelfSideTexture(sourceKey) {
  return `${sourceKey}_narrow`;
}

/**
 * Cut the middle out of each side view, keeping its posts and pixel thickness unchanged.
 * The original canvas width stays the same so the shelf remains centered on its footprint.
 */
export function ensureBudgetShelfSideTextures(scene, fixtureTypes) {
  for (const spec of Object.values(fixtureTypes)) {
    if (spec.artLayout !== "budget") continue;
    for (const facing of ["left", "right"]) {
      const sourceKey = spec.facingTextures[facing];
      const key = budgetShelfSideTexture(sourceKey);
      if (scene.textures.exists(key)) continue;
      if (!scene.textures.exists(sourceKey)) throw new Error(`Missing shelf artwork: ${sourceKey}`);
      const source = scene.textures.get(sourceKey).getSourceImage();
      if (source.width !== HEIGHT) throw new Error(`Unexpected shelf artwork width: ${sourceKey}`);
      const texture = scene.textures.createCanvas(key, source.width, source.height);
      if (!texture) throw new Error(`Could not create shelf artwork: ${key}`);
      const third = source.width / 3;
      const pad = third / 2;
      texture.context.drawImage(source, 0, 0, third, source.height, pad, 0, third, source.height);
      texture.context.drawImage(source, third * 2, 0, third, source.height, pad + third, 0, third, source.height);
      texture.refresh().setFilter(1);
    }
  }
}
