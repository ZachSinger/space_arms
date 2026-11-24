/**
 * Seeded random numbers. Gameplay rolls go through `gameRandom` so a shift can be replayed
 * exactly from its seed. Purely cosmetic jitter may keep using Math.random.
 */

/**
 * A random source: call it for a number in [0, 1), like Math.random.
 * @typedef {(() => number) & {
 *   seed: number,
 *   reseed: (seed: number) => void,
 *   int: (min: number, max: number) => number,
 *   float: (min: number, max: number) => number,
 *   pick: <T>(items: T[]) => T | undefined,
 *   override: (source: () => number) => () => void,
 * }} Random
 */

/**
 * @param {number} [seed]
 * @returns {Random}
 */
export function createRandom(seed = randomSeed()) {
  let state = 0;
  let override = null;
  const random = /** @type {Random} */ (() => {
    if (override) return override();
    // mulberry32: small, fast, and good enough for games.
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
  random.reseed = (next) => {
    random.seed = next >>> 0;
    state = random.seed;
  };
  // Tests use this to fix the dice; it returns a function that undoes the override.
  random.override = (source) => {
    override = source;
    return () => { override = null; };
  };
  random.int = (min, max) => min + Math.floor(random() * (max - min + 1));
  random.float = (min, max) => min + random() * (max - min);
  random.pick = (items) => items.length ? items[Math.floor(random() * items.length)] : undefined;
  random.reseed(seed);
  return random;
}

export function randomSeed() {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/** The game's shared random source. The game scene reseeds it at the start of each session. */
export const gameRandom = createRandom();
