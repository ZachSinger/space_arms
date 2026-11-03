import { getFixtureType } from "./FixtureLayout.js";

// The single source of truth for every fixture placed in the shop. Anything that needs
// "the shelves", "the register", or "fixture X" asks this registry instead of keeping
// its own reference. Each fixture model carries `id`, `type`, `gx`/`gy`, and, once the
// layout is applied, its `standPoint`.
export class FixtureRegistry {
  constructor() {
    this.fixtures = [];
  }

  all() {
    return [...this.fixtures];
  }

  get(id) {
    return this.fixtures.find((fixture) => fixture.id === id);
  }

  ofKind(kind) {
    return this.fixtures.filter((fixture) => getFixtureType(fixture.type).kind === kind);
  }

  shelves() {
    return this.ofKind("shelf");
  }

  // Fixtures that hold stock: shelves and storage lockers.
  stockHolders() {
    return this.fixtures.filter((fixture) => {
      const { kind } = getFixtureType(fixture.type);
      return kind === "shelf" || kind === "storage";
    });
  }

  register() {
    return this.ofKind("register")[0];
  }

  add(fixture) {
    if (!getFixtureType(fixture.type)) throw new Error(`Unknown fixture type: ${fixture.type}`);
    if (this.get(fixture.id)) throw new Error(`Duplicate fixture id: ${fixture.id}`);
    this.fixtures.push(fixture);
    return fixture;
  }

  remove(id) {
    const fixture = this.get(id);
    this.fixtures = this.fixtures.filter((candidate) => candidate !== fixture);
    return fixture;
  }

  clear() {
    const removed = this.fixtures;
    this.fixtures = [];
    return removed;
  }

  // A fresh instance id for a newly bought or unpacked fixture.
  nextId(typeId) {
    let number = 1;
    while (this.get(`${typeId}_${number}`)) number += 1;
    return `${typeId}_${number}`;
  }

  layout() {
    return this.fixtures.map(({ id, type, gx, gy }) => ({ id, type, gx, gy }));
  }

  // "SHELF", or "LOCKER 2" when several fixtures share a type.
  displayName(fixture) {
    const sameType = this.fixtures.filter((candidate) => candidate.type === fixture.type);
    const name = getFixtureType(fixture.type).name;
    return sameType.length > 1 ? `${name} ${sameType.indexOf(fixture) + 1}` : name;
  }
}
