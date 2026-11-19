// ==========================================
// FILE: Shop.js
// ==========================================
// The shop's saved layout: which zones are open and every placed fixture, with each shelf's
// stock. Fixtures here are plain models; the map draws them (see world/FixtureViews.js) and
// the game's rules change them (see systems/FixtureSystem.js), announcing each change here.
import { Slice } from "../Slice.js";
import { FixtureRegistry } from "../../logic/FixtureRegistry.js";
import { ShelfFixture } from "../../logic/ShelfFixture.js";
import { STARTING_FIXTURES, fixtureFootprint, fixtureRotation, getFixtureType, getShelfDisplayGrid } from "../../logic/FixtureLayout.js";
import { TILE_SIZE, ZONES } from "../../logic/RoomLayout.js";
import { SHOP_LAYOUT_VERSION } from "../migrations/index.js";

/**
 * A fixture model at its saved cell. Shelves start empty; a save fills in their stock.
 * @param {{ id: string, type: string, gx: number, gy: number, rotation?: number }} entry - gx/gy is the top-left cell
 */
export function createFixtureModel({ id, type, gx, gy, rotation = 0 }) {
  const spec = getFixtureType(type);
  if (!spec) throw new Error(`Unknown fixture type: ${type}`);
  const footprint = fixtureFootprint({ type, rotation });
  const base = {
    id,
    x: (gx + footprint.w / 2) * TILE_SIZE,
    y: (gy + footprint.h / 2) * TILE_SIZE,
    // Unrotated size: the shelf's item grid and art are laid out in this frame.
    gridDimensions: { w: spec.w, h: spec.h },
  };
  const fixture = spec.kind === "shelf"
    ? new ShelfFixture({
      ...base,
      displayType: "universal",
      displayGrid: getShelfDisplayGrid(spec),
      // Per-placement slot cap, not a shared pool -- see ShelfFixture.getPlacementCapacity.
      stackDepth: spec.stackDepth,
      handsOn: spec.artLayout === "budget",
      placements: [],
    })
    : { ...base };
  return Object.assign(fixture, { type, gx, gy, rotation });
}

export class Shop extends Slice {
  constructor() {
    super();
    this.fixtures = new FixtureRegistry();
    this.unlockedZones = new Set(ZONES.filter((zone) => !zone.locked).map((zone) => zone.id));
  }

  /** A new game's shop: the starting zones and the starting fixtures. */
  static newGame() {
    const shop = new Shop();
    for (const entry of STARTING_FIXTURES) shop.fixtures.add(createFixtureModel(entry));
    return shop;
  }

  /** @param {string} zoneId */
  isUnlocked(zoneId) {
    return this.unlockedZones.has(zoneId);
  }

  /**
   * @param {string} zoneId
   * @returns {boolean} false if it was already open
   */
  unlockZone(zoneId) {
    if (this.unlockedZones.has(zoneId)) return false;
    this.unlockedZones.add(zoneId);
    this.changed();
    return true;
  }

  /**
   * Takes over a loaded shop's data in place, so everything holding this slice or its fixture
   * registry keeps working (see GameState.replaceWith).
   * @param {Shop} next
   */
  adopt(next) {
    this.fixtures.clear();
    for (const fixture of next.fixtures.all()) this.fixtures.add(fixture);
    this.unlockedZones = new Set(next.unlockedZones);
  }

  toSave() {
    return {
      fixtures: this.fixtures.all().map((fixture) => {
        const entry = { id: fixture.id, type: fixture.type, gx: fixture.gx, gy: fixture.gy, rotation: fixtureRotation(fixture) };
        if (fixture instanceof ShelfFixture) {
          const placements = fixture.placements.map((stack) => ({ ...stack }));
          return { ...entry, placements, ...(fixture.handsOn ? { stockingVersion: 1 } : {}) };
        }
        return entry;
      }),
      // In map order, as the room lists its zones.
      unlockedZones: ZONES.map((zone) => zone.id).filter((id) => this.unlockedZones.has(id)),
      layoutVersion: SHOP_LAYOUT_VERSION,
    };
  }

  /** @param {{ fixtures?: object[], unlockedZones?: string[] }} data - an upgraded, checked save */
  static fromSave(data) {
    const shop = new Shop();
    for (const id of data.unlockedZones ?? []) shop.unlockedZones.add(id);
    for (const entry of data.fixtures ?? []) {
      const fixture = shop.fixtures.add(createFixtureModel(entry));
      if (fixture instanceof ShelfFixture) fixture.placements = entry.placements.map((stack) => ({ ...stack }));
    }
    return shop;
  }
}
