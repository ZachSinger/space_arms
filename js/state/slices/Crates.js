import { Slice } from "../Slice.js";

export class Crates extends Slice {
  constructor(nextId = 1) {
    super();
    this.nextId = nextId;
  }

  allocateId() {
    const id = `crate-${this.nextId}`;
    this.nextId += 1;
    this.changed();
    return id;
  }

  adopt(next) {
    this.nextId = next.nextId;
  }

  toSave() {
    return { nextCrateId: this.nextId };
  }

  static fromSave(data) {
    return new Crates(data.nextCrateId);
  }
}
