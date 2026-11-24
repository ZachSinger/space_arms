import { TILE_SIZE, EXPANSION_ORDER, zoneAt } from "../../logic/RoomLayout.js";
import {
  getDecorationContribution, getPresentationMax, getPresentationScore, permitsPresentationReputationGain,
  rollPresentationExpectation,
} from "./PresentationRules.js";
import { fixtureBounds } from "../../logic/FixtureLayout.js";

export class PresentationSystem {
  constructor(shop) {
    this.id = "presentation";
    this.shop = shop;
    this.unregisterReputationRule = shop.gameState.rules.register(
      "reputation.gain",
      ({ customer } = {}) => permitsPresentationReputationGain(this.getPresentationPercent(), customer),
    );
  }

  createCustomerExpectation(factionId) {
    return rollPresentationExpectation(factionId);
  }

  getSalesFloorCrateCount() {
    const { crateSystem, room } = this.shop;
    let count = 0;
    for (const crate of crateSystem.restockCrates) {
      if (crate.inTerminal) continue;
      const zone = zoneAt(
        Math.floor(crate.sprite.x / TILE_SIZE),
        Math.floor(crate.sprite.y / TILE_SIZE),
        room.zones,
      );
      if (!zone?.salesFloor || zone.locked) continue;
      count += 1 + (crateSystem.floorStacks.get(crate)?.length ?? 0);
    }
    return count;
  }

  getPresentation() {
    const shop = this.shop;
    const salesExpansions = EXPANSION_ORDER.filter((id) =>
      shop.room.zones.some((zone) => zone.id === id && !zone.locked)).length;
    const max = getPresentationMax({
      salesExpansions,
      shopLevel: shop.gameState.reputation.shopLevel,
    });
    const floorCrateCount = this.getSalesFloorCrateCount();
    const decorations = (shop.fixtures?.ofKind("decoration") ?? []).filter((fixture) => {
      const bounds = fixtureBounds(fixture);
      const zone = zoneAt(
        Math.floor((bounds.left + bounds.right) / 2),
        Math.floor((bounds.top + bounds.bottom) / 2),
        shop.room.zones,
      );
      return zone?.salesFloor && !zone.locked;
    });
    return {
      score: getPresentationScore(max, floorCrateCount, getDecorationContribution(decorations)),
      max,
      floorCrateCount,
    };
  }

  getPresentationPercent() {
    const { score, max } = this.getPresentation();
    return score / max * 100;
  }

  update() {
    this.shop.hud.renderPresentation(this.getPresentation());
  }

  destroy() {
    this.unregisterReputationRule();
  }
}
