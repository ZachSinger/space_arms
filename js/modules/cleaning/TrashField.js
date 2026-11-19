// ==========================================
// FILE: TrashField.js
// ==========================================
// Loose trash on the shop floor (documentation/modules/Cleaning.md): the pieces, their
// pictures, and moving them off spots a fixture now covers.
import { TRASH_KINDS, CLEANING_TUNING } from "./Litter.js";
import { gameRandom } from "../../core/Random.js";

export const TRASH_DEPTH = CLEANING_TUNING.trashDepth; // just above the floor (0): under walls, crates, fixtures, and people
const TRASH_SCALE = CLEANING_TUNING.trashScale;
const TRASH_HIGHLIGHT_DEPTH = CLEANING_TUNING.trashHighlightDepth; // over shelves and people, under speech bubbles (9000)

// Small pictures drawn once: a dented can on its side, crumpled paper, a flattened box.
function ensureTrashTextures(scene) {
  if (scene.textures.exists("trash-can")) return;
  const draw = (key, width, height, paint) => {
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    paint(g);
    g.generateTexture(key, width, height);
    g.destroy();
  };
  draw("trash-can", 14, 9, (g) => {
    g.fillStyle(0x000000, 0.25).fillEllipse(7, 7.5, 14, 3);
    g.fillStyle(0xb91c1c, 1).fillRect(2, 1, 10, 6);
    g.fillStyle(0xef4444, 1).fillRect(2, 2, 10, 1);
    g.fillStyle(0xcbd5e1, 1).fillRect(0, 1, 2, 6).fillRect(12, 1, 2, 6);
    g.fillStyle(0xf8fafc, 1).fillRect(5, 3, 3, 2);
  });
  draw("trash-paper", 12, 11, (g) => {
    g.fillStyle(0x000000, 0.25).fillEllipse(6, 9.5, 12, 3);
    g.fillStyle(0xe5e7eb, 1).fillPoints([
      { x: 1, y: 4 }, { x: 4, y: 1 }, { x: 8, y: 0 }, { x: 11, y: 3 },
      { x: 10, y: 8 }, { x: 6, y: 9 }, { x: 2, y: 8 },
    ], true);
    g.lineStyle(1, 0x94a3b8, 1).beginPath()
      .moveTo(3, 4).lineTo(6, 6).lineTo(9, 3).moveTo(5, 2).lineTo(6, 6).strokePath();
  });
  draw("trash-box", 13, 10, (g) => {
    g.fillStyle(0x000000, 0.25).fillEllipse(6.5, 8.5, 13, 3);
    g.fillStyle(0xa16207, 1).fillRect(1, 2, 11, 6);
    g.fillStyle(0xca8a04, 1).fillRect(1, 1, 11, 2);
    g.fillStyle(0xfde68a, 1).fillRect(6, 1, 1, 7);
  });
}

export class TrashField {
  /**
   * @param {Phaser.Scene} scene
   * @param {(x: number, y: number) => boolean} isOpenFloor - px; where trash may lie
   */
  constructor(scene, isOpenFloor) {
    this.scene = scene;
    this.isOpenFloor = isOpenFloor;
    this.pieces = [];
    ensureTrashTextures(scene);
  }

  get count() {
    return this.pieces.length;
  }

  makeSprite(kind, x, y) {
    return this.scene.add.image(x, y, `trash-${kind}`).setScale(TRASH_SCALE).setDepth(TRASH_DEPTH);
  }

  /**
   * @param {string} kind - one of TRASH_KINDS
   * @param {number} x - px
   * @param {number} y - px
   */
  add(kind, x, y) {
    const piece = { kind, x, y, sprite: this.makeSprite(kind, x, y) };
    this.pieces.push(piece);
    return piece;
  }

  // Off the floor list. The sprite stays so it can be carried.
  take(piece) {
    const index = this.pieces.indexOf(piece);
    if (index < 0) return false;
    this.pieces.splice(index, 1);
    return true;
  }

  // Puts a carried piece back on the floor.
  place(piece, x, y) {
    piece.x = x;
    piece.y = y;
    piece.sprite.setPosition(x, y).setDepth(TRASH_DEPTH);
    this.pieces.push(piece);
  }

  clear() {
    for (const piece of this.pieces) piece.sprite.destroy();
    this.pieces = [];
  }

  /**
   * Bright pulsing rings over every piece on the floor, drawn above shelves and people so
   * trash hidden behind them still shows. Call every frame; false hides them.
   * @param {boolean} show
   * @param {number} time - ms, for the pulse
   */
  renderHighlight(show, time = 0) {
    if (!show) {
      this.highlight?.setVisible(false);
      return;
    }
    this.highlight ??= this.scene.add.graphics().setDepth(TRASH_HIGHLIGHT_DEPTH);
    const pulse = 0.5 + 0.5 * Math.sin(time / 180);
    const g = this.highlight.clear().setVisible(true);
    for (const { x, y } of this.pieces) {
      g.lineStyle(4, 0x000000, 0.6).strokeCircle(x, y, 13 + pulse * 3);
      g.lineStyle(2, 0xfde047, 0.7 + 0.3 * pulse).strokeCircle(x, y, 13 + pulse * 3);
      g.fillStyle(0xfde047, 0.18 + 0.12 * pulse).fillCircle(x, y, 12);
    }
  }

  load(list) {
    this.clear();
    for (const { kind, x, y } of list) this.add(kind, x, y);
    this.moveOffBlockedSpots();
  }

  serialize() {
    return this.pieces.map(({ kind, x, y }) => ({ kind, x, y }));
  }

  /**
   * The closest piece within `reach` px of `point`, or null.
   * @param {{ x: number, y: number }} point
   * @param {number} reach
   */
  findNear(point, reach) {
    let best = null;
    let bestDistance = reach;
    for (const piece of this.pieces) {
      const distance = Math.hypot(piece.x - point.x, piece.y - point.y);
      if (distance <= bestDistance) {
        best = piece;
        bestDistance = distance;
      }
    }
    return best;
  }

  // Trash a fixture now covers slides to the nearest open floor; with none nearby it's gone.
  moveOffBlockedSpots(
    step = CLEANING_TUNING.blockedSpotSearchStepPx,
    maxRings = CLEANING_TUNING.blockedSpotSearchMaxRings,
  ) {
    for (const piece of [...this.pieces]) {
      if (this.isOpenFloor(piece.x, piece.y)) continue;
      const spot = this.nearestOpenSpot(piece, step, maxRings);
      if (spot) {
        piece.x = spot.x;
        piece.y = spot.y;
        piece.sprite.setPosition(spot.x, spot.y);
      } else {
        this.take(piece);
        piece.sprite.destroy();
      }
    }
  }

  nearestOpenSpot({ x, y }, step, maxRings) {
    for (let ring = 1; ring <= maxRings; ring += 1) {
      let best = null;
      let bestDistance = Infinity;
      for (let dx = -ring; dx <= ring; dx += 1) {
        for (let dy = -ring; dy <= ring; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const spot = { x: x + dx * step, y: y + dy * step };
          const distance = Math.hypot(dx, dy);
          if (distance < bestDistance && this.isOpenFloor(spot.x, spot.y)) {
            best = spot;
            bestDistance = distance;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }
}

export function randomTrashKind(random = gameRandom) {
  return TRASH_KINDS[Math.floor(random() * TRASH_KINDS.length)];
}
