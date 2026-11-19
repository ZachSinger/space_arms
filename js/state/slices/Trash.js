import { Slice } from "../Slice.js";

export class Trash extends Slice {
  constructor(pieces = []) {
    super();
    this.pieces = pieces.map(({ kind, x, y }) => ({ kind, x, y }));
  }

  setPieces(pieces) {
    this.pieces = pieces.map(({ kind, x, y }) => ({ kind, x, y }));
    this.changed();
  }

  adopt(next) {
    this.pieces = next.pieces.map(({ kind, x, y }) => ({ kind, x, y }));
  }

  toSave() {
    return { trash: this.pieces.map(({ kind, x, y }) => ({ kind, x, y })) };
  }

  static fromSave(data) {
    return new Trash(data.trash ?? []);
  }
}
