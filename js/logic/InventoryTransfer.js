import { GAME_EVENTS } from "../core/Events.js";

const isValidUnits = (units) => units === Infinity || (Number.isInteger(units) && units >= 0);

/**
 * Transfers stock only when the source and destination permit it and have room.
 * Containers implement canTake(itemId, context, entry) and canPut(itemId, context, entry).
 * @param {object} from
 * @param {object} to
 * @param {string} itemId
 * @param {number} quantity
 * @param {{ sourceEntry?: object | null, destinationEntry?: object | null, eventBus?: object | null,
 *   sourceName?: string, destinationName?: string, context?: object | null }} [options]
 */
export function transferItems(from, to, itemId, quantity, {
  sourceEntry = null,
  destinationEntry = null,
  eventBus = null,
  sourceName = "container",
  destinationName = "container",
  context = null,
} = {}) {
  if (!from || !to || from === to) throw new TypeError("Transfer requires two different containers.");
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError("Transfer quantity must be a positive integer.");
  }
  for (const [container, method] of [
    [from, "getAvailableUnitsFor"],
    [from, "canTake"],
    [from, "remove"],
    [from, "add"],
    [to, "getRemainingUnitsFor"],
    [to, "canPut"],
    [to, "add"],
  ]) {
    if (typeof container[method] !== "function") {
      throw new TypeError(`Transfer container is missing ${method}().`);
    }
  }

  if (!from.canTake(itemId, context, sourceEntry)) {
    return { moved: 0, remaining: quantity, reason: "source-locked" };
  }
  if (!to.canPut(itemId, context, destinationEntry)) {
    return { moved: 0, remaining: quantity, reason: "destination-locked" };
  }

  const available = from.getAvailableUnitsFor(itemId, sourceEntry);
  const capacity = to.getRemainingUnitsFor(itemId, destinationEntry);
  if (!isValidUnits(available)) {
    throw new Error("Source container returned an invalid available quantity.");
  }
  if (!isValidUnits(capacity)) {
    throw new Error("Destination container returned an invalid capacity.");
  }

  const amount = Math.min(quantity, available, capacity);
  if (amount <= 0) {
    return {
      moved: 0,
      remaining: quantity,
      reason: available <= 0 ? "source-empty" : "destination-full",
    };
  }

  const removed = from.remove(itemId, amount, sourceEntry);
  if (removed !== amount) {
    if (removed > 0) restoreSource(from, itemId, removed, sourceEntry);
    return { moved: 0, remaining: quantity, reason: "source-changed" };
  }

  const accepted = to.add(itemId, removed, destinationEntry);
  if (!Number.isInteger(accepted) || accepted < 0 || accepted > removed) {
    restoreSource(from, itemId, removed, sourceEntry);
    throw new Error("Destination container returned an invalid transfer quantity.");
  }
  if (accepted < removed) restoreSource(from, itemId, removed - accepted, sourceEntry);

  if (accepted > 0) {
    eventBus?.emit(GAME_EVENTS.INVENTORY_TRANSFERRED, {
      itemId,
      quantity: accepted,
      source: sourceName,
      destination: destinationName,
    });
  }
  return {
    moved: accepted,
    remaining: quantity - accepted,
    reason: accepted === quantity ? null : accepted >= available ? "source-empty" : "destination-full",
  };
}

function restoreSource(source, itemId, quantity, sourceEntry) {
  const restored = source.add(itemId, quantity, sourceEntry);
  if (restored !== quantity) throw new Error("Could not restore stock after a failed transfer.");
}
