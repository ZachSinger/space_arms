/**
 * Balancing numbers live in data/tuning/<area>.json, one entry per number:
 *   "maxCustomersInStore": { "value": 6, "min": 1, "max": 20, "integer": true,
 *                            "description": "How many shoppers can be inside at once." }
 * A value can also be a list of numbers (for example a [shortest, longest] range); each one
 * must fall within min and max. Loading checks every entry, so a typo or an out-of-range
 * number stops the game at startup with a clear message instead of quietly misbehaving.
 */

/**
 * @typedef {{ value: number | number[], min: number, max: number, integer?: boolean,
 *   description: string }} TuningEntry
 */

/**
 * Checks one area's tuning file and returns just the values, frozen.
 * @template {Record<string, TuningEntry>} T
 * @param {string} area - the file's name, used in error messages
 * @param {T} entries
 * @returns {Readonly<{ [K in keyof T]: T[K]["value"] }>}
 */
export function loadTuning(area, entries) {
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new TypeError(`Tuning "${area}" must be an object of named entries.`);
  }
  const values = {};
  for (const [name, entry] of Object.entries(entries)) {
    const where = `Tuning ${area}.${name}`;
    if (!entry || typeof entry !== "object") throw new TypeError(`${where} must be an entry object.`);
    if (typeof entry.description !== "string" || !entry.description.trim()) {
      throw new TypeError(`${where} needs a description.`);
    }
    if (!Number.isFinite(entry.min) || !Number.isFinite(entry.max) || entry.min > entry.max) {
      throw new RangeError(`${where} needs a min and max, with min no larger than max.`);
    }
    const numbers = Array.isArray(entry.value) ? entry.value : [entry.value];
    if (numbers.length === 0) throw new RangeError(`${where} has an empty list.`);
    for (const number of numbers) {
      if (!Number.isFinite(number)) throw new TypeError(`${where} must be a number, not ${JSON.stringify(number)}.`);
      if (entry.integer && !Number.isInteger(number)) throw new RangeError(`${where} must be a whole number.`);
      if (number < entry.min || number > entry.max) {
        throw new RangeError(`${where} is ${number}, outside its allowed range ${entry.min} to ${entry.max}.`);
      }
    }
    values[name] = Array.isArray(entry.value) ? Object.freeze([...entry.value]) : entry.value;
  }
  return /** @type {any} */ (Object.freeze(values));
}
