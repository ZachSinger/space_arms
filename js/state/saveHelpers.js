// Small checks shared by the save upgrade steps and the whole-save check.

export function requireSave(condition, message) {
  if (!condition) throw new Error(`Invalid saved game: ${message}`);
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function integer(value, minimum = Number.MIN_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= minimum;
}
