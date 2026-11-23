import presentationTuning from "../../../data/tuning/presentation.json" with { type: "json" };
import { gameRandom } from "../../core/Random.js";
import { loadTuning } from "../../core/Tuning.js";
import { getFixtureType } from "../../logic/FixtureLayout.js";

export const PRESENTATION_TUNING = loadTuning("presentation", presentationTuning);

const EXPECTATION_RANGES = Object.freeze({
  scavengers: PRESENTATION_TUNING.scavengersExpectationPercent,
  civilian: PRESENTATION_TUNING.civilianExpectationPercent,
  mercenaries: PRESENTATION_TUNING.mercenariesExpectationPercent,
  explorers: PRESENTATION_TUNING.explorersExpectationPercent,
});

export function getPresentationMax({ salesExpansions, shopLevel }) {
  return PRESENTATION_TUNING.presentationBase +
    PRESENTATION_TUNING.presentationPerSalesExpansion * Math.max(0, salesExpansions) +
    PRESENTATION_TUNING.presentationPerLevelAboveFloor *
      Math.max(0, shopLevel - PRESENTATION_TUNING.presentationLevelFloor);
}

export function getDecorationContribution(decorations) {
  let points = 0;
  const designs = new Set();
  for (const fixture of decorations) {
    const spec = getFixtureType(fixture.type);
    if (spec?.kind !== "decoration") continue;
    points += spec.presentationPoints;
    designs.add(spec.id);
  }
  return points + designs.size * PRESENTATION_TUNING.decorationVarietyBonus;
}

export function getPresentationScore(max, floorCrateCount, decorationPoints = 0) {
  const decoratedBase = Math.min(max, PRESENTATION_TUNING.presentationBase + decorationPoints);
  return Math.max(0, decoratedBase - floorCrateCount * PRESENTATION_TUNING.floorCratePenalty);
}

export function rollPresentationExpectation(factionId, random = gameRandom) {
  const [min, max] = EXPECTATION_RANGES[factionId] ?? EXPECTATION_RANGES.civilian;
  return min + random() * (max - min);
}

export function permitsPresentationReputationGain(percent, customer) {
  const expectation = customer?.presentationExpectation;
  return expectation == null || percent >= expectation;
}
