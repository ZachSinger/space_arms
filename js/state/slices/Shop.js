// ==========================================
// FILE: Shop.js
// ==========================================
// The shop's saved layout: which zones are open and every placed fixture, with each shelf's
// stock. Fixtures here are plain models; the map draws them (see world/FixtureViews.js) and
// the game's rules change them (see systems/FixtureSystem.js), announcing each change here.
import { Slice } from "../Slice.js";
import { FixtureRegistry } from "../../logic/FixtureRegistry.js";
import { ShelfFixture } from "../../logic/ShelfFixture.js";
import { fixtureFootprint, fixtureRotation, getFixtureType, getShelfDisplayGrid } from "../../logic/FixtureLayout.js";
import { startingFixtures } from "../../logic/StartingTemplate.js";
import { DEFAULT_SHELF_PAINT, isPaintableFixture } from "../../logic/ShelfPaint.js";
import { TILE_SIZE, ZONES } from "../../logic/RoomLayout.js";
import { SHOP_LAYOUT_VERSION } from "../migrations/index.js";

/**
 * A fixture model at its saved cell. Shelves start empty; a save fills in their stock.
 * @param {{ id: string, type: string, gx: number, gy: number, rotation?: number }} entry - gx/gy is the top-left cell
 */
export function createFixtureModel({
  id, type, gx, gy, rotation = 0, placements = [], nextPlacementId, paint,
}) {
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
      handsOn: spec.artLayout === "budget",
      placements,
      nextPlacementId,
    })
    : { ...base };
  return Object.assign(fixture, { type, gx, gy, rotation },
    isPaintableFixture(spec) ? { paint: paint ?? DEFAULT_SHELF_PAINT } : {});
}

export class Shop extends Slice {
  constructor() {
    super();
    this.fixtures = new FixtureRegistry();
    this.unlockedZones = new Set(ZONES.filter((zone) => !zone.locked).map((zone) => zone.id));
  }

  /** A new game's shop: the starting zones and the Starting Template's fixtures and stock. */
  static newGame() {
    const shop = new Shop();
    for (const entry of startingFixtures()) shop.fixtures.add(createFixtureModel(entry));
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
        const entry = { id: fixture.id, type: fixture.type, gx: fixture.gx, gy: fixture.gy, rotation: fixtureRotation(fixture),
          ...(fixture.paint && fixture.paint !== DEFAULT_SHELF_PAINT ? { paint: fixture.paint } : {}) };
        if (fixture instanceof ShelfFixture) {
          const placements = fixture.placements.map((stack) => ({ ...stack }));
          return {
            ...entry,
            placements,
            nextPlacementId: fixture.nextPlacementId,
            ...(fixture.handsOn ? { stockingVersion: 1 } : {}),
          };
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
      shop.fixtures.add(createFixtureModel(entry));
    }
    return shop;
  }
}
