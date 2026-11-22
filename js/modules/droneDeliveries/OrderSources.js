// ==========================================
// FILE: OrderSources.js
// ==========================================
// Where in the shop a remote order's items can be found right now: which shelves and crates
// hold them, which area each is in, and a short player-facing summary of those places.

/**
 * @typedef {{ kind: "shelf" | "crate" | "carried", target: object, area: string, quantity: number,
 *   x: number, y: number }} OrderSource
 */

/**
 * Every shelf and crate currently holding an item, with how many each holds.
 * @param {string} itemId
 * @param {{ shelves: object[], floorCrates: object[], carriedCrates: object[],
 *   shelfPoint: (shelf: object) => { x: number, y: number },
 *   areaAtPoint: (x: number, y: number) => string }} shop
 * @returns {OrderSource[]}
 */
export function findOrderItemSources(itemId, { shelves, floorCrates, carriedCrates, shelfPoint, areaAtPoint }) {
  const sources = [];
  for (const shelf of shelves) {
    const quantity = shelf.placements
      .filter((placement) => placement.itemId === itemId)
      .reduce((sum, placement) => sum + Math.max(0, placement.quantity), 0);
    if (quantity <= 0) continue;
    const { x, y } = shelfPoint(shelf);
    sources.push({ kind: "shelf", target: shelf, area: areaAtPoint(x, y), quantity, x, y });
  }
  const holdsItem = (crate) => crate.kind === "item" && crate.itemId === itemId && crate.quantity > 0;
  for (const crate of floorCrates) {
    if (!holdsItem(crate)) continue;
    const { x, y } = crate.sprite;
    sources.push({ kind: "crate", target: crate, area: areaAtPoint(x, y), quantity: crate.quantity, x, y });
  }
  for (const crate of carriedCrates) {
    if (!holdsItem(crate)) continue;
    const { x, y } = crate.sprite;
    sources.push({ kind: "carried", target: crate, area: areaAtPoint(x, y), quantity: crate.quantity, x, y });
  }
  return sources;
}

/**
 * "Sales floor shelves: 6 · Backroom crates: 12", grouped by area and by shelf or crate.
 * @param {OrderSource[]} sources
 * @param {(area: string) => string} areaName - e.g. "Sales floor"
 */
export function describeOrderSources(sources, areaName) {
  const groups = new Map();
  for (const source of sources) {
    const label = source.kind === "carried"
      ? "Crates you're carrying"
      : `${areaName(source.area)} ${source.kind === "shelf" ? "shelves" : "crates"}`;
    groups.set(label, (groups.get(label) ?? 0) + source.quantity);
  }
  return [...groups].map(([label, quantity]) => `${label}: ${quantity}`).join(" · ");
}
