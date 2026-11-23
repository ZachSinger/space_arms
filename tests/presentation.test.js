import assert from "node:assert/strict";
import test from "node:test";
import { DecisionRules } from "../js/state/DecisionRules.js";
import {
  getDecorationContribution, getPresentationMax, getPresentationScore, permitsPresentationReputationGain,
  rollPresentationExpectation,
} from "../js/modules/presentation/PresentationRules.js";
import { PresentationSystem } from "../js/modules/presentation/PresentationSystem.js";
import { FixtureRegistry } from "../js/logic/FixtureRegistry.js";

test("presentation maximum follows shop expansions and levels", () => {
  assert.equal(getPresentationMax({ salesExpansions: 0, shopLevel: 1 }), 20);
  assert.equal(getPresentationMax({ salesExpansions: 1, shopLevel: 7 }), 44);
});

test("each floor crate removes one presentation point without going below zero", () => {
  assert.equal(getPresentationScore(20, 4), 16);
  assert.equal(getPresentationScore(20, 5), 15);
  assert.equal(getPresentationScore(20, 100), 0);
});

test("expanded stores keep the starting base; variety counts once per design and clutter is subtracted after capping", () => {
  const same = { type: "decor_holo_planet" };
  const different = { type: "decor_holo_rocket" };
  assert.equal(getPresentationScore(44, 0), 20);
  assert.equal(getDecorationContribution([same, same]), 7);
  assert.equal(getDecorationContribution([same, different]), 8);
  assert.equal(getPresentationScore(44, 5, 1000), 39);
  assert.equal(getPresentationScore(44, 100, 1000), 0);
});

test("only placed sales-floor decorations contribute; moving, crating, and selling remove points and the last-copy bonus", () => {
  const fixtures = new FixtureRegistry();
  const first = fixtures.add({ id: "a", type: "decor_holo_planet", gx: 1, gy: 1 });
  fixtures.add({ id: "b", type: "decor_holo_planet", gx: 2, gy: 1 });
  fixtures.add({ id: "backroom", type: "decor_holo_rocket", gx: 7, gy: 1 });
  fixtures.add({ id: "locked", type: "decor_banner_star", gx: 5, gy: 1 });
  fixtures.add({ id: "shelf", type: "shelf_budget_2x2", gx: 0, gy: 2 });
  const shop = {
    fixtures,
    gameState: { reputation: { shopLevel: 17 }, rules: new DecisionRules() },
    room: { zones: [
      { gridX: 0, gridY: 0, gridW: 4, gridH: 4, salesFloor: true, locked: false },
      { gridX: 5, gridY: 0, gridW: 2, gridH: 4, salesFloor: true, locked: true },
      { gridX: 7, gridY: 0, gridW: 2, gridH: 4, salesFloor: false, locked: false },
    ] },
    crateSystem: { restockCrates: [], floorStacks: new Map() },
  };
  const presentation = new PresentationSystem(shop);
  assert.equal(presentation.getPresentation().score, 27);
  first.gx = 7;
  assert.equal(presentation.getPresentation().score, 24);
  fixtures.remove("b");
  assert.equal(presentation.getPresentation().score, 20);
  first.gx = 1;
  assert.equal(presentation.getPresentation().score, 24);
  fixtures.remove("a");
  assert.equal(presentation.getPresentation().score, 20);
  presentation.destroy();
});

test("presentation expectations match the approved faction ranges", () => {
  assert.equal(rollPresentationExpectation("scavengers", () => 0), 40);
  assert.equal(rollPresentationExpectation(null, () => 1), 75);
  assert.equal(rollPresentationExpectation("mercenaries", () => 0.5), 72.5);
  assert.equal(rollPresentationExpectation("explorers", () => 1), 80);
});

test("presentation only vetoes reputation gains for customers above the current score", () => {
  assert.equal(permitsPresentationReputationGain(75, { presentationExpectation: 75 }), true);
  assert.equal(permitsPresentationReputationGain(75, { presentationExpectation: 76 }), false);
  assert.equal(permitsPresentationReputationGain(0, null), true);
});

test("presentation counts sales-floor stacks, but not locked areas, terminal crates, or backroom crates", () => {
  const stackedBase = { sprite: { x: 32, y: 32 } };
  const loose = { sprite: { x: 64, y: 32 } };
  const locked = { sprite: { x: 352, y: 32 } };
  const backroom = { sprite: { x: 480, y: 32 } };
  const terminal = { sprite: { x: 224, y: 32 }, inTerminal: true };
  const gameState = {
    reputation: { shopLevel: 1 },
    rules: new DecisionRules(),
  };
  const shop = {
    gameState,
    room: {
      zones: [
        { id: "sales", gridX: 0, gridY: 0, gridW: 4, gridH: 4, salesFloor: true, locked: false },
        { id: "locked", gridX: 5, gridY: 0, gridW: 2, gridH: 4, salesFloor: true, locked: true },
        { id: "backroom", gridX: 7, gridY: 0, gridW: 2, gridH: 4, salesFloor: false, locked: false },
      ],
    },
    crateSystem: {
      restockCrates: [stackedBase, loose, locked, backroom, terminal],
      floorStacks: new Map([[stackedBase, [{}, {}]]]),
    },
  };
  const presentation = new PresentationSystem(shop);

  assert.equal(presentation.getSalesFloorCrateCount(), 4);
  assert.deepEqual(presentation.getPresentation(), {
    score: 16,
    max: 20,
    floorCrateCount: 4,
  });
  presentation.destroy();
});

test("presentation unregisters its reputation rule when destroyed", () => {
  const gameState = {
    reputation: { shopLevel: 1 },
    rules: new DecisionRules(),
  };
  const shop = {
    gameState,
    room: { zones: [] },
    crateSystem: { restockCrates: [], floorStacks: new Map() },
  };
  const presentation = new PresentationSystem(shop);
  const customer = { presentationExpectation: 101 };

  assert.equal(gameState.rules.permits("reputation.gain", { customer }), false);
  presentation.destroy();
  assert.equal(gameState.rules.permits("reputation.gain", { customer }), true);
});
