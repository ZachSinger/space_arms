// Upgrade step: older saves held shelf contents laid out by item size. Hands-on shelves now
// hold one stack per space, capped by the current rule; whatever doesn't fit goes to Go-Backs.
// A shelf is only converted if every stack fit under the old rule, so anything malformed is
// left as it was for the whole-save check to reject.
import { getFixtureType, getShelfDisplayGrid, getShelfItemFootprint, getShelfSlotCapacity } from "../../logic/FixtureLayout.js";
import { integer, isRecord } from "../saveHelpers.js";

// Older saves used "slot depth 12 ÷ stackSize". Stacks valid under that rule still load.
export const LEGACY_SHELF_STACK_DEPTH = 12;

/**
 * Whether a stack fits on a shelf under the old (pre hands-on) rule.
 * @param {object} spec - fixture type
 * @param {object} item
 * @param {object} placement
 */
export function fitsLegacyShelfRule(spec, item, placement) {
  const displayGrid = getShelfDisplayGrid(spec);
  const { w, h } = getShelfItemFootprint(item, placement.rotated, false);
  return placement.w === w && placement.h === h &&
    placement.gx + w <= displayGrid.w && placement.gy + h <= displayGrid.h &&
    placement.quantity <= Math.max(getShelfSlotCapacity(spec.stackDepth, item),
      Math.floor(LEGACY_SHELF_STACK_DEPTH / item.stackSize));
}

/**
 * @param {object} data
 * @param {{ getAllItems: () => object[] }} database
 */
export function upgradeShelfStocking(data, database) {
  if (!Array.isArray(data.fixtures)) return data;
  const itemById = new Map(database.getAllItems().map((item) => [item.id, item]));
  const overflow = new Map();
  const fixtures = data.fixtures.map((entry) => {
    const spec = getFixtureType(entry?.type);
    if (spec?.kind !== "shelf" || spec.artLayout !== "budget" || entry.stockingVersion !== undefined) return entry;
    if (!Array.isArray(entry.placements) || entry.placements.length === 0) return entry;
    const occupied = new Set();
    const valid = entry.placements.every((placement) => {
      const item = itemById.get(placement?.itemId);
      if (!(item && typeof placement.rotated === "boolean" && integer(placement.gx, 0) &&
        integer(placement.gy, 0) && integer(placement.quantity, 0) && fitsLegacyShelfRule(spec, item, placement))) {
        return false;
      }
      for (let dy = 0; dy < placement.h; dy += 1) {
        for (let dx = 0; dx < placement.w; dx += 1) {
          const key = `${placement.gx + dx},${placement.gy + dy}`;
          if (occupied.has(key)) return false;
          occupied.add(key);
        }
      }
      return true;
    });
    if (!valid) return entry;
    return {
      ...entry,
      placements: entry.placements.map((placement) => {
        const capacity = getShelfSlotCapacity(spec.stackDepth, itemById.get(placement.itemId), true);
        const extra = Math.max(0, placement.quantity - capacity);
        if (extra) overflow.set(placement.itemId, (overflow.get(placement.itemId) ?? 0) + extra);
        return { ...placement, quantity: placement.quantity - extra, w: 1, h: 1, rotated: false };
      }),
      stockingVersion: 1,
    };
  });
  const player = data.playerState;
  if (!overflow.size || !isRecord(player) || !(player.goBacks === undefined || Array.isArray(player.goBacks))) {
    return { ...data, fixtures };
  }
  const goBacks = new Map((player.goBacks ?? []).map((entry) => [entry?.itemId, entry?.quantity]));
  for (const [itemId, quantity] of overflow) goBacks.set(itemId, (goBacks.get(itemId) ?? 0) + quantity);
  return {
    ...data,
    fixtures,
    playerState: { ...player, goBacks: [...goBacks].map(([itemId, quantity]) => ({ itemId, quantity })) },
  };
}
