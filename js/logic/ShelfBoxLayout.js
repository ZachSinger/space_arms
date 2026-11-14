// Shared source-pixel packing for the Shelf Lab, shelf window, and shop-floor display.
const BOX_LAYOUTS = Object.freeze({
  1: { across: 5, depth: 2, stackedRows: 2, width: 13, height: 16 },
  2: { across: 5, depth: 2, stackedRows: 1, width: 13, height: 34 },
  3: { across: 3, depth: 2, stackedRows: 1, width: 23, height: 34 },
  4: { across: 5, depth: 1, stackedRows: 1, width: 14, height: 36 },
  6: { across: 3, depth: 1, stackedRows: 1, width: 24, height: 36 },
  8: { across: 2, depth: 1, stackedRows: 1, width: 34, height: 36 },
  10: { across: 2, depth: 1, stackedRows: 1, width: 37, height: 36 },
  14: { across: 1, depth: 1, stackedRows: 1, width: 56, height: 36 },
  20: { across: 1, depth: 1, stackedRows: 1, width: 76, height: 38 },
});

export function getShelfBoxes(art, gx, gy, size, quantity) {
  const layout = BOX_LAYOUTS[size];
  if (!layout || !art.columns[gx] || !art.rows[gy] ||
    !Number.isInteger(quantity) || quantity < 0 || quantity > Math.floor(20 / size)) {
    throw new RangeError("Invalid shelf box layout.");
  }
  const [left, right] = art.columns[gx];
  const gap = (right - left - layout.width * layout.across) / (layout.across + 1);
  const perLayer = layout.across * layout.stackedRows;
  const support = art.boardTops[gy] - (layout.depth > 1 ? 2 : 0);
  const height = Math.min(layout.height,
    (support - art.rows[gy][0]) / (1 + (layout.stackedRows - 1) * 0.68));
  return Array.from({ length: quantity }, (_, index) => {
    const layer = Math.floor(index / perLayer);
    const level = Math.floor(index % perLayer / layout.across);
    const back = layer === 0 && layout.depth > 1;
    const bottom = (back ? art.boardTops[gy] - 2
      : layout.depth > 1 ? art.rows[gy][1] : art.boardTops[gy]) - level * height * 0.68;
    return {
      x: left + gap + (index % layout.across) * (layout.width + gap),
      y: bottom - height,
      width: layout.width,
      height,
      back,
      depth: layer * 0.1 + level * 0.01,
    };
  });
}
