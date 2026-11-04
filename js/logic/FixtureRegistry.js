// ==========================================
// FILE: FixtureRegistry.js
// ==========================================
// Single source of truth for every fixture placed in the shop. Anything needing "the
// shelves", "the register", or "fixture X" asks here instead of keeping its own reference.
// Fixture models carry `id`, `type`, `gx`/`gy`, and, once the layout is applied, `standPoint`.
import { getFixtureType } from "./FixtureLayout.js";

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

  // The first (and normally only) register.
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

  /**
   * A fresh instance id for a newly bought or unpacked fixture.
   * @param {string} typeId
   * @returns {string} e.g. "shelf_2"
   */
  nextId(typeId) {
    let number = 1;
    while (this.get(`${typeId}_${number}`)) number += 1;
    return `${typeId}_${number}`;
  }

  // Serializable placement data only ({ id, type, gx, gy } per fixture).
  layout() {
    return this.fixtures.map(({ id, type, gx, gy }) => ({ id, type, gx, gy }));
  }

  /**
   * "SHELF", or "LOCKER 2" when several fixtures share a type.
   * @param {object} fixture
   */
  displayName(fixture) {
    const sameType = this.fixtures.filter((candidate) => candidate.type === fixture.type);
    const name = getFixtureType(fixture.type).name;
    return sameType.length > 1 ? `${name} ${sameType.indexOf(fixture) + 1}` : name;
  }
}
