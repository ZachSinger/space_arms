// =============================================================================
// FILE: ArcadeRunner.js
// =============================================================================
// Runs one arcade game (see ArcadeGame.js) on a canvas: drives its frame loop, hands it the
// players' buttons, routes its sound through a volume control, and keeps its high score table.
// The same runner powers the cabinet in the shop and the `npm run arcade` test page.
// =============================================================================

import { ARCADE_SCREEN, findArcadeGameProblems, findArcadeInstanceProblems } from "./ArcadeGame.js";

const MAX_STEP_SECONDS = 1 / 30;
const TABLE_SIZE = 5;

/**
 * Whether a score earns a row in the table; for race times a lower number is better, and an
 * empty score (0) never counts.
 * @param {import("./ArcadeGame.js").ArcadeHighScore[]} table
 * @param {number} score
 * @param {"points" | "time"} scoreType
 */
export function qualifiesForTable(table, score, scoreType) {
  if (!Number.isFinite(score) || score <= 0) return false;
  if (table.length < TABLE_SIZE) return true;
  const worst = table[table.length - 1].score;
  return scoreType === "time" ? score < worst : score > worst;
}

/**
 * @param {import("./ArcadeGame.js").ArcadeHighScore[]} table
 * @param {import("./ArcadeGame.js").ArcadeHighScore} entry
 * @param {"points" | "time"} scoreType
 */
export function addToTable(table, entry, scoreType) {
  const initials = String(entry.initials ?? "").toUpperCase().replace(/[^A-Z ]/g, " ").padEnd(3, " ").slice(0, 3);
  const rows = [...table, { initials, score: entry.score }];
  rows.sort((a, b) => (scoreType === "time" ? a.score - b.score : b.score - a.score));
  return rows.slice(0, TABLE_SIZE);
}

export class ArcadeRunner {
  /**
   * @param {object} options
   * @param {import("./ArcadeGame.js").ArcadeGame} options.game
   * @param {HTMLCanvasElement} options.canvas
   * @param {(player: 1 | 2) => import("./ArcadeGame.js").ArcadePad} options.readPad
   * @param {AudioContext} options.audioContext
   * @param {import("./ArcadeGame.js").ArcadeHighScore[]} [options.highScores]
   * @param {(table: import("./ArcadeGame.js").ArcadeHighScore[]) => void} [options.onHighScores]
   * @param {(result: import("./ArcadeGame.js").ArcadeResult) => void} [options.onGameOver]
   * @param {() => void} [options.onExit]
   */
  constructor({ game, canvas, readPad, audioContext, highScores = [], onHighScores, onGameOver, onExit }) {
    const problems = findArcadeGameProblems(game);
    if (problems.length) throw new Error(`Arcade game is not usable: ${problems.join(" ")}`);
    this.game = game;
    this.table = highScores.slice(0, TABLE_SIZE);
    canvas.width = ARCADE_SCREEN.width;
    canvas.height = ARCADE_SCREEN.height;
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    context.imageSmoothingEnabled = false;
    this.volume = audioContext.createGain();
    this.volume.connect(audioContext.destination);
    this.frame = 0;
    this.lastTime = 0;
    this.running = false;

    /** @type {import("./ArcadeGame.js").ArcadeHost} */
    const host = {
      canvas,
      context,
      readPad,
      audioContext,
      audioOutput: this.volume,
      getHighScores: () => this.table.map((row) => ({ ...row })),
      isHighScore: (score) => qualifiesForTable(this.table, score, game.scoreType),
      saveHighScore: (entry) => {
        if (!qualifiesForTable(this.table, entry.score, game.scoreType)) return;
        this.table = addToTable(this.table, entry, game.scoreType);
        onHighScores?.(this.table.map((row) => ({ ...row })));
      },
      gameOver: (result) => onGameOver?.(result),
      exit: () => onExit?.(),
      random: Math.random,
    };
    this.instance = game.create(host);
    const instanceProblems = findArcadeInstanceProblems(this.instance);
    if (instanceProblems.length) throw new Error(`Arcade game is not usable: ${instanceProblems.join(" ")}`);
  }

  /** @param {"attract" | "play"} mode */
  start(mode) {
    this.instance.start({ mode });
    this.resume();
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.instance.pause();
  }

  resume() {
    if (this.running) return;
    this.running = true;
    this.instance.resume();
    this.lastTime = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const seconds = Math.min(MAX_STEP_SECONDS, Math.max(0, (now - this.lastTime) / 1000));
      this.lastTime = now;
      this.instance.update(seconds);
      this.instance.render();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** @param {number} level 0 to 1 */
  setVolume(level) {
    this.volume.gain.value = Math.max(0, Math.min(1, level));
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.instance.destroy();
    this.volume.disconnect();
  }
}
