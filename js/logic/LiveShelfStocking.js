// Transfers one real item, selecting the highest compatible crate in the carried stack.
import { transferItems } from "./InventoryTransfer.js";

export function moveShelfCrateItem(shelf, crates, gx, gy, pull, eventBus = null) {
  if (!shelf.handsOn) throw new Error("This shelf does not support hands-on stocking.");
  let placement = shelf.placements.find((entry) => entry.gx === gx && entry.gy === gy);
  const candidates = [...crates].reverse().filter((crate) => crate.kind === "item");
  if (pull && (!placement || placement.quantity === 0)) {
    return { moved: 0, message: "There are no items here to take." };
  }
  if (!pull && placement?.quantity > 0 &&
    placement.quantity >= shelf.getPlacementCapacity(placement)) {
    return { moved: 0, message: "This shelf space is full." };
  }
  const crate = candidates.find((candidate) => pull
    ? candidate.getRemainingUnitsFor(placement.itemId) > 0
    : candidate.quantity > 0 && (!placement || placement.quantity === 0 ||
      candidate.itemId === placement.itemId));
  if (!crate) {
    return { moved: 0, message: pull
      ? "Carry an empty crate, or a crate of this item with room for more."
      : "Carry a crate of this item, or choose an empty shelf space." };
  }
  if (!pull && placement?.quantity === 0 && placement.itemId !== crate.itemId) {
    shelf.removeEmptyPlacement(placement);
    placement = null;
  }
  const created = !placement;
  if (created) placement = shelf.placeItem(crate.itemId, gx, gy, false, 0);
  if (!placement) return { moved: 0, message: "This item cannot fit in that shelf space." };
  const itemId = placement.itemId;
  const result = transferItems(pull ? shelf : crate, pull ? crate : shelf, itemId, 1, {
    ...(pull ? { sourceEntry: placement } : { destinationEntry: placement }),
    eventBus,
    sourceName: pull ? "shelf" : "crate",
    destinationName: pull ? "crate" : "shelf",
  });
  if (result.moved === 0 && created) shelf.removeEmptyPlacement(placement);
  if (crate.quantity === 0) {
    crate.itemId = null;
    crate.sprite?.clearTint?.();
  }
  return { ...result, itemId, message: result.moved ? "" : "No room to move another item." };
}
