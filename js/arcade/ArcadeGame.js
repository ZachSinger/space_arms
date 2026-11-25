// =============================================================================
// FILE: ArcadeGame.js
// =============================================================================
// The contract every arcade cabinet game follows, so the shop can run any of them the same way.
// Each game is one file in js/arcade/games/ whose default export is an ArcadeGame. The shop (the
// "host") owns the canvas, the game loop, controls, sound output, pausing, and saved high scores;
// the game only draws, plays sounds, and reports scores through the host it is given.
//
// See also: documentation/ArcadePrompts.md (the prompts used to have these games written).
// =============================================================================

export const ARCADE_SCREEN = Object.freeze({ width: 320, height: 240 });

export const ARCADE_BUTTONS = Object.freeze(["up", "down", "left", "right", "a", "b", "start"]);

/**
 * @typedef {object} ArcadePad
 * Which buttons one player is holding right now.
 * @property {boolean} up
 * @property {boolean} down
 * @property {boolean} left
 * @property {boolean} right
 * @property {boolean} a
 * @property {boolean} b
 * @property {boolean} start
 */

/**
 * @typedef {object} ArcadeHighScore
 * @property {string} initials - exactly 3 characters, A-Z or space
 * @property {number} score - points, or milliseconds when the game's scoreType is "time"
 */

/**
 * @typedef {object} ArcadeResult
 * @property {"1p" | "2p"} mode
 * @property {0 | 1 | 2} winner - 0 for a draw, or when the computer won a 1p match
 * @property {[number, number]} scores - player 1, player 2 (the computer's score in 1p)
 */

/**
 * @typedef {object} ArcadeHost
 * @property {HTMLCanvasElement} canvas - always ARCADE_SCREEN sized; the host scales it up
 * @property {CanvasRenderingContext2D} context - 2D context of that canvas, smoothing off
 * @property {(player: 1 | 2) => ArcadePad} readPad - fresh button state for a player
 * @property {AudioContext} audioContext - shared; the game must never close or suspend it
 * @property {AudioNode} audioOutput - connect every sound here, never to audioContext.destination
 * @property {() => ArcadeHighScore[]} getHighScores - saved table, best first, at most 5 rows
 * @property {(score: number) => boolean} isHighScore - would this score enter the table?
 * @property {(entry: ArcadeHighScore) => void} saveHighScore
 * @property {(result: ArcadeResult) => void} gameOver - call once when a match ends
 * @property {() => void} exit - the player chose to leave the cabinet
 * @property {() => number} random - use instead of Math.random (0 <= n < 1)
 */

/**
 * @typedef {object} ArcadeInstance
 * @property {(options: { mode: "attract" | "play" }) => void} start - "attract" is the idle demo
 *   shown on the cabinet's screen in the shop (computer plays itself, silent); "play" opens the
 *   game's own title screen where players pick 1 player or 2 players
 * @property {(seconds: number) => void} update - advance the game; seconds is at most 1/30
 * @property {() => void} render - draw the current frame onto host.context
 * @property {() => void} pause - freeze, and silence all sound
 * @property {() => void} resume
 * @property {() => void} destroy - stop every sound and release everything; never used again
 */

/**
 * @typedef {object} ArcadeGame
 * @property {string} id - lowercase-with-dashes, matches the file name
 * @property {string} title - shown on the cabinet
 * @property {"points" | "time"} scoreType - "time" means a lower score is better
 * @property {(host: ArcadeHost) => ArcadeInstance} create
 */

const INSTANCE_METHODS = ["start", "update", "render", "pause", "resume", "destroy"];

/**
 * Checks a game file's default export before the shop trusts it.
 * @param {unknown} game
 * @returns {string[]} problems found; empty when the game follows the contract
 */
export function findArcadeGameProblems(game) {
  if (!game || typeof game !== "object") return ["The default export must be an object."];
  const candidate = /** @type {Record<string, unknown>} */ (game);
  const problems = [];
  if (typeof candidate.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(candidate.id)) problems.push("id must be lowercase-with-dashes.");
  if (typeof candidate.title !== "string" || !candidate.title.trim()) problems.push("title must be a non-empty string.");
  if (candidate.scoreType !== "points" && candidate.scoreType !== "time") problems.push('scoreType must be "points" or "time".');
  if (typeof candidate.create !== "function") problems.push("create must be a function.");
  return problems;
}

/**
 * Checks what a game's create() returned.
 * @param {unknown} instance
 * @returns {string[]}
 */
export function findArcadeInstanceProblems(instance) {
  if (!instance || typeof instance !== "object") return ["create() must return an object."];
  const candidate = /** @type {Record<string, unknown>} */ (instance);
  return INSTANCE_METHODS.filter((name) => typeof candidate[name] !== "function").map((name) => `create() result is missing ${name}().`);
}
