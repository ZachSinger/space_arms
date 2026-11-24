import { TrashField } from "./TrashField.js";
import { DIRT_KINDS, ensureCleaningTextures } from "./CleaningArt.js";
import { gameRandom } from "../../core/Random.js";

export function randomDirtKind(random = gameRandom) {
  return DIRT_KINDS[Math.min(DIRT_KINDS.length - 1, Math.floor(random() * DIRT_KINDS.length))];
}

// Shares trash's floor relocation and highlighting, but keeps each mark's cleaning progress.
export class DirtField extends TrashField {
  constructor(scene, isOpenFloor) {
    super(scene, isOpenFloor);
    ensureCleaningTextures(scene);
  }

  makeSprite(kind, x, y) {
    return this.scene.add.image(x, y, `dirt-${kind}`).setScale(1.2).setDepth(0.9);
  }

  add(kind, x, y, progress = 0) {
    const piece = super.add(kind, x, y);
    piece.progress = progress;
    return piece;
  }

  serialize() {
    return this.pieces.map(({ kind, x, y, progress }) => ({ kind, x, y, progress }));
  }

  load(list) {
    this.clear();
    for (const { kind, x, y, progress } of list) this.add(kind, x, y, progress);
    this.moveOffBlockedSpots();
  }
}
