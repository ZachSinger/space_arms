import { isRecord } from "../saveHelpers.js";

function isCrateId(id) {
  return typeof id === "string" && /^crate-[1-9]\d*$/.test(id);
}

/**
 * Assigns persistent IDs to crates from formats that predate stable crate identity.
 * @param {object} data
 * @returns {object}
 */
export function upgradeCrateIds(data) {
  let nextId = 1;
  const assignId = (entry) => {
    if (!isRecord(entry)) return entry;
    if (isCrateId(entry.id)) {
      nextId = Math.max(nextId, Number(entry.id.slice("crate-".length)) + 1);
      return entry;
    }
    return { ...entry, id: `crate-${nextId++}` };
  };
  const crates = Array.isArray(data.crates)
    ? data.crates.map((entry) => {
      const crate = assignId(entry);
      if (!Array.isArray(crate?.stack)) return crate;
      return { ...crate, stack: crate.stack.map(assignId) };
    })
    : data.crates;
  const carriedCrates = Array.isArray(data.carriedCrates)
    ? data.carriedCrates.map(assignId)
    : data.carriedCrates !== undefined
      ? data.carriedCrates
      : data.carriedCrate ? [assignId(data.carriedCrate)] : [];
  const carriedCrate = isRecord(data.carriedCrate)
    ? Array.isArray(carriedCrates) && carriedCrates.length
      ? { ...data.carriedCrate, id: carriedCrates.at(-1)?.id }
      : assignId(data.carriedCrate)
    : data.carriedCrate ?? null;
  const seenIds = [];
  for (const crate of Array.isArray(crates) ? crates : []) {
    seenIds.push(crate?.id, ...(crate?.stack ?? []).map((stacked) => stacked?.id));
  }
  if (Array.isArray(carriedCrates)) seenIds.push(...carriedCrates.map((crate) => crate?.id));
  const maximumId = seenIds.reduce((maximum, id) => isCrateId(id)
    ? Math.max(maximum, Number(id.slice("crate-".length)))
    : maximum, 0);
  return {
    ...data,
    crates,
    carriedCrate,
    carriedCrates,
    nextCrateId: data.nextCrateId === undefined ? Math.max(nextId, maximumId + 1) : data.nextCrateId,
  };
}
