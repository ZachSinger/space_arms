import { Slice } from "../Slice.js";

export class Trash extends Slice {
  constructor(pieces = [], dirt = []) {
    super();
    this.pieces = pieces.map(({ kind, x, y }) => ({ kind, x, y }));
    this.dirt = dirt.map((mark) => ({ ...mark }));
  }

  setPieces(pieces) {
    this.pieces = pieces.map(({ kind, x, y }) => ({ kind, x, y }));
    this.changed();
  }

  adopt(next) {
    this.pieces = next.pieces.map(({ kind, x, y }) => ({ kind, x, y }));
    this.dirt = next.dirt.map((mark) => ({ ...mark }));
  }

  setDirt(dirt) {
    this.dirt = dirt.map((mark) => ({ ...mark }));
    this.changed();
  }

  toSave() {
    return {
      trash: this.pieces.map(({ kind, x, y }) => ({ kind, x, y })),
      ...(this.dirt.length ? { dirt: this.dirt.map((mark) => ({ ...mark })) } : {}),
    };
  }

  static fromSave(data) {
    return new Trash(data.trash ?? [], data.dirt ?? []);
  }
}
