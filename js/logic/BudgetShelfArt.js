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
