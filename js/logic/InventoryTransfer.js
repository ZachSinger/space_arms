import { GAME_EVENTS } from "../core/Events.js";

const isValidUnits = (units) => units === Infinity || (Number.isInteger(units) && units >= 0);

function validLocation(location) {
  return Boolean(location && typeof location.kind === "string" && location.kind.length > 0);
}

function emitTransfer(eventBus, event) {
  eventBus?.emit(GAME_EVENTS.INVENTORY_TRANSFERRED, event);
}

/**
 * Introduces stock from an external source into a container.
 * @param {object} destination
 * @param {string} itemId
 * @param {number} quantity
 * @param {{ sourceId: string, sourceLocation: object, destinationEntry?: object | null,
 *   eventBus?: object | null, sourceName?: string, destinationName?: string, context?: object | null }} options
 */
export function sourceItems(destination, itemId, quantity, {
  sourceId,
  sourceLocation,
  destinationEntry = null,
  eventBus = null,
  sourceName = "source",
  destinationName = "container",
  context = null,
} = {}) {
  if (!destination) throw new TypeError("Source requires a destination container.");
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError("Source quantity must be a positive integer.");
  }
  for (const method of ["getRemainingUnitsFor", "getContainerId", "getLocation", "canPut", "add"]) {
    if (typeof destination[method] !== "function") {
      throw new TypeError(`Destination container is missing ${method}().`);
    }
  }
  const destinationId = destination.getContainerId(destinationEntry);
  const destinationLocation = destination.getLocation(destinationEntry);
  if (typeof sourceId !== "string" || sourceId.length === 0 ||
    typeof destinationId !== "string" || destinationId.length === 0 || sourceId === destinationId) {
    throw new TypeError("Source and destination require different, stable IDs.");
  }
  if (!validLocation(sourceLocation) || !validLocation(destinationLocation)) {
    throw new TypeError("Source and destination must report a valid location.");
  }
  if (!destination.canPut(itemId, context, destinationEntry)) {
    return { moved: 0, remaining: quantity, reason: "destination-locked" };
  }
  const capacity = destination.getRemainingUnitsFor(itemId, destinationEntry);
  if (!isValidUnits(capacity)) throw new Error("Destination container returned an invalid capacity.");
  const amount = Math.min(quantity, capacity);
  if (amount <= 0) return { moved: 0, remaining: quantity, reason: "destination-full" };

  const accepted = destination.add(itemId, amount, destinationEntry);
  if (!Number.isInteger(accepted) || accepted < 0 || accepted > amount) {
    throw new Error("Destination container returned an invalid source quantity.");
  }
  if (accepted > 0) {
    emitTransfer(eventBus, {
      itemId,
      quantity: accepted,
      source: sourceName,
      destination: destinationName,
      sourceId,
      destinationId,
      sourceLocation,
      destinationLocation,
    });
  }
  return {
    moved: accepted,
    remaining: quantity - accepted,
    reason: accepted === quantity ? null : "destination-full",
  };
}

/**
 * Removes stock through an external sink.
 * @param {object} source
 * @param {string} itemId
 * @param {number} quantity
 * @param {{ sinkId: string, sinkLocation: object, sourceEntry?: object | null,
 *   eventBus?: object | null, sourceName?: string, sinkName?: string, context?: object | null }} options
 */
export function sinkItems(source, itemId, quantity, {
  sinkId,
  sinkLocation,
  sourceEntry = null,
  eventBus = null,
  sourceName = "container",
  sinkName = "sink",
  context = null,
} = {}) {
  if (!source) throw new TypeError("Sink requires a source container.");
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError("Sink quantity must be a positive integer.");
  }
  for (const method of ["getAvailableUnitsFor", "getContainerId", "getLocation", "canTake", "remove"]) {
    if (typeof source[method] !== "function") {
      throw new TypeError(`Source container is missing ${method}().`);
    }
  }
  const sourceId = source.getContainerId(sourceEntry);
  const sourceLocation = source.getLocation(sourceEntry);
  if (typeof sourceId !== "string" || sourceId.length === 0 ||
    typeof sinkId !== "string" || sinkId.length === 0 || sourceId === sinkId) {
    throw new TypeError("Source and sink require different, stable IDs.");
  }
  if (!validLocation(sourceLocation) || !validLocation(sinkLocation)) {
    throw new TypeError("Source and sink must report a valid location.");
  }
  if (!source.canTake(itemId, context, sourceEntry)) {
    return { moved: 0, remaining: quantity, reason: "source-locked" };
  }
  const available = source.getAvailableUnitsFor(itemId, sourceEntry);
  if (!isValidUnits(available)) throw new Error("Source container returned an invalid available quantity.");
  const amount = Math.min(quantity, available);
  if (amount <= 0) return { moved: 0, remaining: quantity, reason: "source-empty" };

  const removed = source.remove(itemId, amount, sourceEntry);
  if (!Number.isInteger(removed) || removed < 0 || removed > amount) {
    throw new Error("Source container returned an invalid sink quantity.");
  }
  if (removed > 0) {
    emitTransfer(eventBus, {
      itemId,
      quantity: removed,
      source: sourceName,
      destination: sinkName,
      sourceId,
      destinationId: sinkId,
      sourceLocation,
      destinationLocation: sinkLocation,
    });
  }
  return {
    moved: removed,
    remaining: quantity - removed,
    reason: removed === quantity ? null : "source-empty",
  };
}

/**
 * Transfers stock only when the source and destination permit it and have room.
 * Containers have unique IDs and locations, and implement getContainerId(entry), getLocation(entry),
 * canTake(itemId, context, entry), and canPut(itemId, context, entry).
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
    [from, "getContainerId"],
    [from, "getLocation"],
    [from, "canTake"],
    [from, "remove"],
    [from, "add"],
    [to, "getRemainingUnitsFor"],
    [to, "getContainerId"],
    [to, "getLocation"],
    [to, "canPut"],
    [to, "add"],
  ]) {
    if (typeof container[method] !== "function") {
      throw new TypeError(`Transfer container is missing ${method}().`);
    }
  }

  const sourceId = from.getContainerId(sourceEntry);
  const destinationId = to.getContainerId(destinationEntry);
  if (typeof sourceId !== "string" || sourceId.length === 0 ||
    typeof destinationId !== "string" || destinationId.length === 0 || sourceId === destinationId) {
    throw new TypeError("Transfer containers require different, stable IDs.");
  }

  const sourceLocation = from.getLocation(sourceEntry);
  const destinationLocation = to.getLocation(destinationEntry);
  if (!sourceLocation || typeof sourceLocation.kind !== "string" || sourceLocation.kind.length === 0 ||
    !destinationLocation || typeof destinationLocation.kind !== "string" ||
    destinationLocation.kind.length === 0) {
    throw new TypeError("Transfer containers must report a valid location.");
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
    emitTransfer(eventBus, {
      itemId,
      quantity: accepted,
      source: sourceName,
      destination: destinationName,
      sourceId,
      destinationId,
      sourceLocation,
      destinationLocation,
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
